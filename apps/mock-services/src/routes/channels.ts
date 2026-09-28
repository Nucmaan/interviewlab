/**
 * Mock bank + mobile money provider + exchange-rates API.
 *
 *   GET  /rates                          dynamic USD -> SOS rate
 *   POST /payments                       initiate a payment (like a mobile money "push")
 *   GET  /payments/:externalRef/status   status query (used by IRCUB's retry job)
 *   POST /simulate/callbacks             pretend payers paid these control numbers at the bank/app
 *   GET  /statements/:channel/:date      daily statement CSV for reconciliation
 */
import { randomUUID } from 'node:crypto';
import { computeSignature } from '@ircub/core';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  persist,
  runtime,
  shouldFail,
  simulateLatency,
  state,
  type ChannelTransaction,
} from '../state';

const initiateSchema = z.object({
  external_ref: z.string().min(3).max(64),
  amount: z.number().positive(),
  currency: z.enum(['USD', 'SOS']),
  channel: z.enum(['BANK', 'MOBILE_MONEY']).default('MOBILE_MONEY'),
  msisdn: z.string().optional(),
  control_number: z.string().optional(),
});

const simulateSchema = z.object({
  channel: z.enum(['BANK', 'MOBILE_MONEY']).default('MOBILE_MONEY'),
  payments: z
    .array(
      z.object({
        control_number: z.string(),
        amount: z.number().positive(),
        currency: z.enum(['USD', 'SOS']),
      }),
    )
    .min(1)
    .max(500),
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function registerChannelRoutes(app: FastifyInstance, logger: FastifyBaseLogger): void {
  const callbackUrl =
    process.env.IRCUB_CALLBACK_URL ?? 'http://localhost:3000/api/payments/callback';
  const secret = process.env.CHANNEL_CALLBACK_SECRET ?? '';

  /** Sends a signed callback to IRCUB, retrying like a real provider would (3 tries). */
  async function sendCallback(tx: ChannelTransaction): Promise<void> {
    const body = JSON.stringify({
      external_ref: tx.externalRef,
      status: tx.status === 'SUCCESS' ? 'SUCCESS' : 'FAILED',
      amount: tx.amount,
      currency: tx.currency,
      channel: tx.channel,
      paid_at: tx.completedAt ?? new Date().toISOString(),
      control_number: tx.controlNumber,
      provider_ref: tx.providerRef,
      failure_reason: tx.reason,
    });
    for (let attempt = 1; attempt <= 3; attempt++) {
      const timestamp = String(Math.floor(Date.now() / 1000));
      try {
        const response = await fetch(callbackUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Timestamp': timestamp,
            'X-Signature': computeSignature(secret, timestamp, body),
            // Same key on every retry: IRCUB returns the original answer instead of re-processing.
            'Idempotency-Key': `cb-${tx.externalRef}`,
          },
          body,
          signal: AbortSignal.timeout(10_000),
        });
        if (response.ok) return;
        logger.warn({ ref: tx.externalRef, status: response.status, attempt }, 'callback rejected');
        if (response.status < 500 && response.status !== 409 && response.status !== 429) return;
      } catch (error) {
        logger.warn(
          { ref: tx.externalRef, attempt, err: (error as Error).message },
          'callback failed',
        );
      }
      await sleep(1000 * 2 ** attempt);
    }
  }

  /** Completes a pending transaction after a short delay, then (usually) calls IRCUB back. */
  function completeLater(tx: ChannelTransaction, dropCallbackAllowed: boolean): void {
    setTimeout(
      () => {
        const declined = shouldFail();
        tx.status = declined ? 'FAILED' : 'SUCCESS';
        tx.reason = declined ? 'Insufficient funds' : undefined;
        tx.completedAt = new Date().toISOString();
        persist();
        if (dropCallbackAllowed && Math.random() < runtime.callbackDropRate) {
          logger.info({ ref: tx.externalRef }, 'simulating a lost callback');
          return;
        }
        void sendCallback(tx);
      },
      1000 + Math.random() * 3000,
    );
  }

  app.get('/rates', async (_request, reply) => {
    await simulateLatency();
    if (shouldFail()) return reply.code(503).send({ error: 'Rates service unavailable' });
    // Slow drift plus a little noise, so rates are visibly "dynamic".
    const minutes = Date.now() / 60_000;
    const usd = Math.round((571 + 3 * Math.sin(minutes / 720) + (Math.random() - 0.5)) * 100) / 100;
    return { base: 'SOS', rates: { USD: usd, SOS: 1 }, timestamp: new Date().toISOString() };
  });

  app.post('/payments', async (request, reply) => {
    await simulateLatency();
    const parsed = initiateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message });
    if (state.transactions.some((t) => t.externalRef === parsed.data.external_ref)) {
      return reply.code(409).send({ error: 'Duplicate external_ref' });
    }
    const tx: ChannelTransaction = {
      externalRef: parsed.data.external_ref,
      providerRef: `PRV-${randomUUID().slice(0, 8).toUpperCase()}`,
      channel: parsed.data.channel,
      amount: parsed.data.amount,
      currency: parsed.data.currency,
      controlNumber: parsed.data.control_number,
      status: 'PENDING',
      createdAt: new Date().toISOString(),
    };
    state.transactions.push(tx);
    persist();
    completeLater(tx, true);
    return reply.code(202).send({ provider_ref: tx.providerRef, status: 'PENDING' });
  });

  app.get<{ Params: { externalRef: string } }>(
    '/payments/:externalRef/status',
    async (request, reply) => {
      await simulateLatency();
      if (shouldFail()) return reply.code(503).send({ error: 'Status service unavailable' });
      const tx = state.transactions.find((t) => t.externalRef === request.params.externalRef);
      if (!tx) return reply.code(404).send({ error: 'Unknown transaction' });
      return { status: tx.status, providerRef: tx.providerRef, reason: tx.reason };
    },
  );

  app.post('/simulate/callbacks', async (request, reply) => {
    const parsed = simulateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message });
    const prefix = parsed.data.channel === 'BANK' ? 'SIMBNK' : 'SIMMM';
    for (const p of parsed.data.payments) {
      const tx: ChannelTransaction = {
        externalRef: `${prefix}-${Date.now()}-${randomUUID().slice(0, 6).toUpperCase()}`,
        providerRef: `PRV-${randomUUID().slice(0, 8).toUpperCase()}`,
        channel: parsed.data.channel,
        amount: p.amount,
        currency: p.currency,
        controlNumber: p.control_number,
        status: 'PENDING',
        createdAt: new Date().toISOString(),
      };
      state.transactions.push(tx);
      completeLater(tx, false);
    }
    persist();
    return reply.code(202).send({ queued: parsed.data.payments.length });
  });

  /**
   * Statement for one channel and day. To make reconciliation interesting it deliberately
   * introduces differences on some days: one amount changed and one extra line IRCUB never saw.
   */
  app.get<{ Params: { channel: string; date: string } }>(
    '/statements/:channel/:date',
    async (request, reply) => {
      const { channel, date } = request.params;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
        return reply.code(400).send({ error: 'date must be YYYY-MM-DD' });
      const lines = state.transactions.filter(
        (t) =>
          t.channel === channel && t.status === 'SUCCESS' && (t.completedAt ?? '').startsWith(date),
      );
      const rows = lines.map((t) => [
        t.externalRef,
        t.amount.toFixed(2),
        t.currency,
        t.completedAt ?? '',
      ]);
      if (rows.length > 2) {
        rows[1]![1] = (Number(rows[1]![1]) + 5).toFixed(2);
        rows.push([
          `${channel === 'BANK' ? 'BNK' : 'MM'}-UNMATCHED-${date.replaceAll('-', '')}`,
          '150.00',
          'USD',
          `${date}T12:00:00.000Z`,
        ]);
      }
      const csv = ['external_ref,amount,currency,paid_at', ...rows.map((r) => r.join(','))].join(
        '\n',
      );
      return reply.header('Content-Type', 'text/csv').send(csv);
    },
  );
}
