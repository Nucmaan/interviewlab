/**
 * Pulls the latest exchange rates from the (mock) rates API and stores them. Payments use the
 * latest stored rate, so a slow rates API never blocks payment intake.
 */
import type { WorkerContext } from '../lib/context';

export async function refreshExchangeRates(ctx: WorkerContext): Promise<void> {
  const response = await ctx.mock.getRates();
  if (response.base !== 'SOS') {
    throw new Error(`Rates API returned base ${response.base}, expected SOS`);
  }
  const usd = response.rates.USD;
  if (typeof usd !== 'number' || !(usd > 0)) {
    throw new Error('Rates API returned no valid USD rate');
  }
  await ctx.prisma.exchangeRate.create({
    data: {
      currency: 'USD',
      rate_to_base: usd,
      source: 'mock-rates-api',
      fetched_at: new Date(response.timestamp),
    },
  });
  ctx.logger.info({ usd }, 'exchange rates refreshed');
}
