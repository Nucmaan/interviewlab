import 'server-only';
import {
  financialQuarter,
  forecastNextQuarter,
  forecastSeasonal,
  type QuarterForecast,
  type SeasonalForecast,
} from '@ircub/core';
import { getConfig, type Prisma } from '@ircub/db';
import { prisma } from '@/lib/db';

/**
 * Dashboard queries. Everything here reads the pre-aggregated daily_summary table or the SQL
 * functions from /sql - never a scan of the whole payment table - so the dashboard stays fast
 * with 50 million payments.
 */

const monthKey = (d: Date) => d.toISOString().slice(0, 7);

/** The last `count` months as YYYY-MM, oldest first, ending with the current month. */
function lastMonths(count: number): string[] {
  const now = new Date();
  return Array.from({ length: count }, (_, i) =>
    monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (count - 1 - i), 1))),
  );
}

export interface MonthlySeries {
  months: string[];
  /** One row per month: { month, [key]: total } - the shape Recharts expects. */
  rows: Record<string, string | number>[];
  keys: string[];
}

async function monthlyBy(
  column: 'revenue_code' | 'channel',
  months: string[],
): Promise<MonthlySeries> {
  const from = `${months[0]}-01`;
  const rows = await prisma.$queryRawUnsafe<{ month: Date; key: string; total: Prisma.Decimal }[]>(
    `SELECT date_trunc('month', summary_date)::date AS month, ${column}::text AS key, SUM(total_amount_base) AS total
     FROM daily_summary WHERE summary_date >= $1::date
     GROUP BY 1, 2 ORDER BY 1`,
    from,
  );
  const keys = [...new Set(rows.map((r) => r.key))].sort();
  const byMonth = new Map<string, Record<string, string | number>>(
    months.map((m) => [m, { month: m }]),
  );
  for (const r of rows) {
    const row = byMonth.get(monthKey(r.month));
    if (row) row[r.key] = Math.round(Number(r.total));
  }
  for (const row of byMonth.values()) for (const k of keys) row[k] ??= 0;
  return { months, keys, rows: [...byMonth.values()] };
}

export function monthlyByRevenueType(months = 24) {
  return monthlyBy('revenue_code', lastMonths(months));
}

export function monthlyByChannel(months = 24) {
  return monthlyBy('channel', lastMonths(months));
}

/** Collections vs targets per month (all revenue types together). */
export async function collectionsVsTargets(months = 12) {
  const list = lastMonths(months);
  const from = `${list[0]}-01`;
  const [actual, targets] = await Promise.all([
    prisma.$queryRaw<{ month: Date; total: Prisma.Decimal }[]>`
      SELECT date_trunc('month', summary_date)::date AS month, SUM(total_amount_base) AS total
      FROM daily_summary WHERE summary_date >= ${from}::date GROUP BY 1`,
    prisma.$queryRaw<{ month: Date; total: Prisma.Decimal }[]>`
      SELECT period_month AS month, SUM(target_amount) AS total
      FROM revenue_target WHERE period_month >= ${from}::date GROUP BY 1`,
  ]);
  const a = new Map(actual.map((r) => [monthKey(r.month), Math.round(Number(r.total))]));
  const t = new Map(targets.map((r) => [monthKey(r.month), Math.round(Number(r.total))]));
  return list.map((month) => {
    const collected = a.get(month) ?? 0;
    const target = t.get(month) ?? 0;
    return {
      month,
      collected,
      target,
      achievedPct: target ? Math.round((collected / target) * 1000) / 10 : null,
    };
  });
}

/** Water billed vs collected per month, using sql/03 collection_efficiency(). */
export async function waterEfficiency(months = 12) {
  const list = lastMonths(months + 1).slice(0, -1); // complete billing months only
  const rows = await prisma.$queryRaw<
    {
      tariff_class: string;
      billing_month: Date;
      amount_billed: Prisma.Decimal;
      amount_collected: Prisma.Decimal;
      efficiency_pct: Prisma.Decimal | null;
    }[]
  >`SELECT * FROM collection_efficiency(${`${list[0]}-01`}::date, ${`${list[list.length - 1]}-01`}::date)`;
  const byMonth = new Map(
    list.map((m) => [m, { month: m, billed: 0, collected: 0, efficiencyPct: 0 }]),
  );
  for (const r of rows) {
    const row = byMonth.get(monthKey(r.billing_month));
    if (!row) continue;
    row.billed += Number(r.amount_billed);
    row.collected += Number(r.amount_collected);
  }
  const monthly = [...byMonth.values()].map((r) => ({
    ...r,
    billed: Math.round(r.billed),
    collected: Math.round(r.collected),
    efficiencyPct: r.billed ? Math.round((r.collected / r.billed) * 1000) / 10 : 0,
  }));
  const byClass = rows
    .filter((r) => monthKey(r.billing_month) === list[list.length - 1])
    .map((r) => ({
      tariffClass: r.tariff_class,
      billed: Number(r.amount_billed),
      collected: Number(r.amount_collected),
      efficiencyPct: r.efficiency_pct === null ? null : Number(r.efficiency_pct),
    }));
  return { monthly, byClass, latestMonth: list[list.length - 1] };
}

/** sql/01 quarterly_collections() for the current financial year. */
export async function quarterlyCollections() {
  const startMonth = await getConfig(prisma, 'financial_year_start_month', 1);
  const { financialYear } = financialQuarter(new Date(), startMonth);
  const rows = await prisma.$queryRaw<
    {
      revenue_code: string;
      revenue_name: string;
      quarter: number;
      total_collected: Prisma.Decimal;
      running_total: Prisma.Decimal;
      share_of_quarter_pct: Prisma.Decimal | null;
    }[]
  >`SELECT * FROM quarterly_collections(${financialYear}::int, ${startMonth}::int)`;
  return {
    financialYear,
    startMonth,
    rows: rows.map((r) => ({
      revenueCode: r.revenue_code,
      name: r.revenue_name,
      quarter: r.quarter,
      total: Number(r.total_collected),
      runningTotal: Number(r.running_total),
      sharePct: r.share_of_quarter_pct === null ? null : Number(r.share_of_quarter_pct),
    })),
  };
}

/** sql/04 top_water_arrears(): top 10 accounts by arrears older than 90 days. */
export async function topArrears() {
  const rows = await prisma.$queryRaw<
    {
      account_no: string;
      payer_id: number;
      full_name: string;
      tariff_class: string;
      arrears_over_90_days: Prisma.Decimal;
      total_outstanding: Prisma.Decimal;
    }[]
  >`SELECT * FROM top_water_arrears()`;
  return rows.map((r) => ({
    accountNo: r.account_no,
    payerId: r.payer_id,
    name: r.full_name,
    tariffClass: r.tariff_class,
    arrears90: Number(r.arrears_over_90_days),
    outstanding: Number(r.total_outstanding),
  }));
}

export interface RevenueForecast {
  history: { month: string; actual: number }[];
  forecastMonths: string[];
  /** Plain linear regression, as the brief asks. */
  linear: QuarterForecast;
  /** Linear trend x monthly seasonal factor - the recommended figure (see core/regression.ts). */
  seasonal: SeasonalForecast;
}

/**
 * Next-quarter forecast from the last 24 COMPLETE months (the current, unfinished month would pull
 * the trend down). Returns both the plain linear regression and the seasonally adjusted version.
 */
export async function revenueForecast(): Promise<RevenueForecast> {
  const months = lastMonths(25).slice(0, -1);
  const series = await monthlyBy('revenue_code', months);
  const history = series.rows.map((row) => ({
    month: String(row.month),
    actual: series.keys.reduce((sum, key) => sum + Number(row[key] ?? 0), 0),
  }));
  const totals = history.map((h) => h.actual);
  const firstCalendarMonth = Number(months[0]!.slice(5, 7)) - 1;
  const now = new Date();
  const forecastMonths = [0, 1, 2].map((i) =>
    monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1))),
  );
  return {
    history,
    forecastMonths,
    linear: forecastNextQuarter(totals),
    seasonal: forecastSeasonal(totals, firstCalendarMonth),
  };
}

export async function recentAlerts(limit = 8) {
  return prisma.alert.findMany({ orderBy: { created_at: 'desc' }, take: limit });
}
