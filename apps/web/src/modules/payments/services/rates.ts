import 'server-only';
import type { Currency } from '@ircub/core';
import { prisma } from '@/lib/db';

/**
 * Latest stored exchange rate per currency (units of SOS per 1 unit of the currency).
 * The worker refreshes rates from the mock rates API; payments never call that API directly, so
 * a slow or unavailable rates service cannot block payment intake.
 */
export async function getLatestRates(): Promise<Map<Currency, number>> {
  const rows = await prisma.$queryRaw<{ currency: Currency; rate_to_base: string }[]>`
    SELECT DISTINCT ON (currency) currency, rate_to_base::text
    FROM exchange_rate
    ORDER BY currency, fetched_at DESC`;
  const rates = new Map<Currency, number>([['SOS', 1]]);
  for (const row of rows) rates.set(row.currency, Number(row.rate_to_base));
  return rates;
}
