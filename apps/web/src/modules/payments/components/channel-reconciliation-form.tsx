'use client';

import { useState } from 'react';
import { Field } from '@/components/field';
import { StatusBadge } from '@/components/status-badge';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { formatMoney } from '@/lib/format';
import { reconcileChannelAction } from '../actions/channel-actions';
import type { ChannelReconciliation } from '../services/channel-reconciliation';

/** Pick a channel and day, then either download the statement from the channel or upload a CSV. */
export function ChannelReconciliationForm({ today }: { today: string }) {
  const [channel, setChannel] = useState<'BANK' | 'MOBILE_MONEY'>('MOBILE_MONEY');
  const [date, setDate] = useState(today);
  const [csv, setCsv] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ChannelReconciliation | null>(null);

  async function run() {
    setPending(true);
    setError(null);
    const result = await reconcileChannelAction({ channel, date, csv: csv ?? undefined });
    setPending(false);
    if (result.ok) setReport(result.data);
    else setError(result.error);
  }

  const problems = report?.rows.filter((r) => r.status !== 'MATCHED') ?? [];

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardContent className="grid gap-4 pt-5 md:grid-cols-4">
          <Field id="channel" label="Channel">
            <Select
              id="channel"
              value={channel}
              onChange={(e) => setChannel(e.target.value as 'BANK' | 'MOBILE_MONEY')}
            >
              <option value="MOBILE_MONEY">Mobile money</option>
              <option value="BANK">Bank</option>
            </Select>
          </Field>
          <Field id="date" label="Statement date">
            <Input
              id="date"
              type="date"
              value={date}
              max={today}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>
          <Field
            id="statement"
            label="Statement CSV (optional)"
            hint="Leave empty to download it from the channel."
          >
            <Input
              id="statement"
              type="file"
              accept=".csv,text/csv"
              onChange={async (e) =>
                setCsv(e.target.files?.[0] ? await e.target.files[0].text() : null)
              }
            />
          </Field>
          <div className="flex items-end">
            <Button onClick={() => void run()} disabled={pending}>
              {pending ? 'Reconciling…' : 'Reconcile'}
            </Button>
          </div>
        </CardContent>
      </Card>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {report ? (
        <Card>
          <CardHeader>
            <CardTitle>
              {report.channel.replace('_', ' ')} · {report.date}: {report.statementLines} statement
              lines vs {report.ircubPayments} IRCUB payments
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-4">
              {Object.entries(report.summary).map(([status, count]) => (
                <div key={status} className="rounded-md border p-3 text-center">
                  <div className="text-2xl font-semibold">{count}</div>
                  <StatusBadge status={status} />
                </div>
              ))}
            </div>
            {problems.length === 0 ? (
              <Alert tone="success">Everything matches.</Alert>
            ) : (
              <Table>
                <THead>
                  <Tr>
                    <Th>External ref</Th>
                    <Th className="text-right">IRCUB</Th>
                    <Th className="text-right">Statement</Th>
                    <Th>Result</Th>
                  </Tr>
                </THead>
                <TBody>
                  {problems.map((r) => (
                    <Tr key={r.externalRef}>
                      <Td className="font-mono text-xs">{r.externalRef}</Td>
                      <Td className="text-right">
                        {r.ircubAmount === null ? '—' : formatMoney(r.ircubAmount, r.currency)}
                      </Td>
                      <Td className="text-right">
                        {r.statementAmount === null
                          ? '—'
                          : formatMoney(r.statementAmount, r.currency)}
                      </Td>
                      <Td>
                        <StatusBadge status={r.status} />
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
