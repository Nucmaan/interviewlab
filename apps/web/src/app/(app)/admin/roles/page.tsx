import Link from 'next/link';
import { ActionForm, FieldError } from '@/components/action-form';
import { Field } from '@/components/field';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { requirePermission } from '@/lib/rbac';
import { createRoleAction } from '@/modules/users/actions/admin-actions';
import { listRoles } from '@/modules/users/services/user-admin';

export const metadata = { title: 'Roles & permissions' };

export default async function RolesPage() {
  await requirePermission('roles.manage');
  const roles = await listRoles();

  return (
    <div>
      <PageHeader
        title="Roles & permissions"
        description="Permissions are stored in the database and apply at each user's next request. A role inherits every permission of its parent."
      />
      <Card className="mb-6">
        <Table>
          <THead>
            <Tr>
              <Th>Role</Th>
              <Th>Inherits from</Th>
              <Th>Own permissions</Th>
              <Th>Users</Th>
              <Th>Type</Th>
            </Tr>
          </THead>
          <TBody>
            {roles.map((role) => (
              <Tr key={role.role_id}>
                <Td>
                  <Link
                    className="font-medium text-primary hover:underline"
                    href={`/admin/roles/${role.role_id}`}
                  >
                    {role.name}
                  </Link>
                  <div className="text-xs text-muted-foreground">{role.code}</div>
                </Td>
                <Td>{role.parent?.name ?? '—'}</Td>
                <Td>{role.permissions.length}</Td>
                <Td>{role._count.users}</Td>
                <Td>
                  <Badge tone={role.is_system ? 'info' : 'neutral'}>
                    {role.is_system ? 'System' : 'Custom'}
                  </Badge>
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </Card>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Create a custom role</CardTitle>
        </CardHeader>
        <CardContent>
          <ActionForm
            action={createRoleAction}
            submitLabel="Create role"
            successMessage="Role created. Open it to choose permissions."
            resetOnSuccess
          >
            <Field id="code" label="Code" hint="For example CASHIER_SUPERVISOR">
              <Input id="code" name="code" />
              <FieldError name="code" />
            </Field>
            <Field id="name" label="Name">
              <Input id="name" name="name" />
              <FieldError name="name" />
            </Field>
            <Field id="description" label="Description">
              <Input id="description" name="description" />
            </Field>
            <Field id="parentRoleId" label="Inherits from (optional)">
              <Select id="parentRoleId" name="parentRoleId" defaultValue="">
                <option value="">No parent</option>
                {roles.map((r) => (
                  <option key={r.role_id} value={r.role_id}>
                    {r.name}
                  </option>
                ))}
              </Select>
            </Field>
          </ActionForm>
        </CardContent>
      </Card>
    </div>
  );
}
