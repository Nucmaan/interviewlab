import 'server-only';
import { reconcileChannelStatement, type ChannelReconciliationRow } from '@ircub/core';
import Papa from 'papaparse';
import { audit } from '@/lib/audit';
import { prisma } from '@/lib/db';
import { DomainError } from '@/lib/errors';
import { callMockService } from '@/lib/mock-services';
import type { CurrentUser } from '@/lib/rbac';

export type StatementChannel = 'BANK' | 'MOBILE_MONEY';

export interface ChannelReconciliation {
  channel: StatementChannel;
  date: string;
  rows: ChannelReconciliationRow[];
  summary: Record<ChannelReconciliationRow['status'], number>;
  statementLines: number;
  ircubPayments: number;
}

/** Downloads the day's statement CSV from the (mock) bank or mobile money provider. */
export function fetchChannelStatement(channel: StatementChannel, date: string): Promise<string> {
  return callMockService<string>(
    'GET',
    `/statements/${channel}/${date}`,
    undefined,
    'The channel statement service',
  );
}

/**
 * Daily channel reconciliation (POC module 5): stores the statement lines, matches them to IRCUB
 * payments of the same channel and day on external_ref, and records the result on each line.
 * Re-importing the same day replaces that day's lines, so the report can be re-run safely.
 */
export async function reconcileChannelDay(
  channel: StatementChannel,
  date: string,
  csv: string,
  user: CurrentUser,
): Promise<ChannelReconciliation> {
  const parsed = Papa.parse<Record<string, string>>(csv.trim(), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase(),
  });
  if (parsed.data.length > 0 && !parsed.meta.fields?.includes('external_ref')) {
    throw new DomainError('The statement needs the columns external_ref, amount, currency');
  }
  const statement = parsed.data
    .filter((r) => r.external_ref)
    .map((r) => ({
      externalRef: r.external_ref!.trim(),
      amount: Number(r.amount),
      currency: (r.currency ?? '').trim().toUpperCase(),
    }));
  const bad = statement.find(
    (s) => !Number.isFinite(s.amount) || !['USD', 'SOS'].includes(s.currency),
  );
  if (bad)
    throw new DomainError(`Statement line ${bad.externalRef} has an invalid amount or currency`);

  const dayStart = new Date(`${date}T00:00:00Z`);
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);
  const payments = await prisma.payment.findMany({
    where: { channel, status: 'DONE', paid_at: { gte: dayStart, lt: dayEnd } },
    select: { payment_id: true, external_ref: true, amount: true, currency: true },
  });
  const result = reconcileChannelStatement(
    payments.map((p) => ({
      externalRef: p.external_ref,
      amount: Number(p.amount),
      currency: p.currency,
    })),
    statement,
  );
  const paymentIdByRef = new Map(payments.map((p) => [p.external_ref, p.payment_id]));
  const statusByRef = new Map(result.rows.map((r) => [r.externalRef, r.status]));

  await prisma.$transaction(async (tx) => {
    await tx.channelStatementLine.deleteMany({ where: { channel, statement_date: dayStart } });
    await tx.channelStatementLine.createMany({
      data: statement.map((line) => ({
        channel,
        statement_date: dayStart,
        external_ref: line.externalRef,
        amount: line.amount,
        currency: line.currency as 'USD' | 'SOS',
        match_status: statusByRef.get(line.externalRef) ?? null,
        payment_id: paymentIdByRef.get(line.externalRef) ?? null,
        imported_by: user.userId,
      })),
      skipDuplicates: true,
    });
    await audit(tx, user, {
      action: 'CHANNEL_RECONCILED',
      entityType: 'channel_statement',
      entityId: `${channel}:${date}`,
      after: result.summary,
    });
  });

  return {
    channel,
    date,
    rows: result.rows,
    summary: result.summary,
    statementLines: statement.length,
    ircubPayments: payments.length,
  };
}
