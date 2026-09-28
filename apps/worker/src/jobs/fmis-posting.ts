/**
 * FMIS posting service (Part 1, FMIS Posting Integration; POC module 6).
 *
 *  1. Group the day's successful (DONE) collections by revenue type and map each to its GL code:
 *     credit the revenue GL, debit the collection bank account (buildDailyJournal in @ircub/core).
 *  2. Check debits = credits before anything is sent (in core, again before posting, and a CHECK
 *     constraint on journal_batch).
 *  3. POST the journal to the (mock) FMIS REST API and store the FMIS reference.
 *  4. On failure retry with exponential backoff (1s, 2s, 4s by default), at most 3 attempts; then
 *     mark the batch FAILED and raise an alert for manual review.
 *
 * A payment can never be posted twice: journal_line has UNIQUE(payment_id), payments are picked
 * with FOR UPDATE SKIP LOCKED, and only payments without a journal line are selected. The batch
 * reference sent to FMIS (IRCUB-JB-<id>) lets FMIS ignore a repeated post of the same batch if our
 * first attempt timed out after FMIS had already saved it.
 */
import {
  assertBalanced,
  buildDailyJournal,
  buildReversalJournal,
  exponentialBackoffMs,
  summariseByGl,
  type JournalDraft,
  type JournalPayment,
} from '@ircub/core';
import { getConfig, recordAudit, toNumber, type Prisma } from '@ircub/db';
import { publishEvent } from '@ircub/platform';
import type { WorkerContext } from '../lib/context';
import { raiseAlert } from './summaries';

export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
}

export const DEFAULT_RETRY: RetryPolicy = { maxAttempts: 3, baseDelayMs: 1000 };

export interface PostingResult {
  batchId: number;
  status: 'POSTED' | 'FAILED';
  fmisReference: string | null;
  attempts: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type PaymentRow = {
  payment_id: number;
  revenue_code: string;
  gl_code: string;
  amount_base: Prisma.Decimal;
};

function toJournalPayments(rows: PaymentRow[]): JournalPayment[] {
  return rows.map((r) => ({
    paymentId: r.payment_id,
    revenueCode: r.revenue_code,
    glCode: r.gl_code,
    amountBase: toNumber(r.amount_base),
  }));
}

async function createBatch(
  tx: Prisma.TransactionClient,
  draft: JournalDraft,
  type: 'COLLECTION' | 'REVERSAL',
): Promise<number> {
  const batch = await tx.journalBatch.create({
    data: {
      business_date: new Date(`${draft.businessDate}T00:00:00Z`),
      batch_type: type,
      status: 'PENDING',
      total_debit: draft.totalDebit,
      total_credit: draft.totalCredit,
      lines: {
        create: draft.lines.map((line) => ({
          payment_id: type === 'COLLECTION' ? line.paymentId : null,
          reversal_of_payment_id: type === 'REVERSAL' ? line.paymentId : null,
          gl_code: line.glCode,
          revenue_code: line.revenueCode,
          debit: line.debit,
          credit: line.credit,
          description: line.description,
        })),
      },
    },
  });
  await recordAudit(tx, {
    actorUserId: null,
    action: 'JOURNAL_BATCH_CREATED',
    entityType: 'journal_batch',
    entityId: batch.batch_id,
    after: {
      businessDate: draft.businessDate,
      type,
      totalDebit: draft.totalDebit,
      lines: draft.lines.length,
    },
  });
  return batch.batch_id;
}

/** Builds and posts the collection journal for one business day. Returns null if nothing to post. */
export async function postBusinessDay(
  ctx: WorkerContext,
  businessDate: string,
  retry: RetryPolicy = DEFAULT_RETRY,
): Promise<PostingResult | null> {
  const bankGl = await getConfig(ctx.prisma, 'collection_bank_gl', '1101-000');
  const batchId = await ctx.prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<PaymentRow[]>`
      SELECT p.payment_id, p.revenue_code, rt.gl_code, p.amount_base
      FROM payment p
      JOIN revenue_type rt ON rt.revenue_code = p.revenue_code
      WHERE p.status = 'DONE'
        AND p.fmis_status = 'NOT_POSTED'
        AND p.paid_at >= ${businessDate}::date
        AND p.paid_at <  ${businessDate}::date + 1
        AND NOT EXISTS (SELECT 1 FROM journal_line jl WHERE jl.payment_id = p.payment_id)
      ORDER BY p.payment_id
      FOR UPDATE OF p SKIP LOCKED`;
    if (rows.length === 0) return null;
    return createBatch(
      tx,
      buildDailyJournal(businessDate, toJournalPayments(rows), bankGl),
      'COLLECTION',
    );
  });
  return batchId === null ? null : sendBatch(ctx, batchId, retry);
}

/** Approved reversals of payments that were already posted become a REVERSAL journal. */
export async function postReversals(
  ctx: WorkerContext,
  retry: RetryPolicy = DEFAULT_RETRY,
): Promise<PostingResult[]> {
  const bankGl = await getConfig(ctx.prisma, 'collection_bank_gl', '1101-000');
  const days = await ctx.prisma.$queryRaw<{ day: Date }[]>`
    SELECT DISTINCT rv.decided_at::date AS day
    FROM reversal rv JOIN payment p ON p.payment_id = rv.payment_id
    WHERE rv.status = 'APPROVED' AND p.fmis_status = 'POSTED'
      AND NOT EXISTS (SELECT 1 FROM journal_line jl WHERE jl.reversal_of_payment_id = p.payment_id)
    ORDER BY day`;
  const results: PostingResult[] = [];
  for (const { day } of days) {
    const businessDate = day.toISOString().slice(0, 10);
    const batchId = await ctx.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<PaymentRow[]>`
        SELECT p.payment_id, p.revenue_code, rt.gl_code, p.amount_base
        FROM reversal rv
        JOIN payment p ON p.payment_id = rv.payment_id
        JOIN revenue_type rt ON rt.revenue_code = p.revenue_code
        WHERE rv.status = 'APPROVED' AND p.fmis_status = 'POSTED'
          AND rv.decided_at >= ${businessDate}::date AND rv.decided_at < ${businessDate}::date + 1
          AND NOT EXISTS (SELECT 1 FROM journal_line jl WHERE jl.reversal_of_payment_id = p.payment_id)
        FOR UPDATE OF p SKIP LOCKED`;
      if (rows.length === 0) return null;
      return createBatch(
        tx,
        buildReversalJournal(businessDate, toJournalPayments(rows), bankGl),
        'REVERSAL',
      );
    });
    if (batchId !== null) results.push(await sendBatch(ctx, batchId, retry));
  }
  return results;
}

/** Sends a PENDING or FAILED batch to FMIS with retries. Also used for manual "retry" clicks. */
export async function sendBatch(
  ctx: WorkerContext,
  batchId: number,
  retry: RetryPolicy = DEFAULT_RETRY,
): Promise<PostingResult> {
  const batch = await ctx.prisma.journalBatch.findUniqueOrThrow({
    where: { batch_id: batchId },
    include: { lines: true },
  });
  if (batch.status === 'POSTED' || batch.status === 'REVERSED') {
    return {
      batchId,
      status: 'POSTED',
      fmisReference: batch.fmis_reference,
      attempts: batch.attempts,
    };
  }
  const lines = batch.lines.map((l) => ({
    paymentId: l.payment_id ?? l.reversal_of_payment_id,
    glCode: l.gl_code,
    revenueCode: l.revenue_code,
    debit: toNumber(l.debit),
    credit: toNumber(l.credit),
    description: l.description,
  }));
  assertBalanced(lines); // never send an unbalanced journal, even if data was changed by hand
  const businessDate = batch.business_date.toISOString().slice(0, 10);
  const request = {
    batchRef: `IRCUB-JB-${batch.batch_id}`,
    businessDate,
    journalType: batch.batch_type,
    lines: summariseByGl(lines),
  };

  let lastError = 'unknown error';
  for (let attempt = 1; attempt <= retry.maxAttempts; attempt++) {
    try {
      const { fmisReference } = await ctx.mock.postJournal(request);
      const paymentIds = lines.flatMap((l) => (l.paymentId === null ? [] : [l.paymentId]));
      await ctx.prisma.$transaction(async (tx) => {
        await tx.journalBatch.update({
          where: { batch_id: batchId },
          data: {
            status: 'POSTED',
            fmis_reference: fmisReference,
            posted_at: new Date(),
            attempts: { increment: 1 },
            last_error: null,
          },
        });
        await tx.payment.updateMany({
          where: { payment_id: { in: paymentIds } },
          data: { fmis_status: batch.batch_type === 'REVERSAL' ? 'REVERSED' : 'POSTED' },
        });
        await recordAudit(tx, {
          actorUserId: null,
          action: 'JOURNAL_BATCH_POSTED',
          entityType: 'journal_batch',
          entityId: batchId,
          before: { status: batch.status },
          after: { status: 'POSTED', fmisReference, attempt },
        });
      });
      await publishEvent(ctx.redis, {
        type: 'fmis.batch',
        batchId,
        status: 'POSTED',
        businessDate,
      });
      ctx.logger.info({ batchId, businessDate, fmisReference, attempt }, 'journal posted to FMIS');
      return { batchId, status: 'POSTED', fmisReference, attempts: attempt };
    } catch (error) {
      lastError = (error as Error).message;
      await ctx.prisma.journalBatch.update({
        where: { batch_id: batchId },
        data: { attempts: { increment: 1 }, last_error: lastError.slice(0, 500) },
      });
      ctx.logger.warn({ batchId, attempt, err: lastError }, 'FMIS posting attempt failed');
      if (attempt < retry.maxAttempts)
        await sleep(exponentialBackoffMs(attempt, retry.baseDelayMs));
    }
  }

  await ctx.prisma.$transaction(async (tx) => {
    await tx.journalBatch.update({ where: { batch_id: batchId }, data: { status: 'FAILED' } });
    await recordAudit(tx, {
      actorUserId: null,
      action: 'JOURNAL_BATCH_FAILED',
      entityType: 'journal_batch',
      entityId: batchId,
      after: { status: 'FAILED', lastError },
    });
  });
  await raiseAlert(ctx, {
    type: 'FMIS_POSTING_FAILED',
    severity: 'CRITICAL',
    dedupeKey: `FMIS_POSTING_FAILED:${batchId}:${batch.attempts + retry.maxAttempts}`,
    message: `FMIS posting failed for batch #${batchId} (${businessDate}) after ${retry.maxAttempts} attempts`,
    data: { batchId, businessDate, lastError },
  });
  await publishEvent(ctx.redis, { type: 'fmis.batch', batchId, status: 'FAILED', businessDate });
  return { batchId, status: 'FAILED', fmisReference: null, attempts: retry.maxAttempts };
}

/** Posts every day before today that still has unposted collections (nightly job and backfill). */
export async function postAllPendingDays(
  ctx: WorkerContext,
  retry: RetryPolicy = DEFAULT_RETRY,
): Promise<PostingResult[]> {
  const days = await ctx.prisma.$queryRaw<{ day: Date }[]>`
    SELECT DISTINCT p.paid_at::date AS day
    FROM payment p
    WHERE p.status = 'DONE' AND p.fmis_status = 'NOT_POSTED' AND p.paid_at < current_date
      AND NOT EXISTS (SELECT 1 FROM journal_line jl WHERE jl.payment_id = p.payment_id)
    ORDER BY day`;
  ctx.logger.info({ days: days.length }, 'posting pending business days to FMIS');
  const results: PostingResult[] = [];
  for (const { day } of days) {
    const result = await postBusinessDay(ctx, day.toISOString().slice(0, 10), retry);
    if (result) results.push(result);
  }
  results.push(...(await postReversals(ctx, retry)));
  return results;
}

/** Reverses a whole POSTED batch in FMIS (e.g. posted to the wrong period). */
export async function reverseBatch(
  ctx: WorkerContext,
  batchId: number,
  userId: number | null,
): Promise<void> {
  const batch = await ctx.prisma.journalBatch.findUniqueOrThrow({
    where: { batch_id: batchId },
    include: { lines: true },
  });
  if (batch.status !== 'POSTED' || !batch.fmis_reference) {
    throw new Error(`Only a POSTED batch can be reversed (batch ${batchId} is ${batch.status})`);
  }
  await ctx.mock.reverseJournal(batch.fmis_reference);
  const paymentIds = batch.lines.flatMap((l) => (l.payment_id === null ? [] : [l.payment_id]));
  await ctx.prisma.$transaction(async (tx) => {
    await tx.journalBatch.update({ where: { batch_id: batchId }, data: { status: 'REVERSED' } });
    await tx.payment.updateMany({
      where: { payment_id: { in: paymentIds } },
      data: { fmis_status: 'REVERSED' },
    });
    await recordAudit(tx, {
      actorUserId: userId,
      action: 'JOURNAL_BATCH_REVERSED',
      entityType: 'journal_batch',
      entityId: batchId,
      before: { status: 'POSTED' },
      after: { status: 'REVERSED' },
    });
  });
  await publishEvent(ctx.redis, {
    type: 'fmis.batch',
    batchId,
    status: 'REVERSED',
    businessDate: batch.business_date.toISOString().slice(0, 10),
  });
}
