import 'server-only';
import { convertToBase, fromCents, roundMoney, toCents } from '@ircub/core';
import { getConfig, toNumber } from '@ircub/db';
import { getQueue, QUEUES, type PaymentStatusJob } from '@ircub/platform';
import { randomUUID } from 'node:crypto';
import { audit } from '@/lib/audit';
import { prisma } from '@/lib/db';
import { DomainError, NotFoundError } from '@/lib/errors';
import { callMockService } from '@/lib/mock-services';
import type { CurrentUser } from '@/lib/rbac';
import { redis } from '@/lib/redis';
import { getLatestRates } from './rates';

/** What a self-service customer sees: their open assessments, payable bills and payments. */
export async function getPortalData(payerId: number) {
  const [payer, assessments, accounts, payments] = await Promise.all([
    prisma.payer.findUniqueOrThrow({ where: { payer_id: payerId } }),
    prisma.assessment.findMany({
      where: { payer_id: payerId, status: { in: ['OPEN', 'PART_PAID'] } },
      orderBy: { due_date: 'asc' },
    }),
    prisma.waterAccount.findMany({
      where: { payer_id: payerId },
      include: {
        bills: {
          where: { status: { notIn: ['HELD', 'CANCELLED'] } },
          orderBy: { billing_month: 'desc' },
          take: 6,
        },
      },
    }),
    prisma.payment.findMany({
      where: { payer_id: payerId },
      orderBy: { created_at: 'desc' },
      take: 20,
    }),
  ]);
  return { payer, assessments, accounts, payments };
}

export interface InitiateInput {
  target: 'assessment' | 'bill';
  targetId: number;
  currency: 'USD' | 'SOS';
  msisdn: string;
}

/**
 * Starts a mobile money payment for the customer's own assessment or bill:
 *   1. record the payment as AWAITING_CONFIRMATION (so nothing is lost if anything below fails);
 *   2. ask the mock mobile money provider to push a payment request to the customer's phone;
 *   3. queue a status check that retries up to 3 times in case the provider's callback never
 *      arrives. The callback (or the status check) then moves the payment on to processing.
 */
export async function initiateMobilePayment(input: InitiateInput, user: CurrentUser) {
  if (!user.payerId) throw new DomainError('Your account is not linked to a taxpayer record');

  let outstandingBase: number;
  let controlNumber: string;
  let revenueCode: string;
  if (input.target === 'assessment') {
    const a = await prisma.assessment.findFirst({
      where: { assessment_id: input.targetId, payer_id: user.payerId },
    });
    if (!a) throw new NotFoundError('Assessment');
    outstandingBase = toNumber(a.amount_due) + toNumber(a.penalty_amount) - toNumber(a.amount_paid);
    controlNumber = a.control_number;
    revenueCode = a.revenue_code;
  } else {
    const b = await prisma.waterBill.findFirst({
      where: {
        bill_id: input.targetId,
        account: { payer_id: user.payerId },
        status: { in: ['ISSUED', 'PART_PAID'] },
      },
    });
    if (!b) throw new NotFoundError('Payable water bill');
    outstandingBase = toNumber(b.total_due) - toNumber(b.amount_paid);
    controlNumber = b.control_number;
    revenueCode = 'WTR';
  }
  outstandingBase = roundMoney(outstandingBase);
  if (outstandingBase <= 0) throw new DomainError('Nothing is outstanding on this item');

  const rates = await getLatestRates();
  const rate = rates.get(input.currency);
  if (!rate) throw new DomainError(`No exchange rate available for ${input.currency}`);
  // For USD, round UP to the cent so the converted amount covers what is owed.
  const amount =
    input.currency === 'SOS'
      ? outstandingBase
      : fromCents(Math.ceil(toCents(outstandingBase) / rate));
  const externalRef = `PRT-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 4).toUpperCase()}`;

  const payment = await prisma.$transaction(async (tx) => {
    const p = await tx.payment.create({
      data: {
        payer_id: user.payerId!,
        revenue_code: revenueCode,
        assessment_id: input.target === 'assessment' ? input.targetId : null,
        bill_id: input.target === 'bill' ? input.targetId : null,
        amount,
        currency: input.currency,
        exchange_rate: rate,
        amount_base: convertToBase(amount, input.currency, rate),
        channel: 'MOBILE_MONEY',
        external_ref: externalRef,
        paid_at: new Date(),
        status: 'AWAITING_CONFIRMATION',
        source: 'PORTAL',
      },
    });
    await audit(tx, user, {
      action: 'PAYMENT_INITIATED',
      entityType: 'payment',
      entityId: p.payment_id,
      after: { externalRef, amount, currency: input.currency, controlNumber },
    });
    return p;
  });

  try {
    const response = await callMockService<{ provider_ref: string }>(
      'POST',
      '/payments',
      {
        external_ref: externalRef,
        amount,
        currency: input.currency,
        channel: 'MOBILE_MONEY',
        msisdn: input.msisdn,
        control_number: controlNumber,
      },
      'The mobile money provider',
    );
    await prisma.payment.update({
      where: { payment_id: payment.payment_id },
      data: { provider_ref: response.provider_ref },
    });
  } catch (error) {
    await prisma.payment.update({
      where: { payment_id: payment.payment_id },
      data: { status: 'FAILED', failure_reason: (error as Error).message.slice(0, 300) },
    });
    throw error;
  }

  const policy = await getConfig(prisma, 'payment_status_check', {
    maxAttempts: 3,
    baseDelayMs: 2000,
  });
  const data: PaymentStatusJob = { paymentId: payment.payment_id };
  await getQueue(redis(), QUEUES.paymentStatus).add('check', data, {
    jobId: `status-${payment.payment_id}`,
    // First check after 15 s: most callbacks arrive long before that.
    delay: 15_000,
    attempts: policy.maxAttempts,
    backoff: { type: 'exponential', delay: policy.baseDelayMs },
  });
  return { paymentId: payment.payment_id, externalRef, amount, currency: input.currency };
}
