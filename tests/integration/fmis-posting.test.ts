import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { WorkerContext } from '@ircub/worker/context';
import { postBusinessDay, sendBatch } from '@ircub/worker/jobs/fmis-posting';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { baseFixtures, ref, resetDatabase, testContext } from './helpers';

/** A tiny fake FMIS that fails the first `failures` posts with HTTP 503. */
let failures = 0;
let posts: unknown[] = [];
let server: Server;
let ctx: WorkerContext;
const FAST_RETRY = { maxAttempts: 3, baseDelayMs: 5 };

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => (body += chunk.toString()));
    req.on('end', () => {
      posts.push(JSON.parse(body || '{}'));
      if (failures > 0) {
        failures--;
        res.writeHead(503).end(JSON.stringify({ error: 'down' }));
        return;
      }
      res
        .writeHead(201, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ fmisReference: `FMIS-TEST-${posts.length}` }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  ctx = testContext(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
});

afterAll(async () => {
  await ctx.prisma.$disconnect();
  ctx.redis.disconnect();
  server.close();
});

describe('FMIS posting', () => {
  beforeEach(async () => {
    failures = 0;
    posts = [];
    await resetDatabase(ctx.prisma);
    const { payerId } = await baseFixtures(ctx.prisma);
    const payment = (revenue: string, amount: number) => ({
      payer_id: payerId,
      revenue_code: revenue,
      amount,
      currency: 'SOS' as const,
      amount_base: amount,
      channel: 'BANK' as const,
      external_ref: ref('FM'),
      paid_at: new Date('2026-03-01T09:00:00Z'),
      status: 'DONE' as const,
      source: 'BULK_API' as const,
    });
    await ctx.prisma.payment.createMany({
      data: [payment('BL', 100.1), payment('BL', 0.2), payment('WTR', 50)],
    });
  });

  it('posts a balanced journal and stores the FMIS reference', async () => {
    const result = await postBusinessDay(ctx, '2026-03-01', FAST_RETRY);
    expect(result).toMatchObject({ status: 'POSTED', attempts: 1 });

    const batch = await ctx.prisma.journalBatch.findFirstOrThrow({ include: { lines: true } });
    expect(batch.fmis_reference).toBe('FMIS-TEST-1');
    expect(Number(batch.total_debit)).toBe(150.3);
    expect(Number(batch.total_credit)).toBe(150.3);
    expect(batch.lines).toHaveLength(4); // 1 bank debit + 3 payment credits
    expect(posts[0]).toMatchObject({
      batchRef: `IRCUB-JB-${batch.batch_id}`,
      lines: [
        { glCode: '1101-000', debit: 150.3, credit: 0 },
        { glCode: '1410-100', debit: 0, credit: 100.3 },
        { glCode: '1510-100', debit: 0, credit: 50 },
      ],
    });
    expect(await ctx.prisma.payment.count({ where: { fmis_status: 'POSTED' } })).toBe(3);
  });

  it('never posts the same payment twice', async () => {
    await postBusinessDay(ctx, '2026-03-01', FAST_RETRY);
    expect(await postBusinessDay(ctx, '2026-03-01', FAST_RETRY)).toBeNull();
    expect(posts).toHaveLength(1);
  });

  it('retries with backoff and succeeds on the third attempt', async () => {
    failures = 2;
    const result = await postBusinessDay(ctx, '2026-03-01', FAST_RETRY);
    expect(result).toMatchObject({ status: 'POSTED', attempts: 3 });
    expect(posts).toHaveLength(3);
  });

  it('marks the batch FAILED after 3 attempts and raises an alert; a later retry posts it', async () => {
    failures = 3;
    const result = await postBusinessDay(ctx, '2026-03-01', FAST_RETRY);
    expect(result).toMatchObject({ status: 'FAILED' });
    const batch = await ctx.prisma.journalBatch.findFirstOrThrow();
    expect(batch).toMatchObject({ status: 'FAILED', attempts: 3 });
    expect(await ctx.prisma.alert.count({ where: { alert_type: 'FMIS_POSTING_FAILED' } })).toBe(1);
    expect(await ctx.prisma.payment.count({ where: { fmis_status: 'NOT_POSTED' } })).toBe(3);

    // Manual retry by a supervisor once FMIS is back.
    const retry = await sendBatch(ctx, batch.batch_id, FAST_RETRY);
    expect(retry.status).toBe('POSTED');
    expect(await ctx.prisma.payment.count({ where: { fmis_status: 'POSTED' } })).toBe(3);
  });
});
