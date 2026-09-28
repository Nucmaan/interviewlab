'use client';

import { Menu, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { cn } from '@/lib/utils';

export interface VisibleSection {
  title: string;
  items: { href: string; label: string }[];
}

/**
 * Sidebar on large screens, collapsible menu on phones and tablets. It only receives the items
 * the user is allowed to see (filtered on the server in the layout).
 */
export function AppNav({ sections }: { sections: VisibleSection[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // The most specific matching link is active (so /payments/capture does not also light up /payments).
  const allHrefs = sections.flatMap((s) => s.items.map((i) => i.href));
  const activeHref = allHrefs
    .filter((href) => pathname === href || pathname.startsWith(`${href}/`))
    .sort((a, b) => b.length - a.length)[0];

  return (
    <>
      <button
        type="button"
        className="inline-flex h-10 w-10 items-center justify-center rounded-md border lg:hidden print:hidden"
        aria-label={open ? 'Close menu' : 'Open menu'}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>
      <nav
        aria-label="Main"
        className={cn(
          'fixed inset-x-0 top-14 z-30 max-h-[calc(100vh-3.5rem)] overflow-y-auto border-b bg-sidebar p-4 lg:static lg:block lg:max-h-none lg:border-b-0 lg:bg-transparent lg:p-0 print:hidden',
          open ? 'block' : 'hidden',
        )}
      >
        {sections.map((section) => (
          <div key={section.title} className="mb-5">
            <p className="mb-1 px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {section.title}
            </p>
            <ul className="flex flex-col gap-0.5">
              {section.items.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className={cn(
                      'block rounded-md px-2 py-2 text-sm hover:bg-muted',
                      item.href === activeHref && 'bg-primary/10 font-medium text-primary',
                    )}
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
    </>
  );
}
