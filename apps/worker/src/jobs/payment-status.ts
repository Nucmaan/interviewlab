/**
 * Status checks for payments IRCUB initiated with a channel (POC module 5 retry mechanism).
 *
 * Normally the channel's callback confirms the payment. If no callback arrives, this job asks
 * the channel for the status. It is retried by BullMQ with exponential backoff; after the last
 * attempt (3 by default) the payment is marked permanently FAILED and supervisors are notified.
 */
import { enqueuePayments, publishEvent } from '@ircub/platform';
import type { WorkerContext } from '../lib/context';
import { notifySupervisors } from './notifications';
import { raiseAlert } from './summaries';

export class StillPendingError extends Error {
  constructor(externalRef: string) {
    super(`Payment ${externalRef} is still pending at the channel`);
    this.name = 'StillPendingError';
  }
}

export type StatusCheckOutcome = 'CONFIRMED' | 'DECLINED' | 'ALREADY_FINAL' | 'PERMANENTLY_FAILED';

export async function checkPaymentStatus(
  ctx: WorkerContext,
  paymentId: number,
  attempt: number,
  maxAttempts: number,
): Promise<StatusCheckOutcome> {
  const payment = await ctx.prisma.payment.findUnique({
    where: { payment_id: paymentId },
    include: { revenue_type: { select: { category: true } } },
  });
  // The callback may already have arrived and settled the payment.
  if (!payment || payment.status !== 'AWAITING_CONFIRMATION') return 'ALREADY_FINAL';

  await ctx.prisma.payment.update({
    where: { payment_id: paymentId },
    data: { status_check_attempts: { increment: 1 } },
  });

  let channelStatus: 'PENDING' | 'SUCCESS' | 'FAILED' | 'UNREACHABLE' = 'UNREACHABLE';
  let providerRef: string | undefined;
  let reason: string | undefined;
  try {
    const response = await ctx.mock.getPaymentStatus(payment.external_ref);
    channelStatus = response.status;
    providerRef = response.providerRef;
    reason = response.reason;
  } catch (error) {
    ctx.logger.warn({ paymentId, attempt, err: (error as Error).message }, 'status check failed');
  }

  if (channelStatus === 'SUCCESS' || channelStatus === 'FAILED') {
    const success = channelStatus === 'SUCCESS';
    const updated = await ctx.prisma.payment.updateMany({
      where: { payment_id: paymentId, status: 'AWAITING_CONFIRMATION' },
      data: success
        ? { status: 'PENDING', provider_ref: providerRef ?? null }
        : {
            status: 'FAILED',
            failure_reason: `Declined by channel: ${reason ?? 'no reason given'}`,
          },
    });
    if (updated.count === 0) return 'ALREADY_FINAL';
    if (success)
      await enqueuePayments(ctx.redis, [{ paymentId, category: payment.revenue_type.category }]);
    await publishEvent(ctx.redis, {
      type: 'payment.updated',
      paymentId,
      payerId: payment.payer_id,
      externalRef: payment.external_ref,
      status: success ? 'PENDING' : 'FAILED',
    });
    return success ? 'CONFIRMED' : 'DECLINED';
  }

  if (attempt < maxAttempts) {
    // Throwing makes BullMQ retry the job after an exponential backoff.
    throw new StillPendingError(payment.external_ref);
  }

  const failureReason = `No confirmation from channel after ${maxAttempts} status checks`;
  const updated = await ctx.prisma.payment.updateMany({
    where: { payment_id: paymentId, status: 'AWAITING_CONFIRMATION' },
    data: { status: 'FAILED', failure_reason: failureReason },
  });
  if (updated.count === 0) return 'ALREADY_FINAL';

  await publishEvent(ctx.redis, {
    type: 'payment.updated',
    paymentId,
    payerId: payment.payer_id,
    externalRef: payment.external_ref,
    status: 'FAILED',
  });
  await raiseAlert(ctx, {
    type: 'PAYMENT_FAILED',
    severity: 'WARNING',
    dedupeKey: `PAYMENT_FAILED:${paymentId}`,
    message: `Payment ${payment.external_ref} failed: ${failureReason}`,
    data: { paymentId, externalRef: payment.external_ref },
  });
  await notifySupervisors(
    ctx,
    `Payment ${payment.external_ref} permanently failed`,
    `Payment ${payment.external_ref} (${payment.currency} ${payment.amount.toString()}) was marked FAILED: ${failureReason}. ` +
      'Please check with the channel before the payer is contacted.',
    { type: 'payment', id: String(paymentId) },
  );
  return 'PERMANENTLY_FAILED';
}
