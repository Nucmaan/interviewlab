import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActionForm } from '@/components/action-form';
import { PageHeader } from '@/components/page-header';
import { StatCard } from '@/components/stat-card';
import { StatusBadge } from '@/components/status-badge';
import { Alert } from '@/components/ui/alert';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { formatDate, formatDateTime, formatMoney } from '@/lib/format';
import { first, type SearchParams } from '@/lib/pagination';
import { hasPermission, requirePermission } from '@/lib/rbac';
import { updatePayerAction } from '@/modules/registry/actions/payer-actions';
import { PayerFields } from '@/modules/registry/components/payer-fields';
import { getPayerProfile } from '@/modules/registry/services/payers';

export const metadata = { title: 'Payer profile' };

/** 360-degree payer view: details, balance, assessments, water accounts and bills, payments. */
export default async function PayerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: SearchParams;
}) {
  const user = await requirePermission('payers.view');
  const payerId = Number((await params).id);
  if (!Number.isInteger(payerId) || payerId <= 0) notFound();
  const profile = await getPayerProfile(payerId);
  if (!profile) notFound();
  const { payer, assessments, payments, balance } = profile;
  const justFlagged = first((await searchParams).duplicates) === '1';
  const openFlags = [...payer.duplicate_flags, ...payer.duplicate_of].filter(
    (f) => f.status === 'OPEN',
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={payer.full_name}
        description={`TIN ${payer.tin} · ${payer.payer_type === 'BUSINESS' ? 'Business' : 'Individual'} · registered ${formatDate(payer.created_at)}`}
        actions={
          hasPermission(user, 'payments.capture') ? (
            <Link className={buttonVariants()} href="/payments/capture">
              Capture payment
            </Link>
          ) : null
        }
      />
      {justFlagged ? (
        <Alert tone="warning">
          Saved. This registration looks similar to an existing payer and was flagged for review.
        </Alert>
      ) : null}
      {openFlags.length > 0 ? (
        <Alert tone="warning">
          Possible duplicate:{' '}
          {payer.duplicate_flags
            .filter((f) => f.status === 'OPEN')
            .map((f) => (
              <Link key={f.flag_id} className="underline" href={`/payers/${f.matched_payer_id}`}>
                {f.matched_payer.full_name} (same {f.match_field.replace('_', ' ').toLowerCase()})
              </Link>
            ))}{' '}
          {payer.duplicate_of
            .filter((f) => f.status === 'OPEN')
            .map((f) => (
              <Link key={f.flag_id} className="underline" href={`/payers/${f.payer_id}`}>
                {f.payer.full_name} (same {f.match_field.replace('_', ' ').toLowerCase()})
              </Link>
            ))}
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total outstanding" value={formatMoney(balance.totalOutstanding)} />
        <StatCard
          label="Tax outstanding"
          value={formatMoney(balance.taxOutstanding)}
          hint="Including penalties"
        />
        <StatCard
          label="Water outstanding"
          value={formatMoney(balance.waterOutstanding)}
          hint="Latest bills incl. arrears"
        />
        <StatCard label="Paid in last 12 months" value={formatMoney(balance.paidLast12Months)} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Assessments</CardTitle>
        </CardHeader>
        <Table>
          <THead>
            <Tr>
              <Th>Control number</Th>
              <Th>Type</Th>
              <Th>Period</Th>
              <Th>Due</Th>
              <Th className="text-right">Amount due</Th>
              <Th className="text-right">Penalty</Th>
              <Th className="text-right">Paid</Th>
              <Th>Status</Th>
            </Tr>
          </THead>
          <TBody>
            {assessments.map((a) => (
              <Tr key={a.assessment_id}>
                <Td className="font-mono text-xs">{a.control_number}</Td>
                <Td>{a.revenue_code}</Td>
                <Td>{a.period}</Td>
                <Td>{formatDate(a.due_date)}</Td>
                <Td className="text-right">{formatMoney(a.amount_due.toString())}</Td>
                <Td className="text-right">{formatMoney(a.penalty_amount.toString())}</Td>
                <Td className="text-right">{formatMoney(a.amount_paid.toString())}</Td>
                <Td>
                  <StatusBadge status={a.status} />
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Water accounts</CardTitle>
        </CardHeader>
        <Table>
          <THead>
            <Tr>
              <Th>Account</Th>
              <Th>Meter</Th>
              <Th>Tariff class</Th>
              <Th>Latest bill</Th>
              <Th className="text-right">Total due</Th>
              <Th>Status</Th>
              <Th />
            </Tr>
          </THead>
          <TBody>
            {payer.water_accounts.map((account) => {
              const bill = account.bills[0];
              return (
                <Tr key={account.account_no}>
                  <Td>{account.account_no}</Td>
                  <Td>{account.meter_no}</Td>
                  <Td>{account.tariff_class}</Td>
                  <Td>{bill ? formatDate(bill.billing_month).slice(0, 7) : '—'}</Td>
                  <Td className="text-right">
                    {bill ? formatMoney(bill.total_due.toString()) : '—'}
                  </Td>
                  <Td>{bill ? <StatusBadge status={bill.status} /> : null}</Td>
                  <Td>
                    <Link
                      className="text-primary hover:underline"
                      href={`/water/accounts/${account.account_no}`}
                    >
                      Statement
                    </Link>
                  </Td>
                </Tr>
              );
            })}
          </TBody>
        </Table>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent payments</CardTitle>
        </CardHeader>
        <Table>
          <THead>
            <Tr>
              <Th>Paid at</Th>
              <Th>Reference</Th>
              <Th>Type</Th>
              <Th>Channel</Th>
              <Th className="text-right">Amount</Th>
              <Th>Status</Th>
            </Tr>
          </THead>
          <TBody>
            {payments.map((p) => (
              <Tr key={p.payment_id}>
                <Td>{formatDateTime(p.paid_at)}</Td>
                <Td>
                  {hasPermission(user, 'payments.view') ? (
                    <Link
                      className="text-primary hover:underline"
                      href={`/payments/${p.payment_id}`}
                    >
                      {p.external_ref}
                    </Link>
                  ) : (
                    p.external_ref
                  )}
                </Td>
                <Td>{p.revenue_code}</Td>
                <Td>{p.channel.replace('_', ' ')}</Td>
                <Td className="text-right">{formatMoney(p.amount.toString(), p.currency)}</Td>
                <Td>
                  <StatusBadge status={p.status} />
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </Card>

      {hasPermission(user, 'payers.edit') ? (
        <Card>
          <CardHeader>
            <CardTitle>Edit details</CardTitle>
          </CardHeader>
          <CardContent>
            <ActionForm
              action={updatePayerAction}
              extra={{ payerId }}
              successMessage="Saved. Changes are recorded in the audit log."
            >
              <PayerFields defaults={payer} />
            </ActionForm>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
