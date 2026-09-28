import { PageHeader } from '@/components/page-header';
import { hasPermission, requirePermission } from '@/lib/rbac';
import { CsvUploader } from '@/modules/revenue/components/csv-uploader';
import type { CsvKind } from '@/modules/revenue/schemas/revenue';

export const metadata = { title: 'Bulk upload' };

export default async function UploadPage() {
  const user = await requirePermission(['payments.upload', 'assessments.create']);
  const kinds: CsvKind[] = [
    ...(hasPermission(user, 'payments.upload') ? (['payments'] as const) : []),
    ...(hasPermission(user, 'assessments.create') ? (['assessments'] as const) : []),
  ];
  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Bulk upload (CSV)"
        description="Every row is validated before anything is saved. Valid rows are saved, rejected rows are listed with the reason."
      />
      <CsvUploader allowedKinds={kinds} />
    </div>
  );
}
