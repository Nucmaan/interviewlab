import Link from 'next/link';
import { ActionButton } from '@/components/action-form';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Card } from '@/components/ui/card';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { prisma } from '@/lib/db';
import { formatDate } from '@/lib/format';
import { requirePermission } from '@/lib/rbac';
import { reviewDuplicateAction } from '@/modules/registry/actions/payer-actions';

export const metadata = { title: 'Possible duplicates' };

export default async function DuplicatesPage() {
  await requirePermission('duplicates.review');
  const flags = await prisma.duplicateFlag.findMany({
    orderBy: [{ status: 'asc' }, { created_at: 'desc' }],
    take: 200,
    include: { payer: true, matched_payer: true },
  });

  return (
    <div>
      <PageHeader
        title="Possible duplicate registrations"
        description="Same phone, email or national ID (compared after normalising, e.g. +252 61… = 061…). Families and small businesses often share a phone, so these are hints, not proof."
      />
      <Card>
        <Table>
          <THead>
            <Tr>
              <Th>Flagged</Th>
              <Th>New / edited payer</Th>
              <Th>Matches</Th>
              <Th>Same</Th>
              <Th>Status</Th>
              <Th>Review</Th>
            </Tr>
          </THead>
          <TBody>
            {flags.map((f) => (
              <Tr key={f.flag_id}>
                <Td>{formatDate(f.created_at)}</Td>
                <Td>
                  <Link className="text-primary hover:underline" href={`/payers/${f.payer_id}`}>
                    {f.payer.full_name}
                  </Link>
                  <div className="text-xs text-muted-foreground">TIN {f.payer.tin}</div>
                </Td>
                <Td>
                  <Link
                    className="text-primary hover:underline"
                    href={`/payers/${f.matched_payer_id}`}
                  >
                    {f.matched_payer.full_name}
                  </Link>
                  <div className="text-xs text-muted-foreground">TIN {f.matched_payer.tin}</div>
                </Td>
                <Td>{f.match_field.replace('_', ' ')}</Td>
                <Td>
                  <StatusBadge status={f.status} />
                </Td>
                <Td>
                  {f.status === 'OPEN' ? (
                    <div className="flex gap-2">
                      <ActionButton
                        action={reviewDuplicateAction}
                        input={{ flagId: f.flag_id, decision: 'CONFIRMED_DUPLICATE' }}
                        label="Is duplicate"
                        variant="destructive"
                      />
                      <ActionButton
                        action={reviewDuplicateAction}
                        input={{ flagId: f.flag_id, decision: 'NOT_DUPLICATE' }}
                        label="Not a duplicate"
                      />
                    </div>
                  ) : null}
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </Card>
    </div>
  );
}
