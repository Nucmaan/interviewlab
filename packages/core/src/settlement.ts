/**
 * Currency conversion and applying payments to what they pay for (assessments and water bills).
 */
import { fromCents, toCents } from './money';
import type { Currency } from './payment-validation';

/** The platform's reporting currency. All totals are added up in this currency. */
export const BASE_CURRENCY: Currency = 'SOS';

/**
 * Converts an amount to the base currency. `rateToBase` is how many base units one unit of the
 * payment currency is worth (e.g. 1 USD = 571.25 SOS). The rate used is stored on the payment so
 * the conversion can always be explained later, even after rates change.
 */
export function convertToBase(amount: number, currency: Currency, rateToBase: number): number {
  if (currency === BASE_CURRENCY) return amount;
  if (!(rateToBase > 0)) {
    throw new RangeError(`No valid exchange rate for ${currency}`);
  }
  return fromCents(Math.round(toCents(amount) * rateToBase));
}

export type SettlementStatus = 'OPEN' | 'PART_PAID' | 'PAID';

export function settlementStatus(totalDue: number, amountPaid: number): SettlementStatus {
  const dueCents = toCents(totalDue);
  const paidCents = toCents(amountPaid);
  if (paidCents <= 0) return 'OPEN';
  return paidCents >= dueCents ? 'PAID' : 'PART_PAID';
}

export interface SettlementResult {
  amountPaid: number;
  status: SettlementStatus;
  /** Amount paid above what was due (kept as credit, reported to the officer). */
  overpayment: number;
}

/**
 * Applies a payment (positive) or a reversal (negative) to an assessment or bill.
 * An assessment is fully paid only when the principal AND the penalty are covered.
 */
export function applyPayment(
  target: { totalDue: number; amountPaid: number },
  amountBase: number,
): SettlementResult {
  const paidCents = Math.max(0, toCents(target.amountPaid) + toCents(amountBase));
  const dueCents = toCents(target.totalDue);
  return {
    amountPaid: fromCents(paidCents),
    status: settlementStatus(target.totalDue, fromCents(paidCents)),
    overpayment: fromCents(Math.max(0, paidCents - dueCents)),
  };
}
