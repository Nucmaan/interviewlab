/**
 * FMIS journal building (Part 1, FMIS Posting Integration and POC module 6).
 *
 * For one business day we build a balanced double-entry journal:
 *   - one CREDIT line per payment, to the GL code of the payment's revenue type
 *     (one line per payment gives full traceability, and UNIQUE(payment_id) on journal_line
 *     makes it impossible to post the same payment twice)
 *   - one DEBIT line for the day's total, to the collection bank account
 *
 * The payload sent to FMIS is summarised: one credit per GL code plus the bank debit. FMIS only
 * needs totals per GL; the detail stays in IRCUB for drill-down.
 */
import { fromCents, toCents } from './money';

export interface JournalPayment {
  paymentId: number;
  revenueCode: string;
  glCode: string;
  amountBase: number;
}

export interface JournalLineDraft {
  paymentId: number | null;
  glCode: string;
  revenueCode: string | null;
  debit: number;
  credit: number;
  description: string;
}

export interface JournalDraft {
  businessDate: string;
  lines: JournalLineDraft[];
  totalDebit: number;
  totalCredit: number;
}

export interface FmisJournalLine {
  glCode: string;
  debit: number;
  credit: number;
}

export class UnbalancedJournalError extends Error {
  constructor(totalDebit: number, totalCredit: number) {
    super(`Journal is not balanced: debits ${totalDebit} != credits ${totalCredit}`);
    this.name = 'UnbalancedJournalError';
  }
}

export function buildDailyJournal(
  businessDate: string,
  payments: readonly JournalPayment[],
  collectionBankGl: string,
): JournalDraft {
  if (payments.length === 0) {
    throw new Error(`No payments to journal for ${businessDate}`);
  }
  let totalCents = 0;
  const creditLines: JournalLineDraft[] = payments.map((payment) => {
    const cents = toCents(payment.amountBase);
    if (cents <= 0) {
      throw new Error(
        `Payment ${payment.paymentId} has a non-positive amount and cannot be posted`,
      );
    }
    totalCents += cents;
    return {
      paymentId: payment.paymentId,
      glCode: payment.glCode,
      revenueCode: payment.revenueCode,
      debit: 0,
      credit: fromCents(cents),
      description: `Collection ${payment.revenueCode} payment #${payment.paymentId}`,
    };
  });

  const debitLine: JournalLineDraft = {
    paymentId: null,
    glCode: collectionBankGl,
    revenueCode: null,
    debit: fromCents(totalCents),
    credit: 0,
    description: `Collections banked ${businessDate}`,
  };

  const draft: JournalDraft = {
    businessDate,
    lines: [debitLine, ...creditLines],
    totalDebit: fromCents(totalCents),
    totalCredit: fromCents(totalCents),
  };
  assertBalanced(draft.lines);
  return draft;
}

/** Double-entry rule: total debits must equal total credits (compared in cents). */
export function assertBalanced(lines: readonly Pick<JournalLineDraft, 'debit' | 'credit'>[]): void {
  const debitCents = lines.reduce((sum, line) => sum + toCents(line.debit), 0);
  const creditCents = lines.reduce((sum, line) => sum + toCents(line.credit), 0);
  if (debitCents !== creditCents) {
    throw new UnbalancedJournalError(fromCents(debitCents), fromCents(creditCents));
  }
}

/** Collapses per-payment lines into one line per GL code for the FMIS payload. */
export function summariseByGl(lines: readonly JournalLineDraft[]): FmisJournalLine[] {
  const byGl = new Map<string, { debitCents: number; creditCents: number }>();
  for (const line of lines) {
    const current = byGl.get(line.glCode) ?? { debitCents: 0, creditCents: 0 };
    current.debitCents += toCents(line.debit);
    current.creditCents += toCents(line.credit);
    byGl.set(line.glCode, current);
  }
  return [...byGl.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([glCode, totals]) => ({
      glCode,
      debit: fromCents(totals.debitCents),
      credit: fromCents(totals.creditCents),
    }));
}

/** Delay before retry attempt n (1-based): base, 2x base, 4x base ... */
export function exponentialBackoffMs(attempt: number, baseMs: number): number {
  return baseMs * 2 ** Math.max(0, attempt - 1);
}

/**
 * Journal that undoes a posted collection: each line's debit and credit swap sides
 * (debit the revenue GL, credit the bank). Used when an approved reversal hits a payment that
 * has already been posted to FMIS.
 */
export function buildReversalJournal(
  businessDate: string,
  payments: readonly JournalPayment[],
  collectionBankGl: string,
): JournalDraft {
  const original = buildDailyJournal(businessDate, payments, collectionBankGl);
  const lines = original.lines.map((line) => ({
    ...line,
    debit: line.credit,
    credit: line.debit,
    description: `Reversal: ${line.description}`,
  }));
  assertBalanced(lines);
  return { ...original, lines };
}
