/**
 * Reconciliation helpers (POC modules 5 and 6).
 *
 * - Channel reconciliation: match IRCUB payments to the bank / mobile money statement line by
 *   line on external_ref, then compare amounts.
 * - FMIS reconciliation: compare IRCUB totals with FMIS totals per (day, GL code).
 */
import { fromCents, toCents } from './money';

export type ChannelMatchStatus =
  'MATCHED' | 'AMOUNT_MISMATCH' | 'MISSING_IN_IRCUB' | 'MISSING_IN_STATEMENT';

export interface ChannelRecord {
  externalRef: string;
  amount: number;
  currency: string;
}

export interface ChannelReconciliationRow {
  externalRef: string;
  ircubAmount: number | null;
  statementAmount: number | null;
  currency: string;
  status: ChannelMatchStatus;
}

export function reconcileChannelStatement(
  ircub: readonly ChannelRecord[],
  statement: readonly ChannelRecord[],
): { rows: ChannelReconciliationRow[]; summary: Record<ChannelMatchStatus, number> } {
  const statementByRef = new Map(statement.map((line) => [line.externalRef, line]));
  const rows: ChannelReconciliationRow[] = [];

  for (const record of ircub) {
    const line = statementByRef.get(record.externalRef);
    statementByRef.delete(record.externalRef);
    if (!line) {
      rows.push({
        externalRef: record.externalRef,
        ircubAmount: record.amount,
        statementAmount: null,
        currency: record.currency,
        status: 'MISSING_IN_STATEMENT',
      });
      continue;
    }
    const sameAmount =
      toCents(line.amount) === toCents(record.amount) && line.currency === record.currency;
    rows.push({
      externalRef: record.externalRef,
      ircubAmount: record.amount,
      statementAmount: line.amount,
      currency: record.currency,
      status: sameAmount ? 'MATCHED' : 'AMOUNT_MISMATCH',
    });
  }
  // Whatever is left on the statement was collected by the channel but never reached IRCUB
  // (for example a lost callback) - the most important thing to chase.
  for (const line of statementByRef.values()) {
    rows.push({
      externalRef: line.externalRef,
      ircubAmount: null,
      statementAmount: line.amount,
      currency: line.currency,
      status: 'MISSING_IN_IRCUB',
    });
  }

  const summary: Record<ChannelMatchStatus, number> = {
    MATCHED: 0,
    AMOUNT_MISMATCH: 0,
    MISSING_IN_IRCUB: 0,
    MISSING_IN_STATEMENT: 0,
  };
  for (const row of rows) summary[row.status] += 1;
  return { rows, summary };
}

export interface TotalsRow {
  businessDate: string;
  glCode: string;
  amount: number;
}

export interface TotalsComparison {
  businessDate: string;
  glCode: string;
  ircubTotal: number;
  fmisTotal: number;
  difference: number;
  matched: boolean;
}

export function compareTotals(
  ircub: readonly TotalsRow[],
  fmis: readonly TotalsRow[],
): TotalsComparison[] {
  const key = (row: TotalsRow) => `${row.businessDate}|${row.glCode}`;
  const combined = new Map<
    string,
    { businessDate: string; glCode: string; ircub: number; fmis: number }
  >();
  const add = (row: TotalsRow, side: 'ircub' | 'fmis') => {
    const entry = combined.get(key(row)) ?? {
      businessDate: row.businessDate,
      glCode: row.glCode,
      ircub: 0,
      fmis: 0,
    };
    entry[side] += toCents(row.amount);
    combined.set(key(row), entry);
  };
  ircub.forEach((row) => add(row, 'ircub'));
  fmis.forEach((row) => add(row, 'fmis'));

  return [...combined.values()]
    .sort(
      (a, b) => b.businessDate.localeCompare(a.businessDate) || a.glCode.localeCompare(b.glCode),
    )
    .map((entry) => ({
      businessDate: entry.businessDate,
      glCode: entry.glCode,
      ircubTotal: fromCents(entry.ircub),
      fmisTotal: fromCents(entry.fmis),
      difference: fromCents(entry.ircub - entry.fmis),
      matched: entry.ircub === entry.fmis,
    }));
}
