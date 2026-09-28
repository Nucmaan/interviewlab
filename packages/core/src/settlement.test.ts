import { describe, expect, it } from 'vitest';
import { applyPayment, convertToBase, settlementStatus } from './settlement';

describe('convertToBase', () => {
  it('leaves base currency (SOS) unchanged', () => {
    expect(convertToBase(1500, 'SOS', 1)).toBe(1500);
  });

  it('converts USD with the given rate and rounds to the cent', () => {
    expect(convertToBase(10.5, 'USD', 571.25)).toBe(5998.13);
  });

  it('refuses a missing or zero rate', () => {
    expect(() => convertToBase(10, 'USD', 0)).toThrow(RangeError);
  });
});

describe('applyPayment', () => {
  it('marks a partial payment as PART_PAID', () => {
    expect(applyPayment({ totalDue: 1000, amountPaid: 0 }, 400)).toEqual({
      amountPaid: 400,
      status: 'PART_PAID',
      overpayment: 0,
    });
  });

  it('marks a full payment as PAID', () => {
    expect(applyPayment({ totalDue: 1000, amountPaid: 400 }, 600).status).toBe('PAID');
  });

  it('records an overpayment', () => {
    expect(applyPayment({ totalDue: 1000, amountPaid: 0 }, 1200).overpayment).toBe(200);
  });

  it('re-opens an assessment when a payment is reversed', () => {
    expect(applyPayment({ totalDue: 1000, amountPaid: 1000 }, -1000)).toEqual({
      amountPaid: 0,
      status: 'OPEN',
      overpayment: 0,
    });
  });

  it('never lets amount paid go below zero', () => {
    expect(applyPayment({ totalDue: 1000, amountPaid: 100 }, -500).amountPaid).toBe(0);
  });
});

describe('settlementStatus', () => {
  it('treats 0.1 + 0.2 paid against 0.3 due as PAID', () => {
    expect(settlementStatus(0.3, 0.1 + 0.2)).toBe('PAID');
  });
});
