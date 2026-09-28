import Link from 'next/link';
import { ActionForm, FieldError } from '@/components/action-form';
import { Field } from '@/components/field';
import { FilterForm } from '@/components/filter-form';
import { PageHeader } from '@/components/page-header';
import { Pagination } from '@/components/pagination';
import { StatusBadge } from '@/components/status-badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { prisma } from '@/lib/db';
import { formatDateTime } from '@/lib/format';
import { first, parsePage, toPage, type SearchParams } from '@/lib/pagination';
import { hasPermission, requirePermission } from '@/lib/rbac';
import { createUserAction } from '@/modules/users/actions/admin-actions';
import { listUsers } from '@/modules/users/services/user-admin';

export const metadata = { title: 'Users' };

export default async function UsersPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requirePermission('users.view');
  const params = await searchParams;
  const page = parsePage(params);
  const filters = {
    q: first(params.q),
    roleId: Number(first(params.roleId)) || undefined,
    status: first(params.status),
  };
  const [{ rows, total }, roles] = await Promise.all([
    listUsers(filters, page),
    prisma.role.findMany({ orderBy: { name: 'asc' } }),
  ]);
  const result = toPage(rows, total, page);

  return (
    <div>
      <PageHeader
        title="Users"
        description="Staff and self-service accounts. Deactivated users lose access immediately."
      />
      <FilterForm basePath="/admin/users">
        <Field id="q" label="Name or email">
          <Input id="q" name="q" defaultValue={filters.q} />
        </Field>
        <Field id="roleId" label="Role">
          <Select id="roleId" name="roleId" defaultValue={filters.roleId ?? ''}>
            <option value="">All roles</option>
            {roles.map((r) => (
              <option key={r.role_id} value={r.role_id}>
                {r.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="status" label="Status">
          <Select id="status" name="status" defaultValue={filters.status ?? ''}>
            <option value="">All</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </Select>
        </Field>
      </FilterForm>

      <Card className="mb-6">
        <Table>
          <THead>
            <Tr>
              <Th>Name</Th>
              <Th>Email</Th>
              <Th>Roles</Th>
              <Th>2FA</Th>
              <Th>Last login</Th>
              <Th>Status</Th>
            </Tr>
          </THead>
          <TBody>
            {result.rows.map((u) => (
              <Tr key={u.user_id}>
                <Td>
                  <Link className="text-primary hover:underline" href={`/admin/users/${u.user_id}`}>
                    {u.full_name}
                  </Link>
                </Td>
                <Td>{u.email}</Td>
                <Td>{u.roles.map((r) => r.role.name).join(', ')}</Td>
                <Td>{u.totp_enabled ? 'On' : 'Off'}</Td>
                <Td>{formatDateTime(u.last_login_at)}</Td>
                <Td>
                  <StatusBadge status={u.is_active ? 'ACTIVE' : 'INACTIVE'} />
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
        <div className="px-4">
          <Pagination page={result} basePath="/admin/users" searchParams={params} />
        </div>
      </Card>

      {hasPermission(user, 'users.manage') ? (
        <Card>
          <CardHeader>
            <CardTitle>Create user</CardTitle>
          </CardHeader>
          <CardContent>
            <ActionForm
              action={createUserAction}
              submitLabel="Create user"
              successMessage="User created."
              resetOnSuccess
              className="grid gap-4 md:grid-cols-2"
            >
              <Field id="email" label="Email">
                <Input id="email" name="email" type="email" required />
                <FieldError name="email" />
              </Field>
              <Field id="fullName" label="Full name">
                <Input id="fullName" name="fullName" required />
                <FieldError name="fullName" />
              </Field>
              <Field
                id="password"
                label="Temporary password"
                hint="12+ characters with upper and lower case, a number and a symbol."
              >
                <Input id="password" name="password" type="password" autoComplete="new-password" />
                <FieldError name="password" />
              </Field>
              <Field id="payerId" label="Linked payer id (self-service users only)">
                <Input id="payerId" name="payerId" inputMode="numeric" />
              </Field>
              <fieldset className="md:col-span-2">
                <legend className="mb-2 text-sm font-medium">Roles</legend>
                <div className="flex flex-wrap gap-4">
                  {roles.map((r) => (
                    <label key={r.role_id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        name="roleIds[]"
                        value={r.role_id}
                        className="h-4 w-4"
                      />
                      {r.name}
                    </label>
                  ))}
                </div>
                <FieldError name="roleIds" />
              </fieldset>
            </ActionForm>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
