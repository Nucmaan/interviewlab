import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActionButton } from '@/components/action-form';
import { PageHeader } from '@/components/page-header';
import { PrintButton } from '@/components/print-button';
import { RefreshOnEvent } from '@/components/refresh-on-event';
import { StatCard } from '@/components/stat-card';
import { StatusBadge } from '@/components/status-badge';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { prisma } from '@/lib/db';
import { formatMoney } from '@/lib/format';
import { hasPermission, requirePermission } from '@/lib/rbac';
import { releaseBillAction } from '@/modules/water/actions/water-actions';

export const metadata = { title: 'Billing cycle' };

interface ExceptionRow {
  accountNo: string;
  type: string;
  message: string;
}

/** Billing run result: totals, the exception report and the bills (held ones first). */
export default async function BillingCyclePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission(['billing.run', 'water.view']);
  const cycleId = Number((await params).id);
  if (!Number.isInteger(cycleId) || cycleId <= 0) notFound();
  const cycle = await prisma.billingCycle.findUnique({ where: { cycle_id: cycleId } });
  if (!cycle) notFound();
  const bills = await prisma.waterBill.findMany({
    where: { cycle_id: cycleId },
    orderBy: [{ is_abnormal: 'desc' }, { account_no: 'asc' }],
    include: { account: { include: { payer: { select: { full_name: true } } } } },
  });
  const exceptions = (Array.isArray(cycle.exceptions)
    ? cycle.exceptions
    : []) as unknown as ExceptionRow[];
  const totalBilled = bills.reduce((s, b) => s + Number(b.amount_billed), 0);
  const canRelease = hasPermission(user, 'billing.release');

  return (
    <div className="flex flex-col gap-6">
      <RefreshOnEvent types={['billing.cycle']} />
      <PageHeader
        title={`Billing cycle ${cycle.billing_month.toISOString().slice(0, 7)}`}
        description={<StatusBadge status={cycle.status} />}
        actions={<PrintButton label="Print exception report" />}
      />
      {cycle.status === 'RUNNING' ? (
        <Alert tone="info">
          Billing is running. This page refreshes automatically when it finishes.
        </Alert>
      ) : null}
      {cycle.error ? <Alert tone="danger">The cycle failed: {cycle.error}</Alert> : null}
      <div className="grid gap-4 sm:grid-cols-4">
        <StatCard label="Bills created" value={cycle.bills_created} />
        <StatCard label="Held for review" value={cycle.bills_held} />
        <StatCard label="Exceptions" value={exceptions.length} />
        <StatCard label="Current charges billed" value={formatMoney(totalBilled)} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Exception report</CardTitle>
        </CardHeader>
        <Table>
          <THead>
            <Tr>
              <Th>Account</Th>
              <Th>Type</Th>
              <Th>Detail</Th>
            </Tr>
          </THead>
          <TBody>
            {exceptions.map((e, i) => (
              <Tr key={`${e.accountNo}-${e.type}-${i}`}>
                <Td>
                  <Link
                    className="text-primary hover:underline"
                    href={`/water/accounts/${e.accountNo}`}
                  >
                    {e.accountNo}
                  </Link>
                </Td>
                <Td>
                  <Badge tone={e.type === 'ABNORMAL' || e.type === 'ERROR' ? 'danger' : 'warning'}>
                    {e.type.replace('_', ' ')}
                  </Badge>
                </Td>
                <Td>{e.message}</Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </Card>

      <Card className="print:hidden">
        <CardHeader>
          <CardTitle>Bills in this cycle</CardTitle>
        </CardHeader>
        <Table>
          <THead>
            <Tr>
              <Th>Account</Th>
              <Th>Customer</Th>
              <Th className="text-right">m³</Th>
              <Th className="text-right">Charges</Th>
              <Th className="text-right">Arrears b/f</Th>
              <Th className="text-right">Total due</Th>
              <Th>Status</Th>
              <Th />
            </Tr>
          </THead>
          <TBody>
            {bills.map((b) => (
              <Tr key={b.bill_id}>
                <Td>{b.account_no}</Td>
                <Td>{b.account.payer.full_name}</Td>
                <Td className="text-right">
                  {b.consumption_m3}
                  {b.is_estimated ? ' (est.)' : ''}
                </Td>
                <Td className="text-right">{formatMoney(b.amount_billed.toString())}</Td>
                <Td className="text-right">{formatMoney(b.arrears_brought_forward.toString())}</Td>
                <Td className="text-right">{formatMoney(b.total_due.toString())}</Td>
                <Td>
                  <StatusBadge status={b.status} />
                </Td>
                <Td className="flex gap-2">
                  {b.status === 'HELD' && canRelease ? (
                    <ActionButton
                      action={releaseBillAction}
                      input={{ billId: b.bill_id }}
                      label="Release"
                      variant="default"
                    />
                  ) : null}
                  <a
                    className="text-sm text-primary hover:underline"
                    href={`/api/water/bills/${b.bill_id}/pdf`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    PDF
                  </a>
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </Card>
    </div>
  );
}
