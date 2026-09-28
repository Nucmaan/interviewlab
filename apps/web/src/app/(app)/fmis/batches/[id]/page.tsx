import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Card } from '@/components/ui/card';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { prisma } from '@/lib/db';
import { formatDate, formatMoney } from '@/lib/format';
import { requirePermission } from '@/lib/rbac';

export const metadata = { title: 'Journal batch' };

/** Full traceability: every line of the batch and the payment behind each credit. */
export default async function BatchPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission('fmis.view');
  const batchId = Number((await params).id);
  if (!Number.isInteger(batchId) || batchId <= 0) notFound();
  const batch = await prisma.journalBatch.findUnique({
    where: { batch_id: batchId },
    include: {
      lines: {
        orderBy: { line_id: 'asc' },
        include: { payment: { select: { external_ref: true, channel: true } } },
      },
    },
  });
  if (!batch) notFound();

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={`Journal batch #${batch.batch_id}`}
        description={
          <>
            {batch.batch_type} · business date {formatDate(batch.business_date)} ·{' '}
            <StatusBadge status={batch.status} /> · FMIS {batch.fmis_reference ?? '—'} · debits{' '}
            {formatMoney(batch.total_debit.toString())} = credits{' '}
            {formatMoney(batch.total_credit.toString())}
          </>
        }
      />
      {batch.last_error ? (
        <p className="text-sm text-destructive">Last error: {batch.last_error}</p>
      ) : null}
      <Card>
        <Table>
          <THead>
            <Tr>
              <Th>Line</Th>
              <Th>GL code</Th>
              <Th>Description</Th>
              <Th>Payment</Th>
              <Th className="text-right">Debit</Th>
              <Th className="text-right">Credit</Th>
            </Tr>
          </THead>
          <TBody>
            {batch.lines.map((l) => {
              const paymentId = l.payment_id ?? l.reversal_of_payment_id;
              return (
                <Tr key={l.line_id}>
                  <Td>{l.line_id}</Td>
                  <Td className="font-mono">{l.gl_code}</Td>
                  <Td>{l.description}</Td>
                  <Td>
                    {paymentId ? (
                      <Link
                        className="text-primary hover:underline"
                        href={`/payments/${paymentId}`}
                      >
                        {l.payment?.external_ref ?? `#${paymentId}`}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </Td>
                  <Td className="text-right">
                    {Number(l.debit) ? formatMoney(l.debit.toString()) : ''}
                  </Td>
                  <Td className="text-right">
                    {Number(l.credit) ? formatMoney(l.credit.toString()) : ''}
                  </Td>
                </Tr>
              );
            })}
          </TBody>
        </Table>
      </Card>
    </div>
  );
}
