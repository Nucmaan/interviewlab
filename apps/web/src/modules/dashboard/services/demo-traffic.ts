import 'server-only';
import { roundMoney } from '@ircub/core';
import { audit } from '@/lib/audit';
import { prisma } from '@/lib/db';
import { DomainError } from '@/lib/errors';
import { callMockService } from '@/lib/mock-services';
import type { CurrentUser } from '@/lib/rbac';

/**
 * DEMO TOOL: asks the mock mobile money provider to pretend that `count` payers just paid their
 * open assessments / water bills with their control numbers. The provider then sends real signed
 * callbacks to /api/payments/callback, so the whole pipeline (callback -> queue -> worker ->
 * SSE -> dashboard) can be watched live during a presentation.
 */
export async function simulateTraffic(count: number, user: CurrentUser) {
  const assessments = await prisma.$queryRaw<{ control_number: string; outstanding: string }[]>`
    SELECT control_number, (amount_due + penalty_amount - amount_paid)::text AS outstanding
    FROM assessment WHERE status IN ('OPEN', 'PART_PAID') AND amount_due + penalty_amount > amount_paid
    ORDER BY random() LIMIT ${Math.ceil(count / 2)}`;
  // The latest bill of each account carries its arrears, so only latest bills are paid.
  const bills = await prisma.$queryRaw<{ control_number: string; outstanding: string }[]>`
    SELECT control_number, outstanding FROM (
      SELECT DISTINCT ON (account_no) control_number, status, total_due, amount_paid,
             (total_due - amount_paid)::text AS outstanding
      FROM water_bill WHERE status NOT IN ('HELD', 'CANCELLED')
      ORDER BY account_no, billing_month DESC
    ) latest
    WHERE status IN ('ISSUED', 'PART_PAID') AND total_due > amount_paid
    ORDER BY random() LIMIT ${Math.floor(count / 2)}`;
  const payments = [...assessments, ...bills].map((row) => ({
    control_number: row.control_number,
    amount: roundMoney(Number(row.outstanding)),
    currency: 'SOS' as const,
  }));
  if (payments.length === 0) throw new DomainError('There are no open assessments or bills to pay');
  await callMockService(
    'POST',
    '/simulate/callbacks',
    { channel: 'MOBILE_MONEY', payments },
    'The mobile money simulator',
  );
  await prisma.$transaction((tx) =>
    audit(tx, user, {
      action: 'DEMO_TRAFFIC_SIMULATED',
      entityType: 'system',
      entityId: 'demo',
      after: { count: payments.length },
    }),
  );
  return { queued: payments.length };
}
