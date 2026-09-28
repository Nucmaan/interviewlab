import { PERMISSIONS, PERMISSION_CODES, resolvePermissions } from '@ircub/core';
import { notFound } from 'next/navigation';
import { ActionButton, ActionForm } from '@/components/action-form';
import { Field } from '@/components/field';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Select } from '@/components/ui/input';
import { requirePermission } from '@/lib/rbac';
import {
  deleteRoleAction,
  updateRolePermissionsAction,
} from '@/modules/users/actions/admin-actions';
import { listRoles } from '@/modules/users/services/user-admin';

export const metadata = { title: 'Role permissions' };

export default async function RolePage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission('roles.manage');
  const roleId = Number((await params).id);
  const roles = await listRoles();
  const role = roles.find((r) => r.role_id === roleId);
  if (!role) notFound();

  const own = new Set(role.permissions.map((p) => p.permission.code));
  // Permissions that come from the parent chain are shown as inherited (read-only here).
  const inherited = role.parent_role_id
    ? resolvePermissions(
        roles.map((r) => ({
          roleId: r.role_id,
          parentRoleId: r.parent_role_id,
          permissions: r.permissions.map((p) => p.permission.code),
        })),
        [role.parent_role_id],
      )
    : new Set<string>();
  const modules = [...new Set(PERMISSION_CODES.map((code) => PERMISSIONS[code][0]))];

  return (
    <div className="max-w-4xl">
      <PageHeader
        title={role.name}
        description={`${role.code} · ${role._count.users} user(s) · ${role.description ?? ''}`}
        actions={
          role.is_system ? null : (
            <ActionButton
              action={deleteRoleAction}
              input={{ roleId }}
              label="Delete role"
              variant="destructive"
              confirmText="Click again to delete"
            />
          )
        }
      />
      <Card>
        <CardContent className="pt-5">
          <ActionForm
            action={updateRolePermissionsAction}
            extra={{ roleId }}
            submitLabel="Save permissions"
            successMessage="Permissions saved."
          >
            <Field id="parentRoleId" label="Inherits from">
              <Select
                id="parentRoleId"
                name="parentRoleId"
                defaultValue={role.parent_role_id ?? ''}
              >
                <option value="">No parent</option>
                {roles
                  .filter((r) => r.role_id !== roleId)
                  .map((r) => (
                    <option key={r.role_id} value={r.role_id}>
                      {r.name}
                    </option>
                  ))}
              </Select>
            </Field>
            <div className="grid gap-4 md:grid-cols-2">
              {modules.map((module) => (
                <fieldset key={module} className="rounded-md border p-3">
                  <legend className="px-1 text-sm font-semibold capitalize">{module}</legend>
                  {PERMISSION_CODES.filter((code) => PERMISSIONS[code][0] === module).map(
                    (code) => (
                      <label key={code} className="flex items-start gap-2 py-1 text-sm">
                        <input
                          type="checkbox"
                          name="permissions[]"
                          value={code}
                          defaultChecked={own.has(code)}
                          className="mt-0.5 h-4 w-4"
                        />
                        <span>
                          <span className="font-mono text-xs">{code}</span>
                          {inherited.has(code) ? (
                            <span className="ml-1 text-xs text-emerald-700">(inherited)</span>
                          ) : null}
                          <span className="block text-xs text-muted-foreground">
                            {PERMISSIONS[code][1]}
                          </span>
                        </span>
                      </label>
                    ),
                  )}
                </fieldset>
              ))}
            </div>
          </ActionForm>
        </CardContent>
      </Card>
    </div>
  );
}
