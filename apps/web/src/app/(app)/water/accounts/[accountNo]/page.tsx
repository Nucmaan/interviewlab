import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { PrintButton } from '@/components/print-button';
import { StatusBadge } from '@/components/status-badge';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { formatDate, formatMoney } from '@/lib/format';
import { requirePermission } from '@/lib/rbac';
import { getAccountStatement } from '@/modules/water/services/billing';

export const metadata = { title: 'Customer statement' };

export default async function AccountStatementPage({
  params,
}: {
  params: Promise<{ accountNo: string }>;
}) {
  await requirePermission('water.view');
  const accountNo = decodeURIComponent((await params).accountNo).toUpperCase();
  const data = await getAccountStatement(accountNo);
  if (!data) notFound();
  const { account, statement } = data;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`Statement · ${account.account_no}`}
        description={
          <>
            <Link className="text-primary hover:underline" href={`/payers/${account.payer_id}`}>
              {account.payer.full_name}
            </Link>{' '}
            · meter {account.meter_no} ({account.meter_digits} digits) · {account.tariff_class} ·
            balance <strong>{formatMoney(statement.closingBalance)}</strong>
          </>
        }
        actions={<PrintButton label="Print statement" />}
      />

      <Card>
        <CardHeader>
          <CardTitle>Bills, payments and running balance</CardTitle>
        </CardHeader>
        <Table>
          <THead>
            <Tr>
              <Th>Date</Th>
              <Th>Reference</Th>
              <Th>Description</Th>
              <Th className="text-right">Debit</Th>
              <Th className="text-right">Credit</Th>
              <Th className="text-right">Balance</Th>
            </Tr>
          </THead>
          <TBody>
            {statement.lines.map((line, i) => (
              <Tr key={`${line.reference}-${line.type}-${i}`}>
                <Td>{formatDate(line.date)}</Td>
                <Td className="font-mono text-xs">{line.reference}</Td>
                <Td>{line.description}</Td>
                <Td className="text-right">{line.debit ? formatMoney(line.debit) : ''}</Td>
                <Td className="text-right">{line.credit ? formatMoney(line.credit) : ''}</Td>
                <Td className="text-right font-medium">{formatMoney(line.runningBalance)}</Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </Card>

      <Card className="print:hidden">
        <CardHeader>
          <CardTitle>Bills</CardTitle>
        </CardHeader>
        <Table>
          <THead>
            <Tr>
              <Th>Month</Th>
              <Th>Control number</Th>
              <Th className="text-right">m³</Th>
              <Th className="text-right">Charges</Th>
              <Th className="text-right">Arrears b/f</Th>
              <Th className="text-right">Total due</Th>
              <Th className="text-right">Paid</Th>
              <Th>Status</Th>
              <Th />
            </Tr>
          </THead>
          <TBody>
            {[...account.bills].reverse().map((b) => (
              <Tr key={b.bill_id}>
                <Td>{b.billing_month.toISOString().slice(0, 7)}</Td>
                <Td className="font-mono text-xs">{b.control_number}</Td>
                <Td className="text-right">
                  {b.consumption_m3}
                  {b.is_estimated ? ' (est.)' : ''}
                </Td>
                <Td className="text-right">{formatMoney(b.amount_billed.toString())}</Td>
                <Td className="text-right">{formatMoney(b.arrears_brought_forward.toString())}</Td>
                <Td className="text-right">{formatMoney(b.total_due.toString())}</Td>
                <Td className="text-right">{formatMoney(b.amount_paid.toString())}</Td>
                <Td>
                  <StatusBadge status={b.status} />
                </Td>
                <Td>
                  <a
                    className="text-primary hover:underline"
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
