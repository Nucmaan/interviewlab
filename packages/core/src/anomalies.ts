/**
 * Simple, explainable anomaly rules for dashboard alerts (POC module 7).
 * Thresholds come from system configuration so the Ministry can tune them.
 */

export interface CollectionDropCheck {
  isAnomaly: boolean;
  average: number;
  changePercent: number;
}

function average(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((s, v) => s + v, 0) / values.length;
}

/**
 * Sudden drop: the day's collections are below (100 - dropPercent)% of the trailing 7-day
 * average. With dropPercent = 50, a day collecting less than half the usual amount alerts.
 * Days with no history do not alert, because there is nothing to compare with.
 */
export function detectCollectionDrop(
  dayTotal: number,
  previousDays: readonly number[],
  dropPercent: number,
): CollectionDropCheck {
  const avg = average(previousDays);
  if (avg <= 0) return { isAnomaly: false, average: avg, changePercent: 0 };
  const changePercent = ((dayTotal - avg) / avg) * 100;
  return { isAnomaly: changePercent <= -dropPercent, average: avg, changePercent };
}

/**
 * Reversal spike: today's reversal count is at least `factor` times the 7-day average AND at
 * least `minCount` (so going from 0 to 1 reversal does not raise an alarm).
 */
export function detectReversalSpike(
  todayCount: number,
  previousDays: readonly number[],
  factor: number,
  minCount: number,
): { isAnomaly: boolean; average: number } {
  const avg = average(previousDays);
  const threshold = Math.max(minCount, avg * factor);
  return { isAnomaly: todayCount >= threshold, average: avg };
}

/**
 * Abnormal water consumption (POC module 4): more than `thresholdPercent`% of the average of the
 * last 3 months. Bills that trip this rule are held for investigation before release.
 */
export function isAbnormalConsumption(
  currentM3: number,
  previousMonthsM3: readonly number[],
  thresholdPercent: number,
): boolean {
  const lastThree = previousMonthsM3.slice(0, 3);
  if (lastThree.length === 0) return false;
  const avg = average(lastThree);
  // A meter that read zero for 3 months and now shows usage (e.g. a vacant house) is worth a
  // look, and a percentage of zero is meaningless, so any usage is flagged.
  if (avg === 0) return currentM3 > 0;
  return currentM3 > (avg * thresholdPercent) / 100;
}
