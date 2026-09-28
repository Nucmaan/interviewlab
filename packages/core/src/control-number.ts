/**
 * Payment reference / control numbers (POC module 3).
 *
 * Format: PREFIX-YYYY-NNNNNNN-C, for example AS-2026-0001234-6
 *   PREFIX  what it pays for: AS = tax assessment, WB = water bill
 *   YYYY    year it was issued (makes numbers readable and easy to sort)
 *   NNNNNNN 7-digit sequence from a PostgreSQL sequence (guarantees uniqueness)
 *   C       Luhn check digit calculated over the 11 digits YYYY + NNNNNNN
 *
 * Why Luhn? Payers type these numbers into bank and mobile money apps. Luhn catches every
 * single-digit typing error and almost every swap of two neighbouring digits, so a wrong number
 * is rejected at the channel before money is sent to the wrong reference. It is the same
 * algorithm used on card numbers, so bank partners already support it.
 */

export type ControlNumberPrefix = 'AS' | 'WB';

const CONTROL_NUMBER_PATTERN = /^(AS|WB)-(\d{4})-(\d{7})-(\d)$/;

/** Luhn check digit for a string of digits. */
export function luhnCheckDigit(digits: string): number {
  if (!/^\d+$/.test(digits)) {
    throw new Error('Luhn input must contain digits only');
  }
  let sum = 0;
  // Walk from the right. The digit next to the (future) check digit is doubled first.
  for (let i = 0; i < digits.length; i++) {
    let digit = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 0) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return (10 - (sum % 10)) % 10;
}

export function generateControlNumber(
  prefix: ControlNumberPrefix,
  year: number,
  sequence: number,
): string {
  if (!Number.isInteger(year) || year < 2000 || year > 9999) {
    throw new RangeError(`Invalid year for control number: ${year}`);
  }
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > 9_999_999) {
    throw new RangeError(`Control number sequence out of range: ${sequence}`);
  }
  const body = `${year}${String(sequence).padStart(7, '0')}`;
  return `${prefix}-${year}-${body.slice(4)}-${luhnCheckDigit(body)}`;
}

export function isValidControlNumber(value: string): boolean {
  const match = CONTROL_NUMBER_PATTERN.exec(value.trim().toUpperCase());
  if (!match) return false;
  const [, , year, sequence, check] = match;
  return luhnCheckDigit(`${year}${sequence}`) === Number(check);
}
