import { ActionForm } from '@/components/action-form';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/input';
import { formatDateTime } from '@/lib/format';
import { requirePermission } from '@/lib/rbac';
import { updateConfigAction } from '@/modules/users/actions/admin-actions';
import { listConfig } from '@/modules/users/services/config-admin';

export const metadata = { title: 'System configuration' };

export default async function ConfigPage() {
  await requirePermission('config.manage');
  const settings = await listConfig();
  return (
    <div className="max-w-3xl">
      <PageHeader
        title="System configuration"
        description="Changes take effect without a deployment and are recorded in the audit log. Each value is checked against its own rules before it is saved."
      />
      <div className="flex flex-col gap-4">
        {settings.map((setting) => (
          <Card key={setting.key}>
            <CardHeader>
              <CardTitle className="font-mono text-sm">{setting.key}</CardTitle>
              <CardDescription>
                {setting.description} Last changed {formatDateTime(setting.updatedAt)}.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ActionForm
                action={updateConfigAction}
                extra={{ key: setting.key }}
                successMessage="Saved."
              >
                <Textarea
                  name="value"
                  aria-label={`Value of ${setting.key}`}
                  className="font-mono text-xs"
                  rows={setting.value && typeof setting.value === 'object' ? 5 : 1}
                  defaultValue={JSON.stringify(setting.value, null, 2)}
                />
              </ActionForm>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
