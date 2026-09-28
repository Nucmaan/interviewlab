import 'server-only';
import { cacheAside, SUMMARY_TTL_SECONDS, summaryKey } from '@ircub/platform';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import { redis } from '@/lib/redis';

export interface RevenueDaySummary {
  revenueCode: string;
  date: string;
  paymentCount: number;
  totalBase: number;
  byChannel: { channel: string; count: number; total: number }[];
}

/**
 * Revenue summary for one revenue type on one day, read straight from the payment table so it
 * includes today's live collections (Part 1, System Performance).
 *
 * Cache-aside with key summary:{revenue_code}:{date}. The worker deletes the key whenever it posts
 * a payment for that revenue type and day (apps/worker/src/jobs/process-payment.ts), so users
 * never wait for the TTL to see a new payment; the TTL only protects against a missed delete.
 */
export async function getRevenueDaySummary(
  revenueCode: string,
  date: string,
): Promise<{ value: RevenueDaySummary; hit: boolean }> {
  return cacheAside(
    redis(),
    summaryKey(revenueCode, date),
    SUMMARY_TTL_SECONDS,
    async () => {
      const rows = await prisma.$queryRaw<{ channel: string; count: bigint; total: string }[]>`
        SELECT channel::text, COUNT(*)::bigint AS count, COALESCE(SUM(amount_base), 0)::text AS total
        FROM payment
        WHERE revenue_code = ${revenueCode}
          AND status = 'DONE'
          AND paid_at >= ${date}::date AND paid_at < ${date}::date + 1
        GROUP BY channel
        ORDER BY channel`;
      const byChannel = rows.map((r) => ({
        channel: r.channel,
        count: Number(r.count),
        total: Number(r.total),
      }));
      return {
        revenueCode,
        date,
        paymentCount: byChannel.reduce((s, c) => s + c.count, 0),
        totalBase: Math.round(byChannel.reduce((s, c) => s + c.total, 0) * 100) / 100,
        byChannel,
      };
    },
    logger,
  );
}

/** All active revenue types for a day; reports how many answers came from the cache. */
export async function getRevenueSummaryForDay(date: string) {
  const types = await prisma.revenueType.findMany({
    where: { is_active: true },
    orderBy: { revenue_code: 'asc' },
  });
  const results = await Promise.all(types.map((t) => getRevenueDaySummary(t.revenue_code, date)));
  return {
    date,
    cache: {
      hits: results.filter((r) => r.hit).length,
      misses: results.filter((r) => !r.hit).length,
    },
    revenueTypes: results.map((r, i) => ({ ...r.value, name: types[i]!.name })),
    totalBase: Math.round(results.reduce((s, r) => s + r.value.totalBase, 0) * 100) / 100,
  };
}
