import 'server-only';
import { buildStatement, type StatementEntry } from '@ircub/core';
import { getQueue, QUEUES, type BillingJob, type NotificationJob } from '@ircub/platform';
import { audit } from '@/lib/audit';
import { prisma } from '@/lib/db';
import { DomainError, NotFoundError } from '@/lib/errors';
import type { CurrentUser } from '@/lib/rbac';
import { redis } from '@/lib/redis';

/** Starts (or re-runs) the billing cycle for a month. The worker does the actual billing. */
export async function startBillingCycle(billingMonth: string, user: CurrentUser) {
  const month = new Date(`${billingMonth}-01T00:00:00Z`);
  const now = new Date();
  if (month > new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))) {
    throw new DomainError('You cannot bill a future month');
  }
  const cycle = await prisma.$transaction(async (tx) => {
    const existing = await tx.billingCycle.findUnique({ where: { billing_month: month } });
    if (existing?.status === 'RUNNING') throw new DomainError('This month is already being billed');
    // Re-running a COMPLETED or FAILED cycle only bills accounts that have no bill yet.
    const c = existing
      ? await tx.billingCycle.update({
          where: { cycle_id: existing.cycle_id },
          data: {
            status: 'RUNNING',
            error: null,
            run_by: user.userId,
            started_at: new Date(),
            completed_at: null,
          },
        })
      : await tx.billingCycle.create({ data: { billing_month: month, run_by: user.userId } });
    await audit(tx, user, {
      action: 'BILLING_CYCLE_STARTED',
      entityType: 'billing_cycle',
      entityId: c.cycle_id,
      after: { billingMonth },
    });
    return c;
  });
  const data: BillingJob = { cycleId: cycle.cycle_id };
  await getQueue(redis(), QUEUES.billing).add('run', data, { attempts: 1 });
  return { cycleId: cycle.cycle_id };
}

/** Releases a bill that was held for abnormal consumption, and notifies the customer. */
export async function releaseBill(billId: number, user: CurrentUser) {
  const notificationIds = await prisma.$transaction(async (tx) => {
    const bill = await tx.waterBill.findUnique({
      where: { bill_id: billId },
      include: { account: { include: { payer: true } } },
    });
    if (!bill) throw new NotFoundError('Bill');
    if (bill.status !== 'HELD')
      throw new DomainError(`Only held bills can be released (this bill is ${bill.status})`);
    await tx.waterBill.update({
      where: { bill_id: billId },
      data: { status: 'ISSUED', released_by: user.userId, released_at: new Date() },
    });
    await audit(tx, user, {
      action: 'BILL_RELEASED',
      entityType: 'water_bill',
      entityId: billId,
      before: { status: 'HELD', holdReason: bill.hold_reason },
      after: { status: 'ISSUED' },
    });
    const text = `IRCUB Water: bill ${bill.billing_month.toISOString().slice(0, 7)} for ${bill.account_no}: SOS ${bill.total_due.toString()} due ${bill.due_date.toISOString().slice(0, 10)}. Pay with reference ${bill.control_number}.`;
    const ids: number[] = [];
    const payer = bill.account.payer;
    for (const [channel, recipient] of [
      ['SMS', payer.phone],
      ['EMAIL', payer.email],
    ] as const) {
      if (!recipient) continue;
      const n = await tx.notification.create({
        data: {
          channel,
          recipient,
          subject: channel === 'EMAIL' ? 'Your water bill' : null,
          body: text,
          related_type: 'water_bill',
          related_id: String(billId),
        },
      });
      ids.push(n.notification_id);
    }
    return ids;
  });
  for (const notificationId of notificationIds) {
    const data: NotificationJob = { notificationId };
    await getQueue(redis(), QUEUES.notifications).add('send', data, {
      jobId: `notification-${notificationId}`,
    });
  }
  return { billId };
}

/** Customer statement: every bill and payment for an account, with a running balance. */
export async function getAccountStatement(accountNo: string) {
  const account = await prisma.waterAccount.findUnique({
    where: { account_no: accountNo },
    include: {
      payer: true,
      bills: { orderBy: { billing_month: 'asc' }, include: { payments: true } },
      readings: { orderBy: { reading_date: 'desc' }, take: 12 },
    },
  });
  if (!account) return null;

  const entries: StatementEntry[] = [];
  for (const bill of account.bills) {
    if (bill.status === 'HELD' || bill.status === 'CANCELLED') continue;
    entries.push({
      date: bill.created_at,
      type: 'BILL',
      reference: bill.control_number,
      description: `Bill ${bill.billing_month.toISOString().slice(0, 7)} · ${bill.consumption_m3} m³${bill.is_estimated ? ' (estimated)' : ''}`,
      amount: Number(bill.amount_billed),
    });
    for (const p of bill.payments) {
      if (p.status !== 'DONE' && p.status !== 'REVERSED') continue;
      entries.push({
        date: p.paid_at,
        type: 'PAYMENT',
        reference: p.external_ref,
        description: `Payment · ${p.channel.replace('_', ' ')} · ${p.currency} ${p.amount.toString()}`,
        amount: Number(p.amount_base),
      });
      if (p.status === 'REVERSED') {
        entries.push({
          date: p.paid_at,
          type: 'REVERSAL',
          reference: p.external_ref,
          description: 'Payment reversed',
          amount: Number(p.amount_base),
        });
      }
    }
  }
  return { account, statement: buildStatement(entries) };
}
