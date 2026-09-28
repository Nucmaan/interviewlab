/**
 * Business validation of incoming payment records (Part 1, Data Validation & Concurrency).
 *
 * The shape of each record (types, required fields) is checked first with Zod at the API edge.
 * This function then checks the business rules that need reference data:
 *   amount > 0, payer exists, revenue code exists and is active, external_ref is unique
 *   (both against the database and inside the same upload), plus the reference is for the payer.
 *
 * It is pure: the caller loads the reference data in a few bulk queries and passes it in as Sets
 * and Maps. That keeps it fast for 10,000-row uploads (no query per row) and easy to unit test.
 */

export type Currency = 'USD' | 'SOS';
export type PaymentChannel = 'BANK' | 'MOBILE_MONEY' | 'CASH';

export interface PaymentRecord {
  payerId: number;
  revenueCode: string;
  amount: number;
  currency: Currency;
  channel: PaymentChannel;
  externalRef: string;
  paidAt: Date;
  assessmentId?: number | null;
  billId?: number | null;
}

export interface ValidationContext {
  knownPayerIds: ReadonlySet<number>;
  /** revenue_code -> is_active */
  revenueCodes: ReadonlyMap<string, { isActive: boolean }>;
  existingExternalRefs: ReadonlySet<string>;
  assessments: ReadonlyMap<number, { payerId: number; revenueCode: string }>;
  bills: ReadonlyMap<number, { payerId: number }>;
  /** Payments dated in the future are rejected; allow a little clock skew. */
  now: Date;
}

export interface RejectedRecord<T> {
  /** 1-based row number, as a user would count rows in a file. */
  row: number;
  record: T;
  reason: string;
}

export interface ValidationResult<T> {
  valid: { row: number; record: T }[];
  rejected: RejectedRecord<T>[];
}

const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

/** Returns the first rule the record breaks, or null if it is valid. */
export function validatePaymentRecord(
  record: PaymentRecord,
  context: ValidationContext,
  refsSeenInBatch: ReadonlySet<string>,
): string | null {
  if (!Number.isFinite(record.amount) || record.amount <= 0) {
    return 'Amount must be greater than 0';
  }
  // Compare with a tolerance: 19.99 * 100 is 1998.9999999999998 in floating point.
  if (Math.abs(record.amount * 100 - Math.round(record.amount * 100)) > 1e-6) {
    return 'Amount cannot have more than 2 decimal places';
  }
  if (!context.knownPayerIds.has(record.payerId)) {
    return `Payer ${record.payerId} does not exist`;
  }
  const revenueType = context.revenueCodes.get(record.revenueCode);
  if (!revenueType) {
    return `Revenue code ${record.revenueCode} is not valid`;
  }
  if (!revenueType.isActive) {
    return `Revenue code ${record.revenueCode} is not active`;
  }
  const ref = record.externalRef.trim();
  if (!ref) {
    return 'External reference is required';
  }
  if (context.existingExternalRefs.has(ref)) {
    return `Duplicate external reference ${ref} (already received)`;
  }
  if (refsSeenInBatch.has(ref)) {
    return `Duplicate external reference ${ref} (repeated in this upload)`;
  }
  if (record.paidAt.getTime() > context.now.getTime() + FUTURE_TOLERANCE_MS) {
    return 'Payment date is in the future';
  }
  if (record.assessmentId != null) {
    const assessment = context.assessments.get(record.assessmentId);
    if (!assessment) return `Assessment ${record.assessmentId} does not exist`;
    if (assessment.payerId !== record.payerId) {
      return `Assessment ${record.assessmentId} belongs to another payer`;
    }
    if (assessment.revenueCode !== record.revenueCode) {
      return `Assessment ${record.assessmentId} is for revenue code ${assessment.revenueCode}`;
    }
  }
  if (record.billId != null) {
    const bill = context.bills.get(record.billId);
    if (!bill) return `Water bill ${record.billId} does not exist`;
    if (bill.payerId !== record.payerId)
      return `Water bill ${record.billId} belongs to another payer`;
  }
  return null;
}

export function validatePaymentRecords<T extends PaymentRecord>(
  records: readonly T[],
  context: ValidationContext,
): ValidationResult<T> {
  const result: ValidationResult<T> = { valid: [], rejected: [] };
  const refsSeen = new Set<string>();

  records.forEach((record, index) => {
    const row = index + 1;
    const reason = validatePaymentRecord(record, context, refsSeen);
    if (reason) {
      result.rejected.push({ row, record, reason });
    } else {
      result.valid.push({ row, record });
    }
    // Remember the ref even when the row was rejected for another reason, so a second row with
    // the same ref is still reported as a duplicate.
    refsSeen.add(record.externalRef.trim());
  });
  return result;
}
