import { roundMoney } from '@ircub/core';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Alert } from '@/components/ui/alert';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { formatDate, formatDateTime, formatMoney } from '@/lib/format';
import { requirePermission } from '@/lib/rbac';
import { PayButton } from '@/modules/payments/components/pay-button';
import { getPortalData } from '@/modules/payments/services/portal';

export const metadata = { title: 'My account' };

/** Taxpayer / customer self-service: own assessments, bills and payments, and paying them. */
export default async function PortalPage() {
  const user = await requirePermission('self.view');
  if (!user.payerId) {
    return (
      <Alert tone="warning">
        Your login is not linked to a taxpayer record. Please contact the revenue office.
      </Alert>
    );
  }
  const { payer, assessments, accounts, payments } = await getPortalData(user.payerId);
  const canPay = user.permissions.has('self.pay');

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={payer.full_name} description={`TIN ${payer.tin} · ${payer.phone ?? ''}`} />

      <Card>
        <CardHeader>
          <CardTitle>Open tax assessments</CardTitle>
        </CardHeader>
        <Table>
          <THead>
            <Tr>
              <Th>Reference</Th>
              <Th>Type</Th>
              <Th>Due</Th>
              <Th className="text-right">Outstanding</Th>
              <Th>Status</Th>
              <Th />
            </Tr>
          </THead>
          <TBody>
            {assessments.length === 0 ? (
              <Tr>
                <Td colSpan={6} className="text-muted-foreground">
                  Nothing outstanding.
                </Td>
              </Tr>
            ) : null}
            {assessments.map((a) => {
              const outstanding = roundMoney(
                Number(a.amount_due) + Number(a.penalty_amount) - Number(a.amount_paid),
              );
              return (
                <Tr key={a.assessment_id}>
                  <Td className="font-mono text-xs">{a.control_number}</Td>
                  <Td>
                    {a.revenue_code} {a.period}
                  </Td>
                  <Td>{formatDate(a.due_date)}</Td>
                  <Td className="text-right">
                    {formatMoney(outstanding)}
                    {Number(a.penalty_amount) > 0 ? (
                      <div className="text-xs text-muted-foreground">
                        incl. penalty {formatMoney(a.penalty_amount.toString())}
                      </div>
                    ) : null}
                  </Td>
                  <Td>
                    <StatusBadge status={a.status} />
                  </Td>
                  <Td>
                    {canPay ? (
                      <PayButton
                        target="assessment"
                        targetId={a.assessment_id}
                        outstanding={outstanding}
                        defaultPhone={payer.phone ?? ''}
                      />
                    ) : null}
                  </Td>
                </Tr>
              );
            })}
          </TBody>
        </Table>
      </Card>

      {accounts.map((account) => (
        <Card key={account.account_no}>
          <CardHeader>
            <CardTitle>
              Water account {account.account_no} · meter {account.meter_no}
            </CardTitle>
          </CardHeader>
          <Table>
            <THead>
              <Tr>
                <Th>Month</Th>
                <Th>Reference</Th>
                <Th className="text-right">m³</Th>
                <Th className="text-right">Total due</Th>
                <Th className="text-right">Paid</Th>
                <Th>Status</Th>
                <Th />
              </Tr>
            </THead>
            <TBody>
              {account.bills.map((b, index) => {
                const outstanding = roundMoney(Number(b.total_due) - Number(b.amount_paid));
                const payable = index === 0 && (b.status === 'ISSUED' || b.status === 'PART_PAID');
                return (
                  <Tr key={b.bill_id}>
                    <Td>{b.billing_month.toISOString().slice(0, 7)}</Td>
                    <Td className="font-mono text-xs">{b.control_number}</Td>
                    <Td className="text-right">{b.consumption_m3}</Td>
                    <Td className="text-right">{formatMoney(b.total_due.toString())}</Td>
                    <Td className="text-right">{formatMoney(b.amount_paid.toString())}</Td>
                    <Td>
                      <StatusBadge status={b.status} />
                    </Td>
                    <Td className="flex flex-wrap items-center gap-3">
                      <a
                        className="text-sm text-primary hover:underline"
                        href={`/api/water/bills/${b.bill_id}/pdf`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        PDF
                      </a>
                      {payable && canPay ? (
                        <PayButton
                          target="bill"
                          targetId={b.bill_id}
                          outstanding={outstanding}
                          defaultPhone={payer.phone ?? ''}
                        />
                      ) : null}
                    </Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
        </Card>
      ))}

      <Card>
        <CardHeader>
          <CardTitle>My recent payments</CardTitle>
        </CardHeader>
        <Table>
          <THead>
            <Tr>
              <Th>Date</Th>
              <Th>Reference</Th>
              <Th>Channel</Th>
              <Th className="text-right">Amount</Th>
              <Th>Status</Th>
            </Tr>
          </THead>
          <TBody>
            {payments.map((p) => (
              <Tr key={p.payment_id}>
                <Td>{formatDateTime(p.paid_at)}</Td>
                <Td className="font-mono text-xs">{p.external_ref}</Td>
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
    </div>
  );
}
