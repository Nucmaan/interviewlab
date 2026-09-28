import Link from 'next/link';
import type { ReactNode } from 'react';
import { AppNav, type VisibleSection } from '@/components/app-nav';
import { LiveIndicator } from '@/components/live-indicator';
import { Button } from '@/components/ui/button';
import { NAVIGATION } from '@/lib/navigation';
import { hasPermission, requireUser } from '@/lib/rbac';
import { logoutAction } from '@/modules/users/actions/session-actions';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  // Role-based menu: keep only the links this user's permissions unlock.
  const sections: VisibleSection[] = NAVIGATION.map((section) => ({
    title: section.title,
    items: section.items
      .filter((item) => hasPermission(user, item.permission))
      .map(({ href, label }) => ({ href, label })),
  })).filter((section) => section.items.length > 0);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b bg-background px-4 print:hidden">
        <AppNav sections={sections} variant="mobile" />
        <Link href="/" className="font-semibold text-primary">
          IRCUB
        </Link>
        <div className="ml-auto flex items-center gap-3 text-sm">
          <LiveIndicator />
          <div className="hidden text-right sm:block">
            <div className="font-medium">{user.fullName}</div>
            <div className="text-xs text-muted-foreground">
              {user.roles.map((r) => r.name).join(', ')}
            </div>
          </div>
          <Link href="/account/security" className="text-sm text-primary hover:underline">
            Security
          </Link>
          <form action={logoutAction}>
            <Button type="submit" variant="outline" size="sm">
              Sign out
            </Button>
          </form>
        </div>
      </header>
      <div className="mx-auto flex max-w-[1500px] gap-6 px-4 py-6">
        <aside className="hidden w-60 shrink-0 lg:block print:hidden">
          <div className="sticky top-20">
            <AppNav sections={sections} variant="sidebar" />
          </div>
        </aside>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
