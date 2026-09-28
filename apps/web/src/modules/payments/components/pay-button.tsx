'use client';

import { useState } from 'react';
import { StatusBadge } from '@/components/status-badge';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { useLiveEvents, type LiveEvent } from '@/components/use-live-events';
import { formatMoney } from '@/lib/format';
import { initiatePaymentAction } from '../actions/channel-actions';

/**
 * "Pay with mobile money" for one assessment or bill on the customer portal. After starting the
 * payment, the status updates live (callback or status-check retry -> PENDING -> DONE).
 */
export function PayButton({
  target,
  targetId,
  outstanding,
  defaultPhone,
}: {
  target: 'assessment' | 'bill';
  targetId: number;
  outstanding: number;
  defaultPhone: string;
}) {
  const [open, setOpen] = useState(false);
  const [currency, setCurrency] = useState<'SOS' | 'USD'>('SOS');
  const [msisdn, setMsisdn] = useState(defaultPhone);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payment, setPayment] = useState<{
    paymentId: number;
    amount: number;
    currency: string;
    status: string;
  } | null>(null);

  useLiveEvents(['payment.updated'], (event: LiveEvent) => {
    if (
      payment &&
      Number(event.paymentId) === payment.paymentId &&
      typeof event.status === 'string'
    ) {
      setPayment({ ...payment, status: event.status });
    }
  });

  if (payment) {
    const waiting =
      payment.status === 'AWAITING_CONFIRMATION' ||
      payment.status === 'PENDING' ||
      payment.status === 'PROCESSING';
    return (
      <div className="flex flex-col gap-1 text-sm">
        <div className="flex items-center gap-2">
          {formatMoney(payment.amount, payment.currency)} <StatusBadge status={payment.status} />
        </div>
        {payment.status === 'AWAITING_CONFIRMATION' ? (
          <span className="text-xs text-muted-foreground">Confirm the payment on your phone…</span>
        ) : null}
        {payment.status === 'DONE' ? (
          <span className="text-xs text-emerald-700">Paid. Thank you!</span>
        ) : null}
        {!waiting && payment.status !== 'DONE' ? (
          <span className="text-xs text-destructive">The payment did not go through.</span>
        ) : null}
      </div>
    );
  }

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)} disabled={outstanding <= 0}>
        Pay with mobile money
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <div className="flex flex-wrap gap-2">
        <Select
          aria-label="Currency"
          className="w-24"
          value={currency}
          onChange={(e) => setCurrency(e.target.value as 'SOS' | 'USD')}
        >
          <option value="SOS">SOS</option>
          <option value="USD">USD</option>
        </Select>
        <Input
          aria-label="Mobile number"
          className="w-44"
          inputMode="tel"
          value={msisdn}
          onChange={(e) => setMsisdn(e.target.value)}
        />
        <Button
          size="sm"
          disabled={pending}
          onClick={async () => {
            setPending(true);
            setError(null);
            const result = await initiatePaymentAction({ target, targetId, currency, msisdn });
            setPending(false);
            if (result.ok) setPayment({ ...result.data, status: 'AWAITING_CONFIRMATION' });
            else setError(result.fieldErrors?.msisdn?.[0] ?? result.error);
          }}
        >
          {pending ? 'Sending…' : `Pay ${formatMoney(outstanding)}`}
        </Button>
      </div>
    </div>
  );
}
