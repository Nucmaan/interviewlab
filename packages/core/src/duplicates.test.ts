import { describe, expect, it } from 'vitest';
import {
  findDuplicateMatches,
  normalizeEmail,
  normalizeNationalId,
  normalizePhone,
} from './duplicates';

describe('normalisation', () => {
  it.each(['+252 61 555 1234', '00252615551234', '0615551234', '61-555-1234'])(
    'normalises phone %s',
    (phone) => {
      expect(normalizePhone(phone)).toBe('615551234');
    },
  );

  it('ignores phone numbers that are too short to compare', () => {
    expect(normalizePhone('123')).toBeNull();
  });

  it('normalises email and national id', () => {
    expect(normalizeEmail('  Ali@Example.COM ')).toBe('ali@example.com');
    expect(normalizeNationalId('so-123 456')).toBe('SO123456');
    expect(normalizeEmail('')).toBeNull();
  });
});

describe('findDuplicateMatches', () => {
  const existing = [
    { payerId: 1, phone: '0615551234', email: 'a@x.so', nationalId: 'SO111' },
    { payerId: 2, phone: '0617770000', email: 'B@x.so', nationalId: 'SO222' },
  ];

  it('reports every matching field', () => {
    expect(
      findDuplicateMatches({ phone: '+252615551234', email: 'b@X.so', nationalId: null }, existing),
    ).toEqual([
      { matchedPayerId: 1, field: 'PHONE' },
      { matchedPayerId: 2, field: 'EMAIL' },
    ]);
  });

  it('matches on national id', () => {
    expect(findDuplicateMatches({ nationalId: 'so 222' }, existing)).toEqual([
      { matchedPayerId: 2, field: 'NATIONAL_ID' },
    ]);
  });

  it('does not match a payer with itself', () => {
    expect(findDuplicateMatches({ payerId: 1, phone: '0615551234' }, existing)).toEqual([]);
  });

  it('returns nothing for a new identity', () => {
    expect(findDuplicateMatches({ phone: '0619999999', email: 'new@x.so' }, existing)).toEqual([]);
  });
});
