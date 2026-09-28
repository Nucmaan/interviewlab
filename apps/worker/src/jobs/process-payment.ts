/**
 * Applies one payment to its assessment or water bill (Part 1, Data Validation & Concurrency).
 *
 * Several worker processes, each running several jobs at once, consume the payment queues. Three
 * things together guarantee a payment is never processed twice:
 *
 *   1. UNIQUE(external_ref) on payment - the same channel payment can never be stored twice.
 *   2. SELECT ... FOR UPDATE SKIP LOCKED - when two workers try to claim the same row at the same
 *      moment, one gets it and the other skips it immediately (no waiting, no double claim).
 *   3. Status transitions PENDING -> PROCESSING -> DONE with conditional updates:
 *        - the claim only succeeds WHERE status = 'PENDING' (so a finished payment is never
 *          picked up again, even if its job is delivered twice);
 *        - the money is applied and the status set to DONE in ONE transaction, WHERE
 *          status = 'PROCESSING'. Either both happen or neither does.
 *
 * If a worker crashes between claim and apply, the row stays PROCESSING; the maintenance job
 * puts it back to PENDING after a timeout (safe, because DONE was never committed).
 */
import { applyPayment } from '@ircub/core';
import { recordAudit, toNumber } from '@ircub/db';
import {
  getQueue,
  invalidateSummaries,
  publishEvent,
  QUEUES,
  type SummaryJob,
} from '@ircub/platform';
import type { WorkerContext } from '../lib/context';

export type ProcessOutcome = 'DONE' | 'SKIPPED';

export async function processPayment(
  ctx: WorkerContext,
  paymentId: number,
): Promise<ProcessOutcome> {
  const { prisma } = ctx;

  // Step 1 - claim the payment (its own short transaction).
  const claimed = await prisma.$queryRaw<{ payment_id: number }[]>`
    UPDATE payment
       SET status = 'PROCESSING', processing_started_at = now()
     WHERE payment_id = (
             SELECT payment_id FROM payment
              WHERE payment_id = ${paymentId} AND status = 'PENDING'
              FOR UPDATE SKIP LOCKED
           )
    RETURNING payment_id`;
  if (claimed.length === 0) {
    ctx.logger.debug({ paymentId }, 'payment already claimed or processed - skipping');
    return 'SKIPPED';
  }

  // Step 2 - apply the money and mark DONE atomically.
  const payment = await prisma.$transaction(async (tx) => {
    const p = await tx.payment.findUniqueOrThrow({ where: { payment_id: paymentId } });
    const amountBase = toNumber(p.amount_base);
    let appliedTo: Record<string, unknown> = {};

    if (p.assessment_id !== null) {
      // Lock the assessment so two payments for it cannot overwrite each other's amount_paid.
      await tx.$queryRaw`SELECT 1 FROM assessment WHERE assessment_id = ${p.assessment_id} FOR UPDATE`;
      const a = await tx.assessment.findUniqueOrThrow({
        where: { assessment_id: p.assessment_id },
      });
      const result = applyPayment(
        {
          totalDue: toNumber(a.amount_due) + toNumber(a.penalty_amount),
          amountPaid: toNumber(a.amount_paid),
        },
        amountBase,
      );
      await tx.assessment.update({
        where: { assessment_id: a.assessment_id },
        data: { amount_paid: result.amountPaid, status: result.status },
      });
      appliedTo = {
        assessmentId: a.assessment_id,
        status: result.status,
        overpayment: result.overpayment,
      };
    } else if (p.bill_id !== null) {
      await tx.$queryRaw`SELECT 1 FROM water_bill WHERE bill_id = ${p.bill_id} FOR UPDATE`;
      const bill = await tx.waterBill.findUniqueOrThrow({ where: { bill_id: p.bill_id } });
      const result = applyPayment(
        { totalDue: toNumber(bill.total_due), amountPaid: toNumber(bill.amount_paid) },
        amountBase,
      );
      // A bill that was carried into a newer bill keeps that status; the newer bill shows the balance.
      const status =
        bill.status === 'CARRIED_FORWARD'
          ? bill.status
          : result.status === 'OPEN'
            ? 'ISSUED'
            : result.status;
      await tx.waterBill.update({
        where: { bill_id: bill.bill_id },
        data: { amount_paid: result.amountPaid, status },
      });
      appliedTo = { billId: bill.bill_id, status, overpayment: result.overpayment };
    }

    const done = await tx.payment.updateMany({
      where: { payment_id: paymentId, status: 'PROCESSING' },
      data: { status: 'DONE', processed_at: new Date(), failure_reason: null },
    });
    if (done.count !== 1) {
      // Someone reset the row (e.g. the maintenance job) - roll everything back.
      throw new Error(`Payment ${paymentId} left PROCESSING during apply`);
    }
    await recordAudit(tx, {
      actorUserId: null,
      action: 'PAYMENT_PROCESSED',
      entityType: 'payment',
      entityId: paymentId,
      before: { status: 'PROCESSING' },
      after: { status: 'DONE', amountBase, ...appliedTo },
    });
    return p;
  });

  // Step 3 - side effects after commit (never inside the transaction).
  const day = payment.paid_at.toISOString().slice(0, 10);
  await invalidateSummaries(ctx.redis, [{ revenueCode: payment.revenue_code, date: day }]);
  await scheduleSummaryRefresh(ctx, [day]);
  await publishEvent(ctx.redis, {
    type: 'payment.updated',
    paymentId,
    payerId: payment.payer_id,
    externalRef: payment.external_ref,
    status: 'DONE',
  });
  return 'DONE';
}

/** Undo a claim so the job can be retried (used when the apply step throws). */
export async function releaseClaim(ctx: WorkerContext, paymentId: number): Promise<void> {
  await ctx.prisma.payment.updateMany({
    where: { payment_id: paymentId, status: 'PROCESSING' },
    data: { status: 'PENDING', processing_started_at: null },
  });
}

/** After the last retry: mark the payment FAILED so it shows up for manual review. */
export async function markFailed(
  ctx: WorkerContext,
  paymentId: number,
  reason: string,
): Promise<void> {
  const updated = await ctx.prisma.payment.updateMany({
    where: { payment_id: paymentId, status: { in: ['PENDING', 'PROCESSING'] } },
    data: { status: 'FAILED', failure_reason: reason.slice(0, 500) },
  });
  if (updated.count > 0) {
    const p = await ctx.prisma.payment.findUniqueOrThrow({ where: { payment_id: paymentId } });
    await publishEvent(ctx.redis, {
      type: 'payment.updated',
      paymentId,
      payerId: p.payer_id,
      externalRef: p.external_ref,
      status: 'FAILED',
    });
  }
}

/**
 * Debounced refresh of daily_summary: many payments for the same day inside a 5-second window
 * share one job (same job id), instead of recomputing the day once per payment.
 */
export async function scheduleSummaryRefresh(ctx: WorkerContext, dates: string[]): Promise<void> {
  const bucket = Math.floor(Date.now() / 5000);
  const unique = [...new Set(dates)].sort();
  const data: SummaryJob = { dates: unique };
  await getQueue(ctx.redis, QUEUES.summaries).add('refresh', data, {
    jobId: `summary-${unique.join('_')}-${bucket}`,
    delay: 3000,
  });
}
