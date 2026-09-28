import 'server-only';
import { isValidControlNumber, toCents } from '@ircub/core';
import { enqueuePayments, getRedis, publishEvent } from '@ircub/platform';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import { callbackSchema, type CallbackInput, type IngestSummary } from '../schemas/payment';
import { ingestPayments } from './ingest';

const rejected = (reason: string): IngestSummary => ({
  received: 1,
  accepted: 0,
  rejected: 1,
  errors: [{ row: 1, reason }],
});

const ACCEPTED: IngestSummary = { received: 1, accepted: 1, rejected: 0, errors: [] };

/**
 * Handles one payment notification from a bank or mobile money provider.
 *
 * Case 1 - we started the payment (portal / mobile money push): a payment with this external_ref
 *          is AWAITING_CONFIRMATION. SUCCESS moves it to PENDING for processing; FAILED marks it
 *          FAILED. The amount must match what we asked for.
 * Case 2 - the payer paid at the bank/app with a control number: we look the control number up,
 *          find the assessment or bill and the payer, then ingest it like any other payment.
 * Anything already recorded is reported as a duplicate, and a 200 is still returned so the channel
 * stops retrying.
 */
export async function handleCallback(body: unknown): Promise<IngestSummary> {
  const parsed = callbackSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return rejected(`${issue?.path.join('.') || 'body'}: ${issue?.message ?? 'invalid'}`);
  }
  const callback = parsed.data;
  const existing = await prisma.payment.findUnique({
    where: { external_ref: callback.external_ref },
    include: { revenue_type: { select: { category: true } } },
  });

  if (existing) {
    if (existing.status !== 'AWAITING_CONFIRMATION') {
      return rejected(
        `Duplicate callback: ${callback.external_ref} is already recorded (${existing.status})`,
      );
    }
    return confirmInitiatedPayment(
      existing.payment_id,
      existing.payer_id,
      existing.revenue_type.category,
      {
        expectedAmount: Number(existing.amount),
        expectedCurrency: existing.currency,
        callback,
      },
    );
  }

  if (callback.status === 'FAILED') {
    await storeFailed(
      callback,
      `Declined by channel: ${callback.failure_reason ?? 'no reason given'}`,
    );
    return rejected(`Declined by channel: ${callback.failure_reason ?? 'no reason given'}`);
  }

  const target = await resolveControlNumber(callback.control_number);
  if (!target) {
    const reason = callback.control_number
      ? `Unknown or invalid control number ${callback.control_number}`
      : 'control_number is required for payments not initiated by IRCUB';
    await storeFailed(callback, reason);
    return rejected(reason);
  }

  const {
    errors,
    received,
    accepted,
    rejected: rejectedCount,
  } = await ingestPayments(
    [
      {
        payer_id: target.payerId,
        revenue_code: target.revenueCode,
        amount: callback.amount,
        currency: callback.currency,
        channel: callback.channel,
        external_ref: callback.external_ref,
        paid_at: callback.paid_at,
        assessment_id: target.assessmentId,
        bill_id: target.billId,
      },
    ],
    { source: 'CALLBACK' },
  );
  return { received, accepted, rejected: rejectedCount, errors };
}

async function confirmInitiatedPayment(
  paymentId: number,
  payerId: number,
  category: 'TAX' | 'WATER',
  input: { expectedAmount: number; expectedCurrency: string; callback: CallbackInput },
): Promise<IngestSummary> {
  const { callback } = input;
  const amountMatches =
    toCents(callback.amount) === toCents(input.expectedAmount) &&
    callback.currency === input.expectedCurrency;
  const success = callback.status === 'SUCCESS' && amountMatches;
  const failureReason = !amountMatches
    ? `Amount mismatch: expected ${input.expectedCurrency} ${input.expectedAmount}, got ${callback.currency} ${callback.amount}`
    : (callback.failure_reason ?? 'Declined by channel');

  // Only move forward from AWAITING_CONFIRMATION; a late duplicate cannot undo a final state.
  const updated = await prisma.payment.updateMany({
    where: { payment_id: paymentId, status: 'AWAITING_CONFIRMATION' },
    data: success
      ? {
          status: 'PENDING',
          provider_ref: callback.provider_ref ?? null,
          paid_at: new Date(callback.paid_at),
        }
      : {
          status: 'FAILED',
          failure_reason: failureReason,
          provider_ref: callback.provider_ref ?? null,
        },
  });
  if (updated.count === 0) {
    return rejected(`Duplicate callback: ${callback.external_ref} was already confirmed`);
  }

  const redis = getRedis();
  if (success) {
    await enqueuePayments(redis, [{ paymentId, category }]);
  }
  await publishEvent(redis, {
    type: 'payment.updated',
    paymentId,
    payerId,
    externalRef: callback.external_ref,
    status: success ? 'PENDING' : 'FAILED',
  });
  logger.info({ paymentId, success }, 'initiated payment confirmed by channel callback');
  return success ? ACCEPTED : rejected(failureReason);
}

/** Failed and invalid notifications are kept separately from successful payments. */
async function storeFailed(callback: CallbackInput, reason: string): Promise<void> {
  await prisma.rejectedPayment.create({
    data: {
      source: 'CALLBACK',
      row_number: 1,
      external_ref: callback.external_ref,
      payload: callback,
      reason,
    },
  });
}

async function resolveControlNumber(controlNumber: string | undefined): Promise<{
  payerId: number;
  revenueCode: string;
  assessmentId: number | null;
  billId: number | null;
} | null> {
  if (!controlNumber || !isValidControlNumber(controlNumber)) return null;
  const normalised = controlNumber.trim().toUpperCase();
  if (normalised.startsWith('AS-')) {
    const assessment = await prisma.assessment.findUnique({
      where: { control_number: normalised },
    });
    return assessment
      ? {
          payerId: assessment.payer_id,
          revenueCode: assessment.revenue_code,
          assessmentId: assessment.assessment_id,
          billId: null,
        }
      : null;
  }
  const bill = await prisma.waterBill.findUnique({
    where: { control_number: normalised },
    include: { account: { select: { payer_id: true } } },
  });
  return bill
    ? {
        payerId: bill.account.payer_id,
        revenueCode: 'WTR',
        assessmentId: null,
        billId: bill.bill_id,
      }
    : null;
}
