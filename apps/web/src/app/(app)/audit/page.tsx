import { Field } from '@/components/field';
import { FilterForm } from '@/components/filter-form';
import { PageHeader } from '@/components/page-header';
import { Pagination } from '@/components/pagination';
import { Card } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { formatDateTime } from '@/lib/format';
import { parsePage, toPage, type SearchParams } from '@/lib/pagination';
import { hasPermission, requirePermission } from '@/lib/rbac';
import { VerifyChainButton } from '@/modules/audit/components/verify-chain-button';
import { listAuditLog, parseAuditFilters } from '@/modules/audit/services/audit-log';

export const metadata = { title: 'Audit log' };

function JsonCell({ value }: { value: unknown }) {
  if (value === null || value === undefined)
    return <span className="text-muted-foreground">—</span>;
  return (
    <details>
      <summary className="cursor-pointer text-xs text-primary">view</summary>
      <pre className="mt-1 max-w-md overflow-x-auto rounded bg-muted p-2 text-[11px]">
        {JSON.stringify(value, null, 2)}
      </pre>
    </details>
  );
}

export default async function AuditPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requirePermission('audit.view');
  const params = await searchParams;
  const page = parsePage(params);
  const filters = parseAuditFilters(params);
  const { rows, total, actions, entityTypes } = await listAuditLog(filters, page);
  const result = toPage(rows, total, page);

  return (
    <div>
      <PageHeader
        title="Audit log"
        description="Append-only and hash-chained: each row stores SHA-256(previous hash + row data). Editing, deleting or inserting a row breaks the chain."
        actions={hasPermission(user, 'audit.verify') ? <VerifyChainButton /> : null}
      />
      <FilterForm basePath="/audit">
        <Field id="entityType" label="Entity">
          <Select id="entityType" name="entityType" defaultValue={filters.entityType ?? ''}>
            <option value="">All</option>
            {entityTypes.map((e) => (
              <option key={e}>{e}</option>
            ))}
          </Select>
        </Field>
        <Field id="entityId" label="Entity id">
          <Input id="entityId" name="entityId" defaultValue={filters.entityId} />
        </Field>
        <Field id="action" label="Action">
          <Select id="action" name="action" defaultValue={filters.action ?? ''}>
            <option value="">All</option>
            {actions.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </Select>
        </Field>
        <Field id="actor" label="User email (or 'system')">
          <Input id="actor" name="actor" defaultValue={filters.actor} />
        </Field>
        <Field id="from" label="From">
          <Input id="from" name="from" type="date" defaultValue={filters.from} />
        </Field>
        <Field id="to" label="To">
          <Input id="to" name="to" type="date" defaultValue={filters.to} />
        </Field>
      </FilterForm>
      <Card>
        <Table>
          <THead>
            <Tr>
              <Th>#</Th>
              <Th>When</Th>
              <Th>Who</Th>
              <Th>Action</Th>
              <Th>Entity</Th>
              <Th>Before</Th>
              <Th>After</Th>
              <Th>Hash</Th>
            </Tr>
          </THead>
          <TBody>
            {result.rows.map((row) => (
              <Tr key={row.audit_id} className="align-top">
                <Td>{row.audit_id}</Td>
                <Td className="whitespace-nowrap">{formatDateTime(row.occurred_at)}</Td>
                <Td>
                  {row.actor ? (
                    row.actor.full_name
                  ) : (
                    <span className="text-muted-foreground">system</span>
                  )}
                  {row.ip_address ? (
                    <div className="text-xs text-muted-foreground">{row.ip_address}</div>
                  ) : null}
                </Td>
                <Td className="font-mono text-xs">{row.action}</Td>
                <Td className="text-xs">
                  {row.entity_type} #{row.entity_id}
                </Td>
                <Td>
                  <JsonCell value={row.before} />
                </Td>
                <Td>
                  <JsonCell value={row.after} />
                </Td>
                <Td className="font-mono text-[11px] text-muted-foreground" title={row.hash}>
                  {row.hash.slice(0, 12)}…
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
        <div className="px-4">
          <Pagination page={result} basePath="/audit" searchParams={params} />
        </div>
      </Card>
    </div>
  );
}
