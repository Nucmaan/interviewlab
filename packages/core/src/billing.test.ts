import { describe, expect, it } from 'vitest';
import { buildStatement, composeBill } from './billing';

describe('composeBill', () => {
  it('carries unpaid arrears into the new bill', () => {
    expect(
      composeBill({ previousBalance: 2200, paymentsReceived: 1000, currentCharges: 775 }),
    ).toEqual({
      previousBalance: 2200,
      paymentsReceived: 1000,
      arrearsBroughtForward: 1200,
      currentCharges: 775,
      totalDue: 1975,
    });
  });

  it('reduces the new bill when the customer overpaid (credit)', () => {
    const bill = composeBill({ previousBalance: 700, paymentsReceived: 1000, currentCharges: 700 });
    expect(bill.arrearsBroughtForward).toBe(-300);
    expect(bill.totalDue).toBe(400);
  });

  it('is just the current charges for a first bill', () => {
    expect(
      composeBill({ previousBalance: 0, paymentsReceived: 0, currentCharges: 200 }).totalDue,
    ).toBe(200);
  });
});

describe('buildStatement', () => {
  const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

  it('keeps a running balance across bills and payments', () => {
    const { lines, closingBalance } = buildStatement([
      {
        date: d('2026-02-05'),
        type: 'PAYMENT',
        reference: 'P1',
        description: 'Payment',
        amount: 500,
      },
      {
        date: d('2026-01-31'),
        type: 'BILL',
        reference: 'B1',
        description: 'Jan bill',
        amount: 700,
      },
      {
        date: d('2026-02-28'),
        type: 'BILL',
        reference: 'B2',
        description: 'Feb bill',
        amount: 775,
      },
    ]);
    expect(lines.map((l) => [l.reference, l.runningBalance])).toEqual([
      ['B1', 700],
      ['P1', 200],
      ['B2', 975],
    ]);
    expect(closingBalance).toBe(975);
  });

  it('adds reversed payments back to the balance', () => {
    const { closingBalance } = buildStatement(
      [
        { date: d('2026-01-02'), type: 'PAYMENT', reference: 'P1', description: '', amount: 300 },
        { date: d('2026-01-03'), type: 'REVERSAL', reference: 'P1', description: '', amount: 300 },
      ],
      1000,
    );
    expect(closingBalance).toBe(1000);
  });

  it('lists a bill before a payment on the same day', () => {
    const { lines } = buildStatement([
      { date: d('2026-01-31'), type: 'PAYMENT', reference: 'P', description: '', amount: 1 },
      { date: d('2026-01-31'), type: 'BILL', reference: 'B', description: '', amount: 1 },
    ]);
    expect(lines.map((l) => l.type)).toEqual(['BILL', 'PAYMENT']);
  });
});
