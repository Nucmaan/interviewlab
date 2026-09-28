import { describe, expect, it } from 'vitest';
import {
  validatePaymentRecords,
  type PaymentRecord,
  type ValidationContext,
} from './payment-validation';

const now = new Date('2026-03-01T12:00:00Z');

const context: ValidationContext = {
  knownPayerIds: new Set([1, 2]),
  revenueCodes: new Map([
    ['BL', { isActive: true }],
    ['OLD', { isActive: false }],
  ]),
  existingExternalRefs: new Set(['BANK-0001']),
  assessments: new Map([[10, { payerId: 1, revenueCode: 'BL' }]]),
  bills: new Map([[20, { payerId: 2 }]]),
  now,
};

const good = (overrides: Partial<PaymentRecord> = {}): PaymentRecord => ({
  payerId: 1,
  revenueCode: 'BL',
  amount: 100,
  currency: 'USD',
  channel: 'BANK',
  externalRef: `REF-${Math.random()}`,
  paidAt: new Date('2026-03-01T10:00:00Z'),
  ...overrides,
});

function reasonFor(record: PaymentRecord): string | undefined {
  return validatePaymentRecords([record], context).rejected[0]?.reason;
}

describe('validatePaymentRecords', () => {
  it('accepts a valid record', () => {
    const result = validatePaymentRecords([good({ assessmentId: 10 })], context);
    expect(result.valid).toHaveLength(1);
    expect(result.rejected).toHaveLength(0);
  });

  it('accepts amounts with two decimals such as 19.99', () => {
    expect(reasonFor(good({ amount: 19.99 }))).toBeUndefined();
  });

  it.each([
    [{ amount: 0 }, 'Amount must be greater than 0'],
    [{ amount: -5 }, 'Amount must be greater than 0'],
    [{ amount: 10.123 }, 'Amount cannot have more than 2 decimal places'],
    [{ payerId: 99 }, 'Payer 99 does not exist'],
    [{ revenueCode: 'NOPE' }, 'Revenue code NOPE is not valid'],
    [{ revenueCode: 'OLD' }, 'Revenue code OLD is not active'],
    [{ externalRef: 'BANK-0001' }, 'Duplicate external reference BANK-0001 (already received)'],
    [{ externalRef: '  ' }, 'External reference is required'],
    [{ paidAt: new Date('2026-03-02T00:00:00Z') }, 'Payment date is in the future'],
    [{ assessmentId: 11 }, 'Assessment 11 does not exist'],
    [{ assessmentId: 10, payerId: 2 }, 'Assessment 10 belongs to another payer'],
    [{ billId: 20 }, 'Water bill 20 belongs to another payer'],
  ])('rejects %o', (overrides, reason) => {
    expect(reasonFor(good(overrides))).toBe(reason);
  });

  it('rejects the second row when an external_ref repeats inside the batch', () => {
    const result = validatePaymentRecords(
      [good({ externalRef: 'MM-1' }), good({ externalRef: 'MM-1' })],
      context,
    );
    expect(result.valid.map((v) => v.row)).toEqual([1]);
    expect(result.rejected).toEqual([
      expect.objectContaining({
        row: 2,
        reason: expect.stringContaining('repeated in this upload'),
      }),
    ]);
  });

  it('reports 1-based row numbers', () => {
    const result = validatePaymentRecords([good(), good({ amount: 0 }), good()], context);
    expect(result.rejected[0]?.row).toBe(2);
  });
});
