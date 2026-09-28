/**
 * Monthly water bill composition and the customer statement (POC module 4).
 *
 * Each bill carries the account forward like a bank statement:
 *   previous balance (last bill's total due)
 *   - payments received since the last bill
 *   = arrears brought forward (negative means the customer is in credit)
 *   + current month charges (from the tiered tariff)
 *   = total due
 */
import { fromCents, toCents } from './money';

export interface BillComposition {
  previousBalance: number;
  paymentsReceived: number;
  arrearsBroughtForward: number;
  currentCharges: number;
  totalDue: number;
}

export function composeBill(input: {
  previousBalance: number;
  paymentsReceived: number;
  currentCharges: number;
}): BillComposition {
  const arrearsCents = toCents(input.previousBalance) - toCents(input.paymentsReceived);
  const totalCents = arrearsCents + toCents(input.currentCharges);
  return {
    previousBalance: input.previousBalance,
    paymentsReceived: input.paymentsReceived,
    arrearsBroughtForward: fromCents(arrearsCents),
    currentCharges: input.currentCharges,
    totalDue: fromCents(totalCents),
  };
}

export interface StatementEntry {
  date: Date;
  type: 'BILL' | 'PAYMENT' | 'REVERSAL';
  reference: string;
  description: string;
  /** Always positive; the type decides whether it increases or reduces the balance. */
  amount: number;
}

export interface StatementLine extends StatementEntry {
  debit: number;
  credit: number;
  runningBalance: number;
}

/**
 * Customer statement with a running balance. Bills and reversed payments increase what the
 * customer owes (debit); payments reduce it (credit). Entries on the same day list bills first
 * so the balance reads naturally (billed, then paid).
 */
export function buildStatement(
  entries: readonly StatementEntry[],
  openingBalance = 0,
): { lines: StatementLine[]; closingBalance: number } {
  const order = { BILL: 0, REVERSAL: 1, PAYMENT: 2 } as const;
  const sorted = [...entries].sort(
    (a, b) => a.date.getTime() - b.date.getTime() || order[a.type] - order[b.type],
  );
  let balanceCents = toCents(openingBalance);
  const lines = sorted.map((entry) => {
    const isDebit = entry.type !== 'PAYMENT';
    const cents = toCents(entry.amount);
    balanceCents += isDebit ? cents : -cents;
    return {
      ...entry,
      debit: isDebit ? entry.amount : 0,
      credit: isDebit ? 0 : entry.amount,
      runningBalance: fromCents(balanceCents),
    };
  });
  return { lines, closingBalance: fromCents(balanceCents) };
}
