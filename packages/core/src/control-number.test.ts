import { describe, expect, it } from 'vitest';
import { generateControlNumber, isValidControlNumber, luhnCheckDigit } from './control-number';

describe('luhnCheckDigit', () => {
  it('matches the textbook Luhn example', () => {
    expect(luhnCheckDigit('7992739871')).toBe(3);
  });

  it('rejects non-digit input', () => {
    expect(() => luhnCheckDigit('12a4')).toThrow();
  });
});

describe('control numbers', () => {
  it('generates the readable PREFIX-YYYY-NNNNNNN-C format', () => {
    expect(generateControlNumber('AS', 2026, 1234)).toMatch(/^AS-2026-0001234-\d$/);
  });

  it('validates numbers it generated', () => {
    for (let seq = 1; seq < 500; seq += 37) {
      expect(isValidControlNumber(generateControlNumber('WB', 2026, seq))).toBe(true);
    }
  });

  it('detects a single mistyped digit', () => {
    const valid = generateControlNumber('AS', 2026, 1234);
    const typo = valid.replace('0001234', '0001284');
    expect(isValidControlNumber(typo)).toBe(false);
  });

  it('detects two swapped neighbouring digits', () => {
    const valid = generateControlNumber('AS', 2026, 1234);
    const swapped = valid.replace('0001234', '0001324');
    expect(isValidControlNumber(swapped)).toBe(false);
  });

  it('rejects the wrong shape', () => {
    expect(isValidControlNumber('XX-2026-0001234-1')).toBe(false);
    expect(isValidControlNumber('AS-2026-1234-1')).toBe(false);
  });

  it('rejects an out-of-range sequence', () => {
    expect(() => generateControlNumber('AS', 2026, 0)).toThrow(RangeError);
    expect(() => generateControlNumber('AS', 2026, 10_000_000)).toThrow(RangeError);
  });
});
