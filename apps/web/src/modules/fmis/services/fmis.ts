import 'server-only';
import { compareTotals, type TotalsComparison } from '@ircub/core';
import { getConfig, JournalBatchStatus, type Prisma } from '@ircub/db';
import { getQueue, QUEUES, type FmisPostingJob } from '@ircub/platform';
import { audit } from '@/lib/audit';
import { prisma } from '@/lib/db';
import { DomainError, NotFoundError } from '@/lib/errors';
import { callMockService } from '@/lib/mock-services';
import { first, type PageRequest } from '@/lib/pagination';
import type { CurrentUser } from '@/lib/rbac';
import { redis } from '@/lib/redis';

export function parseBatchFilters(params: Record<string, string | string[] | undefined>) {
  const status = first(params.status);
  const date = first(params.date);
  return {
    status: (Object.values(JournalBatchStatus) as string[]).includes(status ?? '')
      ? (status as JournalBatchStatus)
      : undefined,
    date: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined,
  };
}

export async function listBatches(
  filters: ReturnType<typeof parseBatchFilters>,
  page: PageRequest,
) {
  const where: Prisma.JournalBatchWhereInput = {
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.date ? { business_date: new Date(`${filters.date}T00:00:00Z`) } : {}),
  };
  const [rows, total, counts] = await Promise.all([
    prisma.journalBatch.findMany({
      where,
      orderBy: [{ business_date: 'desc' }, { batch_id: 'desc' }],
      skip: page.skip,
      take: page.take,
      include: { _count: { select: { lines: true } } },
    }),
    prisma.journalBatch.count({ where }),
    prisma.journalBatch.groupBy({ by: ['status'], _count: true }),
  ]);
  const unposted = await prisma.payment.count({
    where: { status: 'DONE', fmis_status: 'NOT_POSTED', journal_line: null },
  });
  return {
    rows,
    total,
    counts: Object.fromEntries(counts.map((c) => [c.status, c._count])),
    unposted,
  };
}

async function enqueue(name: string, data: FmisPostingJob & { userId?: number }, jobId: string) {
  await getQueue(redis(), QUEUES.fmis).add(name, data, { jobId, attempts: 1 });
}

/** Queue posting of every unposted business day before today (same job as the nightly run). */
export async function postPendingNow(user: CurrentUser) {
  await enqueue('post-pending', {}, `fmis-manual-${Date.now()}`);
  await prisma.$transaction((tx) =>
    audit(tx, user, {
      action: 'FMIS_POSTING_REQUESTED',
      entityType: 'journal_batch',
      entityId: 'pending',
    }),
  );
  return { queued: true };
}

export async function retryBatch(batchId: number, user: CurrentUser) {
  const batch = await prisma.journalBatch.findUnique({ where: { batch_id: batchId } });
  if (!batch) throw new NotFoundError('Journal batch');
  if (batch.status !== 'FAILED' && batch.status !== 'PENDING')
    throw new DomainError(
      `Only FAILED or PENDING batches can be retried (this one is ${batch.status})`,
    );
  await enqueue('retry-batch', { batchId }, `fmis-retry-${batchId}-${Date.now()}`);
  await prisma.$transaction((tx) =>
    audit(tx, user, {
      action: 'FMIS_RETRY_REQUESTED',
      entityType: 'journal_batch',
      entityId: batchId,
    }),
  );
  return { batchId };
}

export async function requestBatchReversal(batchId: number, user: CurrentUser) {
  const batch = await prisma.journalBatch.findUnique({ where: { batch_id: batchId } });
  if (!batch) throw new NotFoundError('Journal batch');
  if (batch.status !== 'POSTED') throw new DomainError('Only POSTED batches can be reversed');
  await enqueue('reverse-batch', { batchId, userId: user.userId }, `fmis-reverse-${batchId}`);
  return { batchId };
}

/**
 * IRCUB vs FMIS totals per day and GL code (POC module 6).
 *
 * The IRCUB side is what SHOULD be in FMIS according to IRCUB's own records:
 *   + successful payments by the day they were paid (credit to the revenue GL, debit to the bank GL)
 *     - including payments reversed after they were posted, because the original posting stands
 *   - approved reversals of posted payments, on the day the reversal was approved
 * The FMIS side is what FMIS says it booked (GET /fmis/totals). Amounts are compared as the net
 * balance of each GL (credit minus debit for revenue GLs, debit minus credit for the bank GL).
 * Any difference is either not yet posted, a failed batch, or a genuine problem to investigate.
 */
export async function getFmisReconciliation(
  from: string,
  to: string,
): Promise<{
  rows: TotalsComparison[];
  bankGl: string;
  fmisAvailable: boolean;
}> {
  const bankGl = await getConfig(prisma, 'collection_bank_gl', '1101-000');
  const expected = await prisma.$queryRaw<
    { business_date: Date; gl_code: string; amount: Prisma.Decimal }[]
  >`
    WITH movements AS (
      SELECT p.paid_at::date AS business_date, rt.gl_code, p.amount_base AS amount
      FROM payment p JOIN revenue_type rt ON rt.revenue_code = p.revenue_code
      WHERE p.paid_at >= ${from}::date AND p.paid_at < ${to}::date + 1
        AND (p.status = 'DONE'
             OR (p.status = 'REVERSED' AND EXISTS (SELECT 1 FROM journal_line jl WHERE jl.payment_id = p.payment_id)))
      UNION ALL
      SELECT rv.decided_at::date, rt.gl_code, -p.amount_base
      FROM reversal rv
      JOIN payment p ON p.payment_id = rv.payment_id
      JOIN revenue_type rt ON rt.revenue_code = p.revenue_code
      WHERE rv.status = 'APPROVED'
        AND rv.decided_at >= ${from}::date AND rv.decided_at < ${to}::date + 1
        AND EXISTS (SELECT 1 FROM journal_line jl WHERE jl.payment_id = p.payment_id)
    )
    SELECT business_date, gl_code, SUM(amount) AS amount FROM movements GROUP BY 1, 2`;

  const ircub = expected.flatMap((r) => {
    const businessDate = r.business_date.toISOString().slice(0, 10);
    const amount = Number(r.amount);
    return [
      { businessDate, glCode: r.gl_code, amount },
      { businessDate, glCode: bankGl, amount },
    ];
  });

  let fmisAvailable = true;
  let fmis: { businessDate: string; glCode: string; amount: number }[] = [];
  try {
    const totals = await callMockService<
      { businessDate: string; glCode: string; debit: number; credit: number }[]
    >('GET', `/fmis/totals?from=${from}&to=${to}`, undefined, 'FMIS');
    fmis = totals.map((t) => ({
      businessDate: t.businessDate,
      glCode: t.glCode,
      amount: t.glCode === bankGl ? t.debit - t.credit : t.credit - t.debit,
    }));
  } catch {
    fmisAvailable = false;
  }
  return { rows: compareTotals(ircub, fmis), bankGl, fmisAvailable };
}

/** Drill-down: every payment behind one (day, GL) cell, with its journal line and batch. */
export async function getReconciliationDetail(date: string, glCode: string) {
  const dayStart = new Date(`${date}T00:00:00Z`);
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);
  const bankGl = await getConfig(prisma, 'collection_bank_gl', '1101-000');
  return prisma.payment.findMany({
    where: {
      paid_at: { gte: dayStart, lt: dayEnd },
      status: { in: ['DONE', 'REVERSED'] },
      ...(glCode === bankGl ? {} : { revenue_type: { gl_code: glCode } }),
    },
    orderBy: { payment_id: 'asc' },
    take: 500,
    include: { journal_line: { include: { batch: true } }, payer: { select: { full_name: true } } },
  });
}
