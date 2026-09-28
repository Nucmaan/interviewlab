import { redirect } from 'next/navigation';
import { NAVIGATION } from '@/lib/navigation';
import { hasPermission, requireUser } from '@/lib/rbac';

/** Sends each user to the first screen their role can open (dashboard, portal, ...). */
export default async function HomePage() {
  const user = await requireUser();
  const first = NAVIGATION.flatMap((s) => s.items).find((item) =>
    hasPermission(user, item.permission),
  );
  redirect(first?.href ?? '/account/security');
}
