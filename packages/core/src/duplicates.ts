/**
 * Duplicate payer detection (POC module 2).
 *
 * People register twice with the same phone written differently (+252 61..., 061..., 61...),
 * or the same email in a different case. We normalise the values first, then compare.
 * Matches are FLAGGED for an officer to review, never blocked: family members and small
 * businesses often share a phone number, so a match is a hint, not proof.
 */

export type DuplicateField = 'PHONE' | 'EMAIL' | 'NATIONAL_ID';

export interface PayerIdentity {
  payerId?: number;
  phone?: string | null;
  email?: string | null;
  nationalId?: string | null;
}

export interface DuplicateMatch {
  matchedPayerId: number;
  field: DuplicateField;
}

/** Somalia country code; local numbers may be written with a leading 0. */
const COUNTRY_CODE = '252';

export function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let digits = phone.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith(COUNTRY_CODE)) digits = digits.slice(COUNTRY_CODE.length);
  if (digits.startsWith('0')) digits = digits.slice(1);
  return digits.length >= 7 ? digits : null;
}

export function normalizeEmail(email: string | null | undefined): string | null {
  const value = email?.trim().toLowerCase();
  return value ? value : null;
}

export function normalizeNationalId(id: string | null | undefined): string | null {
  const value = id?.replace(/[\s-]/g, '').toUpperCase();
  return value ? value : null;
}

export function findDuplicateMatches(
  candidate: PayerIdentity,
  existing: readonly (PayerIdentity & { payerId: number })[],
): DuplicateMatch[] {
  const phone = normalizePhone(candidate.phone);
  const email = normalizeEmail(candidate.email);
  const nationalId = normalizeNationalId(candidate.nationalId);
  const matches: DuplicateMatch[] = [];

  for (const other of existing) {
    if (other.payerId === candidate.payerId) continue;
    if (nationalId && normalizeNationalId(other.nationalId) === nationalId) {
      matches.push({ matchedPayerId: other.payerId, field: 'NATIONAL_ID' });
    }
    if (phone && normalizePhone(other.phone) === phone) {
      matches.push({ matchedPayerId: other.payerId, field: 'PHONE' });
    }
    if (email && normalizeEmail(other.email) === email) {
      matches.push({ matchedPayerId: other.payerId, field: 'EMAIL' });
    }
  }
  return matches;
}
