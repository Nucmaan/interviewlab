import { notFound } from 'next/navigation';
import { ActionButton, ActionForm, FieldError } from '@/components/action-form';
import { Field } from '@/components/field';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { prisma } from '@/lib/db';
import { formatDateTime } from '@/lib/format';
import { hasPermission, requirePermission } from '@/lib/rbac';
import {
  resetPasswordAction,
  setUserActiveAction,
  updateUserAction,
} from '@/modules/users/actions/admin-actions';

export const metadata = { title: 'User' };

export default async function UserPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePermission('users.view');
  const userId = Number((await params).id);
  if (!Number.isInteger(userId) || userId <= 0) notFound();
  const [user, roles] = await Promise.all([
    prisma.user.findUnique({
      where: { user_id: userId },
      include: { roles: true, payer: true },
    }),
    prisma.role.findMany({ orderBy: { name: 'asc' } }),
  ]);
  if (!user) notFound();
  const canManage = hasPermission(actor, 'users.manage');
  const assigned = new Set(user.roles.map((r) => r.role_id));
  const locked = user.locked_until && user.locked_until > new Date();

  return (
    <div className="max-w-3xl">
      <PageHeader
        title={user.full_name}
        description={
          <>
            {user.email} · <StatusBadge status={user.is_active ? 'ACTIVE' : 'INACTIVE'} /> · last
            login {formatDateTime(user.last_login_at)}
            {locked ? ` · locked until ${formatDateTime(user.locked_until)}` : ''}
          </>
        }
        actions={
          canManage ? (
            <ActionButton
              action={setUserActiveAction}
              input={{ userId: user.user_id, active: !user.is_active }}
              label={user.is_active ? 'Deactivate' : 'Activate'}
              variant={user.is_active ? 'destructive' : 'default'}
              confirmText={user.is_active ? 'Click again to deactivate' : undefined}
            />
          ) : null
        }
      />
      {user.payer ? (
        <p className="mb-4 text-sm">
          Self-service account for payer {user.payer.full_name} (TIN {user.payer.tin}).
        </p>
      ) : null}
      {canManage ? (
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Details and roles</CardTitle>
            </CardHeader>
            <CardContent>
              <ActionForm
                action={updateUserAction}
                extra={{ userId: user.user_id }}
                successMessage="Saved."
              >
                <Field id="fullName" label="Full name">
                  <Input id="fullName" name="fullName" defaultValue={user.full_name} />
                  <FieldError name="fullName" />
                </Field>
                <fieldset>
                  <legend className="mb-2 text-sm font-medium">Roles</legend>
                  <div className="flex flex-wrap gap-4">
                    {roles.map((r) => (
                      <label key={r.role_id} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          name="roleIds[]"
                          value={r.role_id}
                          defaultChecked={assigned.has(r.role_id)}
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
          <Card>
            <CardHeader>
              <CardTitle>Reset password</CardTitle>
            </CardHeader>
            <CardContent>
              <ActionForm
                action={resetPasswordAction}
                extra={{ userId: user.user_id }}
                submitLabel="Set new password"
                successMessage="Password reset. Give it to the user through a secure channel."
                resetOnSuccess
              >
                <Field id="password" label="New password">
                  <Input
                    id="password"
                    name="password"
                    type="password"
                    autoComplete="new-password"
                  />
                  <FieldError name="password" />
                </Field>
              </ActionForm>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
