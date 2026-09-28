/**
 * Financial year helpers. Many governments do not start their financial year in January, so the
 * start month is a parameter (1 = January ... 7 = July). The financial year is labelled by the
 * calendar year in which it STARTS (FY2025 with a July start = 1 Jul 2025 - 30 Jun 2026).
 * `sql/01-quarterly-collections.sql` uses the same rule.
 */

export interface FinancialQuarter {
  financialYear: number;
  quarter: 1 | 2 | 3 | 4;
}

export function financialQuarter(date: Date, fyStartMonth: number): FinancialQuarter {
  if (!Number.isInteger(fyStartMonth) || fyStartMonth < 1 || fyStartMonth > 12) {
    throw new RangeError(`Financial year start month must be 1-12 (got ${fyStartMonth})`);
  }
  const month = date.getUTCMonth() + 1;
  const monthsIntoYear = (month - fyStartMonth + 12) % 12;
  const financialYear = month >= fyStartMonth ? date.getUTCFullYear() : date.getUTCFullYear() - 1;
  return { financialYear, quarter: (Math.floor(monthsIntoYear / 3) + 1) as 1 | 2 | 3 | 4 };
}

/** First day (inclusive) and the day after the last day (exclusive) of a financial year. */
export function financialYearRange(
  financialYear: number,
  fyStartMonth: number,
): { from: Date; to: Date } {
  return {
    from: new Date(Date.UTC(financialYear, fyStartMonth - 1, 1)),
    to: new Date(Date.UTC(financialYear + 1, fyStartMonth - 1, 1)),
  };
}
