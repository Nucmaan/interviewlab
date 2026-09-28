import 'server-only';
import { applyPayment, assertCanApprove } from '@ircub/core';
import { toNumber } from '@ircub/db';
import {
  getQueue,
  invalidateSummaries,
  publishEvent,
  QUEUES,
  type SummaryJob,
} from '@ircub/platform';
import { audit } from '@/lib/audit';
import { prisma } from '@/lib/db';
import { DomainError, NotFoundError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import type { CurrentUser } from '@/lib/rbac';
import { redis } from '@/lib/redis';

/**
 * Payment reversals with segregation of duties (four-eyes principle):
 *   1. someone with reversals.request asks for a reversal, with a reason;
 *   2. a DIFFERENT person with reversals.approve approves or rejects it.
 * The rule is checked here (assertCanApprove) and again by the database CHECK constraint
 * reversal_four_eyes, so it holds even if this code is bypassed.
 */

export async function requestReversal(paymentId: number, reason: string, user: CurrentUser) {
  return prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({
      where: { payment_id: paymentId },
      include: { reversal: true },
    });
    if (!payment) throw new NotFoundError('Payment');
    if (payment.status !== 'DONE')
      throw new DomainError(
        `Only processed (DONE) payments can be reversed; this one is ${payment.status}`,
      );
    if (payment.reversal)
      throw new DomainError(
        `A reversal already exists for this payment (${payment.reversal.status})`,
      );
    const reversal = await tx.reversal.create({
      data: { payment_id: paymentId, reason, requested_by: user.userId },
    });
    await audit(tx, user, {
      action: 'REVERSAL_REQUESTED',
      entityType: 'payment',
      entityId: paymentId,
      after: { reversalId: reversal.reversal_id, reason },
    });
    return { reversalId: reversal.reversal_id };
  });
}

export async function decideReversal(
  reversalId: number,
  approve: boolean,
  note: string | undefined,
  user: CurrentUser,
) {
  const result = await prisma.$transaction(async (tx) => {
    // Lock the reversal and the payment so two supervisors cannot decide at the same time.
    await tx.$queryRaw`SELECT 1 FROM reversal WHERE reversal_id = ${reversalId} FOR UPDATE`;
    const reversal = await tx.reversal.findUnique({
      where: { reversal_id: reversalId },
      include: { payment: true },
    });
    if (!reversal) throw new NotFoundError('Reversal');
    if (reversal.status !== 'PENDING_APPROVAL')
      throw new DomainError(`This reversal was already ${reversal.status.toLowerCase()}`);
    assertCanApprove(reversal.requested_by, user.userId);

    const payment = reversal.payment;
    await tx.reversal.update({
      where: { reversal_id: reversalId },
      data: {
        status: approve ? 'APPROVED' : 'REJECTED',
        decided_by: user.userId,
        decided_at: new Date(),
        decision_note: note ?? null,
      },
    });

    if (approve) {
      await tx.$queryRaw`SELECT 1 FROM payment WHERE payment_id = ${payment.payment_id} FOR UPDATE`;
      const amount = toNumber(payment.amount_base);
      await tx.payment.update({
        where: { payment_id: payment.payment_id },
        data: { status: 'REVERSED' },
      });
      // Take the money back off whatever the payment paid for.
      if (payment.assessment_id !== null) {
        const a = await tx.assessment.findUniqueOrThrow({
          where: { assessment_id: payment.assessment_id },
        });
        const settled = applyPayment(
          {
            totalDue: toNumber(a.amount_due) + toNumber(a.penalty_amount),
            amountPaid: toNumber(a.amount_paid),
          },
          -amount,
        );
        await tx.assessment.update({
          where: { assessment_id: a.assessment_id },
          data: { amount_paid: settled.amountPaid, status: settled.status },
        });
      } else if (payment.bill_id !== null) {
        const bill = await tx.waterBill.findUniqueOrThrow({ where: { bill_id: payment.bill_id } });
        const settled = applyPayment(
          { totalDue: toNumber(bill.total_due), amountPaid: toNumber(bill.amount_paid) },
          -amount,
        );
        const status =
          bill.status === 'CARRIED_FORWARD'
            ? bill.status
            : settled.status === 'OPEN'
              ? 'ISSUED'
              : settled.status;
        await tx.waterBill.update({
          where: { bill_id: bill.bill_id },
          data: { amount_paid: settled.amountPaid, status },
        });
      }
    }
    await audit(tx, user, {
      action: approve ? 'REVERSAL_APPROVED' : 'REVERSAL_REJECTED',
      entityType: 'payment',
      entityId: payment.payment_id,
      before: { paymentStatus: payment.status, reversalStatus: 'PENDING_APPROVAL' },
      after: {
        paymentStatus: approve ? 'REVERSED' : payment.status,
        reversalStatus: approve ? 'APPROVED' : 'REJECTED',
        note,
      },
    });
    return { payment, approve };
  });

  if (result.approve) {
    // After commit: fresh numbers for reports, the reversal-spike alert check, and live screens.
    const { payment } = result;
    const today = new Date().toISOString().slice(0, 10);
    const paidDay = payment.paid_at.toISOString().slice(0, 10);
    try {
      await invalidateSummaries(redis(), [{ revenueCode: payment.revenue_code, date: paidDay }]);
      const data: SummaryJob = { dates: [...new Set([paidDay, today])] };
      await getQueue(redis(), QUEUES.summaries).add('refresh', data);
      await publishEvent(redis(), {
        type: 'payment.updated',
        paymentId: payment.payment_id,
        payerId: payment.payer_id,
        externalRef: payment.external_ref,
        status: 'REVERSED',
      });
    } catch (error) {
      logger.warn(
        { err: error },
        'post-reversal notifications failed; nightly refresh will catch up',
      );
    }
  }
  return { reversalId };
}
