import { PageHeader } from '@/components/page-header';
import { Pagination } from '@/components/pagination';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { prisma } from '@/lib/db';
import { formatDateTime } from '@/lib/format';
import { parsePage, toPage, type SearchParams } from '@/lib/pagination';
import { requirePermission } from '@/lib/rbac';

export const metadata = { title: 'Rejected records' };

/** Invalid payment rows and declined callbacks, kept separately for administrator review. */
export default async function RejectedPage({ searchParams }: { searchParams: SearchParams }) {
  await requirePermission(['payments.upload', 'reversals.approve', 'audit.view']);
  const params = await searchParams;
  const page = parsePage(params);
  const [rows, total] = await Promise.all([
    prisma.rejectedPayment.findMany({
      orderBy: { created_at: 'desc' },
      skip: page.skip,
      take: page.take,
    }),
    prisma.rejectedPayment.count(),
  ]);
  const result = toPage(rows, total, page);
  return (
    <div>
      <PageHeader
        title="Rejected records"
        description="Payment rows that failed validation, with the reason. They were not saved as payments."
      />
      <Card>
        <Table>
          <THead>
            <Tr>
              <Th>Received</Th>
              <Th>Source</Th>
              <Th>Batch / row</Th>
              <Th>External ref</Th>
              <Th>Reason</Th>
            </Tr>
          </THead>
          <TBody>
            {result.rows.map((r) => (
              <Tr key={r.rejected_id}>
                <Td className="whitespace-nowrap">{formatDateTime(r.created_at)}</Td>
                <Td>
                  <Badge>{r.source.replace('_', ' ')}</Badge>
                </Td>
                <Td className="text-xs">
                  {r.batch_ref ?? '—'} {r.row_number ? `· row ${r.row_number}` : ''}
                </Td>
                <Td className="font-mono text-xs">{r.external_ref ?? '—'}</Td>
                <Td>{r.reason}</Td>
              </Tr>
            ))}
          </TBody>
        </Table>
        <div className="px-4">
          <Pagination page={result} basePath="/payments/rejected" searchParams={params} />
        </div>
      </Card>
    </div>
  );
}
