import { describe, expect, it } from 'vitest';
import { calculatePenalty, fullMonthsBetween } from './penalty';

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe('fullMonthsBetween', () => {
  it.each([
    ['2026-01-15', '2026-01-15', 0],
    ['2026-01-15', '2026-02-14', 0],
    ['2026-01-15', '2026-02-15', 1],
    ['2026-01-31', '2026-02-28', 0],
    ['2026-01-31', '2026-03-01', 1],
    ['2025-11-10', '2026-03-10', 4],
    ['2026-03-10', '2026-01-10', 0],
  ])('%s -> %s is %i full months', (from, to, expected) => {
    expect(fullMonthsBetween(d(from), d(to))).toBe(expected);
  });
});

describe('calculatePenalty', () => {
  const base = { amountDue: 1000, amountPaid: 0, dueDate: d('2026-01-01') };

  it('charges nothing before a full month has passed', () => {
    expect(calculatePenalty({ ...base, runDate: d('2026-01-31') }).penaltyAmount).toBe(0);
  });

  it('charges 5% per month for the first 3 months', () => {
    expect(calculatePenalty({ ...base, runDate: d('2026-02-01') }).penaltyAmount).toBe(50);
    expect(calculatePenalty({ ...base, runDate: d('2026-04-01') }).penaltyAmount).toBe(150);
  });

  it('charges 10% per month from month 4', () => {
    // 3 x 5% + 2 x 10% = 35%
    const result = calculatePenalty({ ...base, runDate: d('2026-06-01') });
    expect(result.monthsOverdue).toBe(5);
    expect(result.penaltyAmount).toBe(350);
  });

  it('caps the penalty at 100% of the original amount due', () => {
    // 3 x 5% + 9 x 10% = 105% -> capped at 100%
    const result = calculatePenalty({ ...base, runDate: d('2027-01-01') });
    expect(result.penaltyAmount).toBe(1000);
    expect(result.capped).toBe(true);
  });

  it('bases the penalty on the unpaid amount only', () => {
    const result = calculatePenalty({ ...base, amountPaid: 400, runDate: d('2026-03-01') });
    expect(result.unpaidAmount).toBe(600);
    expect(result.penaltyAmount).toBe(60);
  });

  it('caps against the original amount due, not the unpaid amount', () => {
    // unpaid 600, 3x5% + 12x10% = 135% of 600 = 810, cap is 100% of 1000 -> 810 stands
    const result = calculatePenalty({ ...base, amountPaid: 400, runDate: d('2027-04-01') });
    expect(result.penaltyAmount).toBe(810);
    expect(result.capped).toBe(false);
  });

  it('charges nothing when the assessment is fully paid', () => {
    expect(
      calculatePenalty({ ...base, amountPaid: 1000, runDate: d('2026-12-01') }).penaltyAmount,
    ).toBe(0);
  });

  it('never lowers a penalty that was already charged', () => {
    // Principal fully paid: recalculation gives 0, but the 150 already charged is still owed.
    const result = calculatePenalty({
      ...base,
      amountPaid: 1000,
      currentPenalty: 150,
      runDate: d('2026-06-01'),
    });
    expect(result.penaltyAmount).toBe(150);
  });

  it('raises the penalty when the recalculated total is higher', () => {
    const result = calculatePenalty({ ...base, currentPenalty: 50, runDate: d('2026-03-01') });
    expect(result.penaltyAmount).toBe(100);
  });

  it('is idempotent: the same inputs always give the same total', () => {
    const input = { ...base, runDate: d('2026-05-01') };
    expect(calculatePenalty(input)).toEqual(calculatePenalty(input));
  });

  it('rounds to the cent', () => {
    const result = calculatePenalty({
      amountDue: 333.33,
      amountPaid: 0,
      dueDate: d('2026-01-01'),
      runDate: d('2026-02-01'),
    });
    expect(result.penaltyAmount).toBe(16.67);
  });

  it('accepts custom rules from configuration', () => {
    const result = calculatePenalty(
      { ...base, runDate: d('2026-03-01') },
      { initialMonths: 1, initialRatePercent: 2, laterRatePercent: 3, capPercent: 50 },
    );
    expect(result.penaltyAmount).toBe(50);
  });
});
