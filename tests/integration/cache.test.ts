import { cacheAside, invalidateSummaries, summaryKey } from '@ircub/platform';
import { processPayment } from '@ircub/worker/jobs/process-payment';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { baseFixtures, ref, resetDatabase, testContext } from './helpers';

const ctx = testContext();

describe('cache-aside revenue summaries', () => {
  beforeEach(async () => {
    await ctx.redis.flushdb();
  });
  afterAll(async () => {
    await ctx.prisma.$disconnect();
    ctx.redis.disconnect();
  });

  it('loads on a miss, serves the next read from Redis, and reloads after invalidation', async () => {
    let loads = 0;
    const load = async () => ({ total: ++loads });
    const key = summaryKey('BL', '2026-03-01');

    expect(await cacheAside(ctx.redis, key, 60, load)).toEqual({ value: { total: 1 }, hit: false });
    expect(await cacheAside(ctx.redis, key, 60, load)).toEqual({ value: { total: 1 }, hit: true });
    expect(await ctx.redis.ttl(key)).toBeGreaterThan(0);

    await invalidateSummaries(ctx.redis, [{ revenueCode: 'BL', date: '2026-03-01' }]);
    expect(await cacheAside(ctx.redis, key, 60, load)).toEqual({ value: { total: 2 }, hit: false });
  });

  it('posting a payment deletes exactly the key for its revenue type and day', async () => {
    await resetDatabase(ctx.prisma);
    const { payerId } = await baseFixtures(ctx.prisma);
    await ctx.redis.set(summaryKey('BL', '2026-03-01'), '{}');
    await ctx.redis.set(summaryKey('BL', '2026-03-02'), '{}');
    await ctx.redis.set(summaryKey('WTR', '2026-03-01'), '{}');
    const payment = await ctx.prisma.payment.create({
      data: {
        payer_id: payerId,
        revenue_code: 'BL',
        amount: 5,
        currency: 'SOS',
        amount_base: 5,
        channel: 'CASH',
        external_ref: ref('CACHE'),
        paid_at: new Date('2026-03-01T08:00:00Z'),
        source: 'COUNTER',
      },
    });

    expect(await processPayment(ctx, payment.payment_id)).toBe('DONE');
    expect(await ctx.redis.exists(summaryKey('BL', '2026-03-01'))).toBe(0);
    expect(await ctx.redis.exists(summaryKey('BL', '2026-03-02'))).toBe(1);
    expect(await ctx.redis.exists(summaryKey('WTR', '2026-03-01'))).toBe(1);
  });
});
