import { ActionForm, FieldError } from '@/components/action-form';
import { Field } from '@/components/field';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { requireUser } from '@/lib/rbac';
import { changePasswordAction } from '@/modules/users/actions/admin-actions';
import { TotpSetup } from '@/modules/users/components/totp-setup';

export const metadata = { title: 'Account security' };

export default async function SecurityPage() {
  const user = await requireUser();
  return (
    <div className="grid max-w-4xl gap-6 md:grid-cols-2">
      <div className="md:col-span-2">
        <PageHeader title="Account security" description={user.email} />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Change password</CardTitle>
        </CardHeader>
        <CardContent>
          <ActionForm
            action={changePasswordAction}
            submitLabel="Change password"
            successMessage="Password changed."
            resetOnSuccess
          >
            <Field id="currentPassword" label="Current password">
              <Input
                id="currentPassword"
                name="currentPassword"
                type="password"
                autoComplete="current-password"
              />
              <FieldError name="currentPassword" />
            </Field>
            <Field
              id="newPassword"
              label="New password"
              hint="12+ characters with upper and lower case, a number and a symbol."
            >
              <Input
                id="newPassword"
                name="newPassword"
                type="password"
                autoComplete="new-password"
              />
              <FieldError name="newPassword" />
            </Field>
            <Field id="confirmPassword" label="Repeat new password">
              <Input
                id="confirmPassword"
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
              />
              <FieldError name="confirmPassword" />
            </Field>
          </ActionForm>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Two-factor authentication</CardTitle>
        </CardHeader>
        <CardContent>
          <TotpSetup enabled={user.totpEnabled} />
        </CardContent>
      </Card>
    </div>
  );
}
