/**
 * Self-healing housekeeping, run every minute:
 *  - PROCESSING rows older than 5 minutes belong to a crashed worker: put them back to PENDING
 *    (safe - DONE is only set in the same transaction that applies the money).
 *  - PENDING rows older than 2 minutes may have lost their queue job (e.g. Redis was down when
 *    they were received): queue them again. The job id dedupes, so this never double-queues.
 *  - Idempotency keys older than 7 days are deleted.
 */
import { enqueuePayments } from '@ircub/platform';
import type { WorkerContext } from '../lib/context';

export async function runMaintenance(ctx: WorkerContext): Promise<void> {
  const reset = await ctx.prisma.$executeRaw`
    UPDATE payment SET status = 'PENDING', processing_started_at = NULL
    WHERE status = 'PROCESSING' AND processing_started_at < now() - interval '5 minutes'`;

  const orphans = await ctx.prisma.$queryRaw<{ payment_id: number; category: 'TAX' | 'WATER' }[]>`
    SELECT p.payment_id, rt.category::text AS category
    FROM payment p JOIN revenue_type rt ON rt.revenue_code = p.revenue_code
    WHERE p.status = 'PENDING' AND p.created_at < now() - interval '2 minutes'
    LIMIT 5000`;
  if (orphans.length > 0) {
    await enqueuePayments(
      ctx.redis,
      orphans.map((o) => ({ paymentId: o.payment_id, category: o.category })),
    );
  }

  const expired = await ctx.prisma.$executeRaw`
    DELETE FROM idempotency_key WHERE created_at < now() - interval '7 days'`;

  if (reset > 0 || orphans.length > 0 || expired > 0) {
    ctx.logger.info({ reset, requeued: orphans.length, expiredKeys: expired }, 'maintenance done');
  }
}
