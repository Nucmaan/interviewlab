import { describe, expect, it } from 'vitest';
import { compareTotals, reconcileChannelStatement } from './reconciliation';

describe('reconcileChannelStatement', () => {
  it('classifies every line', () => {
    const { rows, summary } = reconcileChannelStatement(
      [
        { externalRef: 'A', amount: 100, currency: 'USD' },
        { externalRef: 'B', amount: 50, currency: 'USD' },
        { externalRef: 'C', amount: 10, currency: 'SOS' },
      ],
      [
        { externalRef: 'A', amount: 100, currency: 'USD' },
        { externalRef: 'B', amount: 55, currency: 'USD' },
        { externalRef: 'D', amount: 70, currency: 'USD' },
      ],
    );
    expect(Object.fromEntries(rows.map((r) => [r.externalRef, r.status]))).toEqual({
      A: 'MATCHED',
      B: 'AMOUNT_MISMATCH',
      C: 'MISSING_IN_STATEMENT',
      D: 'MISSING_IN_IRCUB',
    });
    expect(summary).toEqual({
      MATCHED: 1,
      AMOUNT_MISMATCH: 1,
      MISSING_IN_IRCUB: 1,
      MISSING_IN_STATEMENT: 1,
    });
  });

  it('treats a currency difference as a mismatch', () => {
    const { rows } = reconcileChannelStatement(
      [{ externalRef: 'A', amount: 100, currency: 'USD' }],
      [{ externalRef: 'A', amount: 100, currency: 'SOS' }],
    );
    expect(rows[0]?.status).toBe('AMOUNT_MISMATCH');
  });
});

describe('compareTotals', () => {
  it('compares per day and GL code, including GLs only one side has', () => {
    const result = compareTotals(
      [
        { businessDate: '2026-01-01', glCode: '1410', amount: 100.1 },
        { businessDate: '2026-01-01', glCode: '1410', amount: 0.2 },
        { businessDate: '2026-01-01', glCode: '1520', amount: 50 },
      ],
      [
        { businessDate: '2026-01-01', glCode: '1410', amount: 100.3 },
        { businessDate: '2026-01-01', glCode: '1600', amount: 5 },
      ],
    );
    expect(result).toEqual([
      {
        businessDate: '2026-01-01',
        glCode: '1410',
        ircubTotal: 100.3,
        fmisTotal: 100.3,
        difference: 0,
        matched: true,
      },
      {
        businessDate: '2026-01-01',
        glCode: '1520',
        ircubTotal: 50,
        fmisTotal: 0,
        difference: 50,
        matched: false,
      },
      {
        businessDate: '2026-01-01',
        glCode: '1600',
        ircubTotal: 0,
        fmisTotal: 5,
        difference: -5,
        matched: false,
      },
    ]);
  });
});
