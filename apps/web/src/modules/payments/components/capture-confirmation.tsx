'use client';

import { useEffect, useState } from 'react';
import { StatusBadge } from '@/components/status-badge';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useLiveEvents, type LiveEvent } from '@/components/use-live-events';
import { formatDateTime, formatMoney } from '@/lib/format';
import type { CaptureInput } from '../schemas/payment';

export interface CaptureOutcome {
  received: number;
  accepted: number;
  rejected: number;
  errors: { row: number; reason: string }[];
  payments: { row: number; paymentId: number; externalRef: string }[];
  batchRef: string;
  paidAt: string;
  payer: { name: string; tin: string };
  capturedBy: string;
}

/**
 * Step 3 result: summary, per-line validation errors and a printable receipt. Line statuses
 * change from PENDING to DONE live, pushed by the worker over Server-Sent Events.
 */
export function CaptureConfirmation({
  outcome,
  lines,
  revenueName,
  onNew,
}: {
  outcome: CaptureOutcome;
  lines: CaptureInput['lines'];
  revenueName: string;
  onNew: () => void;
}) {
  const [statuses, setStatuses] = useState<Record<number, string>>(() =>
    Object.fromEntries(outcome.payments.map((p) => [p.paymentId, 'PENDING'])),
  );
  const { connected } = useLiveEvents(['payment.updated'], (event: LiveEvent) => {
    const id = Number(event.paymentId);
    if (id in statuses && typeof event.status === 'string') {
      setStatuses((current) => ({ ...current, [id]: event.status as string }));
    }
  });

  // The worker is often faster than the SSE connection: once connected, read the current
  // statuses once so an update published before we subscribed is not missed.
  const idsKey = outcome.payments.map((p) => p.paymentId).join(',');
  useEffect(() => {
    if (!connected || !idsKey) return;
    void fetch(`/api/payments/status?ids=${idsKey}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { statuses: Record<string, string> } | null) => {
        if (data) setStatuses((current) => ({ ...current, ...data.statuses }));
      });
  }, [connected, idsKey]);

  const byRow = new Map(outcome.payments.map((p) => [p.row, p]));
  const errorByRow = new Map(outcome.errors.map((e) => [e.row, e.reason]));

  return (
    <div className="flex flex-col gap-4">
      <div className="print:hidden">
        {outcome.rejected === 0 ? (
          <Alert tone="success">All {outcome.accepted} payment line(s) were accepted.</Alert>
        ) : (
          <Alert tone={outcome.accepted > 0 ? 'warning' : 'danger'}>
            {outcome.accepted} of {outcome.received} line(s) accepted, {outcome.rejected} rejected.
            Rejected lines were not saved as payments; correct them and capture again.
          </Alert>
        )}
      </div>

      <Card className="print:border-0 print:shadow-none">
        <CardHeader>
          <CardTitle>Payment receipt</CardTitle>
          <div className="text-sm text-muted-foreground">
            IRCUB · {formatDateTime(outcome.paidAt)} · Ref {outcome.batchRef}
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <div className="grid gap-1 sm:grid-cols-2">
            <div>
              <span className="text-muted-foreground">Payer:</span> {outcome.payer.name}
            </div>
            <div>
              <span className="text-muted-foreground">TIN:</span> {outcome.payer.tin}
            </div>
            <div>
              <span className="text-muted-foreground">Revenue type:</span> {revenueName}
            </div>
            <div>
              <span className="text-muted-foreground">Captured by:</span> {outcome.capturedBy}
            </div>
          </div>
          <table className="w-full text-left">
            <thead className="border-b text-xs uppercase text-muted-foreground">
              <tr>
                <th className="py-1">#</th>
                <th>Reference</th>
                <th>Channel</th>
                <th className="text-right">Amount</th>
                <th className="pl-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => {
                const row = index + 1;
                const payment = byRow.get(row);
                const error = errorByRow.get(row);
                return (
                  <tr key={row} className="border-b align-top">
                    <td className="py-2">{row}</td>
                    <td>
                      {line.externalRef}
                      {error ? <div className="text-xs text-destructive">{error}</div> : null}
                    </td>
                    <td>{line.channel.replace('_', ' ')}</td>
                    <td className="text-right">{formatMoney(line.amount, line.currency)}</td>
                    <td className="pl-3">
                      {payment ? (
                        <StatusBadge status={statuses[payment.paymentId] ?? 'PENDING'} />
                      ) : (
                        <StatusBadge status="REJECTED" />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="text-xs text-muted-foreground">
            USD amounts are converted to SOS at the day&apos;s rate. This receipt is valid for
            accepted lines only.
          </p>
        </CardContent>
      </Card>

      <div className="flex gap-2 print:hidden">
        <Button onClick={() => window.print()}>Print receipt</Button>
        <Button variant="outline" onClick={onNew}>
          Capture another payment
        </Button>
      </div>
    </div>
  );
}
