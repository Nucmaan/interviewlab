import { describe, expect, it } from 'vitest';
import { financialQuarter, financialYearRange } from './financial-year';

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe('financialQuarter', () => {
  it('uses calendar quarters when the year starts in January', () => {
    expect(financialQuarter(d('2026-05-10'), 1)).toEqual({ financialYear: 2026, quarter: 2 });
  });

  it.each([
    ['2025-07-01', 2025, 1],
    ['2025-09-30', 2025, 1],
    ['2025-10-01', 2025, 2],
    ['2026-01-15', 2025, 3],
    ['2026-06-30', 2025, 4],
    ['2026-07-01', 2026, 1],
  ])('with a July start, %s is FY%i Q%i', (date, fy, quarter) => {
    expect(financialQuarter(d(date), 7)).toEqual({ financialYear: fy, quarter });
  });

  it('rejects an invalid start month', () => {
    expect(() => financialQuarter(d('2026-01-01'), 13)).toThrow(RangeError);
  });
});

describe('financialYearRange', () => {
  it('returns a half-open range', () => {
    expect(financialYearRange(2025, 7)).toEqual({ from: d('2025-07-01'), to: d('2026-07-01') });
  });
});
