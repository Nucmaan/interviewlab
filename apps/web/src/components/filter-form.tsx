import Link from 'next/link';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';

/**
 * Filters are a plain GET form: the values go into the URL, the server component reads them and
 * filters in the database (server-side filtering + pagination). No client JavaScript needed.
 */
export function FilterForm({ basePath, children }: { basePath: string; children: ReactNode }) {
  return (
    <form
      method="get"
      action={basePath}
      className="mb-4 grid gap-3 rounded-lg border bg-muted/30 p-4 sm:grid-cols-2 lg:grid-cols-4 print:hidden"
    >
      {children}
      <div className="flex items-end gap-2">
        <Button type="submit">Apply filters</Button>
        <Link href={basePath} className="px-2 py-2 text-sm text-primary hover:underline">
          Reset
        </Link>
      </div>
    </form>
  );
}
