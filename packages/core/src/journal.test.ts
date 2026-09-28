import { describe, expect, it } from 'vitest';
import {
  assertBalanced,
  buildDailyJournal,
  exponentialBackoffMs,
  summariseByGl,
  UnbalancedJournalError,
} from './journal';

const payments = [
  { paymentId: 1, revenueCode: 'BL', glCode: '1410', amountBase: 100.1 },
  { paymentId: 2, revenueCode: 'BL', glCode: '1410', amountBase: 0.2 },
  { paymentId: 3, revenueCode: 'WATER', glCode: '1520', amountBase: 50 },
];

describe('buildDailyJournal', () => {
  it('debits the bank with the total and credits each payment to its GL', () => {
    const journal = buildDailyJournal('2026-01-10', payments, '1101');
    expect(journal.totalDebit).toBe(150.3);
    expect(journal.totalCredit).toBe(150.3);
    expect(journal.lines[0]).toMatchObject({ glCode: '1101', debit: 150.3, paymentId: null });
    expect(journal.lines.filter((l) => l.paymentId !== null)).toHaveLength(3);
  });

  it('refuses to build an empty journal', () => {
    expect(() => buildDailyJournal('2026-01-10', [], '1101')).toThrow();
  });

  it('refuses zero or negative payments', () => {
    expect(() =>
      buildDailyJournal('2026-01-10', [{ ...payments[0]!, amountBase: 0 }], '1101'),
    ).toThrow();
  });
});

describe('summariseByGl', () => {
  it('produces one line per GL code for the FMIS payload', () => {
    const journal = buildDailyJournal('2026-01-10', payments, '1101');
    expect(summariseByGl(journal.lines)).toEqual([
      { glCode: '1101', debit: 150.3, credit: 0 },
      { glCode: '1410', debit: 0, credit: 100.3 },
      { glCode: '1520', debit: 0, credit: 50 },
    ]);
  });
});

describe('assertBalanced', () => {
  it('throws when debits and credits differ', () => {
    expect(() =>
      assertBalanced([
        { debit: 100, credit: 0 },
        { debit: 0, credit: 99.99 },
      ]),
    ).toThrow(UnbalancedJournalError);
  });

  it('is not fooled by floating point sums', () => {
    expect(() =>
      assertBalanced([
        { debit: 0.3, credit: 0 },
        { debit: 0, credit: 0.1 },
        { debit: 0, credit: 0.2 },
      ]),
    ).not.toThrow();
  });
});

describe('exponentialBackoffMs', () => {
  it('doubles the delay on each attempt', () => {
    expect([1, 2, 3].map((a) => exponentialBackoffMs(a, 1000))).toEqual([1000, 2000, 4000]);
  });
});
