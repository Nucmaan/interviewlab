/**
 * Cache-aside for revenue summary reports (Part 1, System Performance).
 *
 * Read:  look in Redis first; on a miss, load from PostgreSQL and store the result with a TTL.
 * Write: when a payment is posted, delete the keys it affects (summary:{revenue_code}:{date}),
 *        so the next read reloads fresh numbers.
 * The TTL is a safety net: if an invalidation is ever missed (e.g. Redis briefly unreachable),
 * a stale value still expires within a few minutes.
 */
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';

export const SUMMARY_TTL_SECONDS = 300;

/** Key for one revenue type on one day, e.g. summary:BL:2026-03-01 */
export function summaryKey(revenueCode: string, date: string): string {
  return `summary:${revenueCode}:${date}`;
}

export async function cacheAside<T>(
  redis: Redis,
  key: string,
  ttlSeconds: number,
  load: () => Promise<T>,
  logger?: Logger,
): Promise<{ value: T; hit: boolean }> {
  try {
    const cached = await redis.get(key);
    if (cached !== null) {
      return { value: JSON.parse(cached) as T, hit: true };
    }
  } catch (error) {
    // Redis being down must not take reports down: fall through to the database.
    logger?.warn({ err: error, key }, 'cache read failed, loading from database');
  }

  const value = await load();
  try {
    await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  } catch (error) {
    logger?.warn({ err: error, key }, 'cache write failed');
  }
  return { value, hit: false };
}

/** Deletes the summary keys for the (revenue code, date) pairs touched by posted payments. */
export async function invalidateSummaries(
  redis: Redis,
  entries: readonly { revenueCode: string; date: string }[],
): Promise<number> {
  const keys = [...new Set(entries.map((e) => summaryKey(e.revenueCode, e.date)))];
  if (keys.length === 0) return 0;
  return redis.del(...keys);
}
