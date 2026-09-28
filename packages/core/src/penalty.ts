/**
 * Overdue penalty calculation (Part 1, SQL Q3). The same rules are implemented in SQL in
 * `sql/05-penalty-procedure.sql`; an integration test checks both give the same result.
 *
 * Rules (from the brief, with our stated assumptions):
 * - Months 1-3 overdue: 5% of the unpaid amount per month.
 * - Month 4 onwards: 10% of the unpaid amount per month.
 * - Simple interest (no penalty on penalty), counted in FULL months only.
 * - Total penalty is capped at 100% of the original amount due.
 *
 * Idempotency starts here: the function returns the TOTAL penalty as of the run date, computed
 * from scratch. Callers SET assessment.penalty_amount to this value instead of adding to it, so
 * running twice on the same day gives the same answer.
 *
 * A penalty already charged is never reduced by this job (only an approved waiver can do that).
 * Without this rule, paying off the principal would make the recalculated penalty drop to zero
 * and silently wipe out penalties the payer still owes.
 */
import { fromCents, toCents } from './money';

export interface PenaltyRules {
  /** Number of months charged at the lower rate. */
  initialMonths: number;
  initialRatePercent: number;
  laterRatePercent: number;
  /** Cap as a percentage of the original amount due. */
  capPercent: number;
}

export const DEFAULT_PENALTY_RULES: PenaltyRules = {
  initialMonths: 3,
  initialRatePercent: 5,
  laterRatePercent: 10,
  capPercent: 100,
};

export interface PenaltyInput {
  amountDue: number;
  amountPaid: number;
  dueDate: Date;
  runDate: Date;
  /** Penalty already on the assessment; the result is never lower than this. */
  currentPenalty?: number;
}

export interface PenaltyResult {
  monthsOverdue: number;
  unpaidAmount: number;
  /** Total penalty to date (not an increment). */
  penaltyAmount: number;
  capped: boolean;
}

/**
 * Whole calendar months between two dates, in UTC. The count only goes up on or after the same
 * day of the month (31 Jan -> 28 Feb is 0 months, 31 Jan -> 1 Mar is 1 month). This matches
 * PostgreSQL's `age()` so the SQL and TypeScript versions agree.
 */
export function fullMonthsBetween(from: Date, to: Date): number {
  if (to <= from) return 0;
  const months =
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
  return to.getUTCDate() < from.getUTCDate() ? months - 1 : months;
}

export function calculatePenalty(
  input: PenaltyInput,
  rules: PenaltyRules = DEFAULT_PENALTY_RULES,
): PenaltyResult {
  const amountDueCents = toCents(input.amountDue);
  const unpaidCents = Math.max(0, amountDueCents - toCents(input.amountPaid));
  const monthsOverdue = fullMonthsBetween(input.dueDate, input.runDate);

  const currentCents = toCents(input.currentPenalty ?? 0);

  if (unpaidCents === 0 || monthsOverdue === 0) {
    return {
      monthsOverdue,
      unpaidAmount: fromCents(unpaidCents),
      penaltyAmount: fromCents(currentCents),
      capped: false,
    };
  }

  const initialMonths = Math.min(monthsOverdue, rules.initialMonths);
  const laterMonths = Math.max(0, monthsOverdue - rules.initialMonths);
  const totalPercent =
    initialMonths * rules.initialRatePercent + laterMonths * rules.laterRatePercent;

  const uncappedCents = Math.round((unpaidCents * totalPercent) / 100);
  const capCents = Math.round((amountDueCents * rules.capPercent) / 100);
  const penaltyCents = Math.max(currentCents, Math.min(uncappedCents, capCents));

  return {
    monthsOverdue,
    unpaidAmount: fromCents(unpaidCents),
    penaltyAmount: fromCents(penaltyCents),
    capped: uncappedCents > capCents,
  };
}
