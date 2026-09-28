/**
 * Keeps the pre-aggregated daily_summary table fresh and raises anomaly alerts (POC module 7).
 * The dashboard only reads daily_summary, so its queries stay fast however many payments exist.
 */
import { detectCollectionDrop, detectReversalSpike } from '@ircub/core';
import { getConfig, toNumber, type AlertSeverity, type AlertType, type Prisma } from '@ircub/db';
import { publishEvent } from '@ircub/platform';
import type { WorkerContext } from '../lib/context';

interface AlertRules {
  collectionDropPercent: number;
  reversalSpikeFactor: number;
  reversalSpikeMinCount: number;
}

const DEFAULT_RULES: AlertRules = {
  collectionDropPercent: 50,
  reversalSpikeFactor: 3,
  reversalSpikeMinCount: 5,
};

export async function refreshSummaries(ctx: WorkerContext, dates: string[]): Promise<void> {
  if (dates.length === 0) return;
  const sorted = [...dates].sort();
  const from = sorted[0]!;
  const to = sorted[sorted.length - 1]!;
  // Same SQL function the seed uses (sql/02-indexes-and-partitioning.sql).
  await ctx.prisma.$queryRaw`SELECT refresh_daily_summary(${from}::date, ${to}::date)`;
  await publishEvent(ctx.redis, { type: 'summary.updated', dates: sorted });
  ctx.logger.info({ from, to }, 'daily summary refreshed');
}

/**
 * Compares a day with the 7 days before it:
 *   - collections dropped by more than N% against the 7-day average  -> COLLECTION_DROP
 *   - reversals at least X times the 7-day average (and at least M)    -> REVERSAL_SPIKE
 * Alerts carry a dedupe key, so re-running the check never duplicates an alert.
 */
export async function checkAnomalies(
  ctx: WorkerContext,
  day: string,
  options: { includeCollectionDrop: boolean },
): Promise<number> {
  const rules = await getConfig(ctx.prisma, 'alert_rules', DEFAULT_RULES);
  const rows = await ctx.prisma.$queryRaw<
    { summary_date: Date; total: Prisma.Decimal | null; reversals: bigint }[]
  >`
    SELECT summary_date, SUM(total_amount_base) AS total, SUM(reversal_count)::bigint AS reversals
    FROM daily_summary
    WHERE summary_date BETWEEN ${day}::date - 7 AND ${day}::date
    GROUP BY summary_date`;
  const byDay = new Map(rows.map((r) => [r.summary_date.toISOString().slice(0, 10), r]));
  const previous: { total: number; reversals: number }[] = [];
  for (let i = 1; i <= 7; i++) {
    const d = new Date(`${day}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - i);
    const row = byDay.get(d.toISOString().slice(0, 10));
    previous.push({ total: toNumber(row?.total), reversals: Number(row?.reversals ?? 0) });
  }
  const today = byDay.get(day);
  const todayTotal = toNumber(today?.total);
  const todayReversals = Number(today?.reversals ?? 0);
  let raised = 0;

  const drop = detectCollectionDrop(
    todayTotal,
    previous.map((p) => p.total),
    rules.collectionDropPercent,
  );
  // A day still in progress always looks like a drop, so drops are only checked for full days.
  if (options.includeCollectionDrop && drop.isAnomaly) {
    raised += await raiseAlert(ctx, {
      type: 'COLLECTION_DROP',
      severity: 'WARNING',
      dedupeKey: `COLLECTION_DROP:${day}`,
      message: `Collections on ${day} are ${Math.abs(drop.changePercent).toFixed(0)}% below the 7-day average`,
      data: { day, total: todayTotal, average: drop.average },
    });
  }
  const spike = detectReversalSpike(
    todayReversals,
    previous.map((p) => p.reversals),
    rules.reversalSpikeFactor,
    rules.reversalSpikeMinCount,
  );
  if (spike.isAnomaly) {
    raised += await raiseAlert(ctx, {
      type: 'REVERSAL_SPIKE',
      severity: 'CRITICAL',
      dedupeKey: `REVERSAL_SPIKE:${day}`,
      message: `${todayReversals} reversals on ${day} (7-day average ${spike.average.toFixed(1)})`,
      data: { day, reversals: todayReversals, average: spike.average },
    });
  }
  return raised;
}

export async function raiseAlert(
  ctx: WorkerContext,
  alert: {
    type: AlertType;
    severity: AlertSeverity;
    dedupeKey: string;
    message: string;
    data: object;
  },
): Promise<number> {
  const created = await ctx.prisma.alert.createManyAndReturn({
    data: [
      {
        alert_type: alert.type,
        severity: alert.severity,
        dedupe_key: alert.dedupeKey,
        message: alert.message,
        data: alert.data,
      },
    ],
    skipDuplicates: true,
  });
  const row = created[0];
  if (!row) return 0;
  await publishEvent(ctx.redis, {
    type: 'alert.created',
    alertId: row.alert_id,
    severity: row.severity,
    message: row.message,
  });
  ctx.logger.warn({ alert: alert.dedupeKey }, alert.message);
  return 1;
}
