import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActionForm, FieldError } from '@/components/action-form';
import { Field } from '@/components/field';
import { PageHeader } from '@/components/page-header';
import { PrintButton } from '@/components/print-button';
import { StatusBadge } from '@/components/status-badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/input';
import { prisma } from '@/lib/db';
import { formatDateTime, formatMoney } from '@/lib/format';
import { hasPermission, requirePermission } from '@/lib/rbac';
import { requestReversalAction } from '@/modules/payments/actions/reversal-actions';

export const metadata = { title: 'Payment' };

export default async function PaymentPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission('payments.view');
  const paymentId = Number((await params).id);
  if (!Number.isInteger(paymentId) || paymentId <= 0) notFound();
  const payment = await prisma.payment.findUnique({
    where: { payment_id: paymentId },
    include: {
      payer: true,
      revenue_type: true,
      assessment: true,
      bill: true,
      reversal: { include: { requester: true, decider: true } },
      journal_line: { include: { batch: true } },
    },
  });
  if (!payment) notFound();
  const canRequest =
    hasPermission(user, 'reversals.request') && payment.status === 'DONE' && !payment.reversal;

  const rows: [string, React.ReactNode][] = [
    [
      'Payer',
      <Link key="p" className="text-primary hover:underline" href={`/payers/${payment.payer_id}`}>
        {payment.payer.full_name} (TIN {payment.payer.tin})
      </Link>,
    ],
    [
      'Revenue type',
      `${payment.revenue_type.name} (${payment.revenue_code}) · GL ${payment.revenue_type.gl_code}`,
    ],
    ['Amount', formatMoney(payment.amount.toString(), payment.currency)],
    [
      'Exchange rate',
      payment.currency === 'SOS' ? '—' : `1 USD = ${payment.exchange_rate.toString()} SOS`,
    ],
    ['Amount in SOS', formatMoney(payment.amount_base.toString())],
    [
      'Channel / source',
      `${payment.channel.replace('_', ' ')} · ${payment.source.replace('_', ' ')}`,
    ],
    ['Paid at', formatDateTime(payment.paid_at)],
    ['Processed at', formatDateTime(payment.processed_at)],
    [
      'Pays for',
      payment.assessment
        ? `Assessment ${payment.assessment.control_number}`
        : payment.bill
          ? `Water bill ${payment.bill.control_number}`
          : 'General account',
    ],
    ['Provider reference', payment.provider_ref ?? '—'],
    [
      'FMIS',
      payment.journal_line ? (
        <Link
          key="f"
          className="text-primary hover:underline"
          href={`/fmis/batches/${payment.journal_line.batch_id}`}
        >
          Batch #{payment.journal_line.batch_id} ·{' '}
          {payment.journal_line.batch.fmis_reference ?? payment.journal_line.batch.status}
        </Link>
      ) : (
        payment.fmis_status
      ),
    ],
  ];

  return (
    <div className="max-w-3xl">
      <PageHeader
        title={`Payment ${payment.external_ref}`}
        description={<StatusBadge status={payment.status} />}
        actions={<PrintButton />}
      />
      {payment.failure_reason ? (
        <p className="mb-4 text-sm text-destructive">Failure reason: {payment.failure_reason}</p>
      ) : null}
      <Card className="mb-6">
        <CardContent className="pt-5">
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[12rem_1fr]">
            {rows.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-muted-foreground">{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      {payment.reversal ? (
        <Card className="mb-6 print:hidden">
          <CardHeader>
            <CardTitle>
              Reversal <StatusBadge status={payment.reversal.status} />
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <p>Reason: {payment.reversal.reason}</p>
            <p>
              Requested by {payment.reversal.requester.full_name} on{' '}
              {formatDateTime(payment.reversal.requested_at)}
            </p>
            {payment.reversal.decider ? (
              <p>
                Decided by {payment.reversal.decider.full_name} on{' '}
                {formatDateTime(payment.reversal.decided_at)}
                {payment.reversal.decision_note ? ` — ${payment.reversal.decision_note}` : ''}
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {canRequest ? (
        <Card className="print:hidden">
          <CardHeader>
            <CardTitle>Request a reversal</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-sm text-muted-foreground">
              A different supervisor must approve it. You cannot approve a reversal you requested.
            </p>
            <ActionForm
              action={requestReversalAction}
              extra={{ paymentId }}
              submitLabel="Request reversal"
              successMessage="Reversal requested."
            >
              <Field id="reason" label="Reason">
                <Textarea id="reason" name="reason" />
                <FieldError name="reason" />
              </Field>
            </ActionForm>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
