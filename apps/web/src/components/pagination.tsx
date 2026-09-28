import Link from 'next/link';
import { formatNumber } from '@/lib/format';
import type { Page } from '@/lib/pagination';
import { cn } from '@/lib/utils';

/**
 * Server-side pagination links. Filters live in the URL, so every page of results can be
 * bookmarked, shared and reloaded.
 */
export function Pagination({
  page,
  basePath,
  searchParams,
}: {
  page: Pick<Page<unknown>, 'page' | 'pageCount' | 'total' | 'pageSize'>;
  basePath: string;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const hrefFor = (target: number) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams)) {
      if (typeof value === 'string' && value !== '' && key !== 'page') params.set(key, value);
    }
    params.set('page', String(target));
    return `${basePath}?${params.toString()}`;
  };
  const from = page.total === 0 ? 0 : (page.page - 1) * page.pageSize + 1;
  const to = Math.min(page.total, page.page * page.pageSize);
  const linkClass = 'rounded-md border px-3 py-1.5 text-sm hover:bg-muted';

  return (
    <div className="flex flex-col items-center justify-between gap-2 py-3 text-sm sm:flex-row print:hidden">
      <span className="text-muted-foreground">
        {formatNumber(from)}–{formatNumber(to)} of {formatNumber(page.total)}
      </span>
      <div className="flex items-center gap-2">
        <Link
          aria-disabled={page.page <= 1}
          className={cn(linkClass, page.page <= 1 && 'pointer-events-none opacity-40')}
          href={hrefFor(page.page - 1)}
        >
          Previous
        </Link>
        <span>
          Page {page.page} of {page.pageCount}
        </span>
        <Link
          aria-disabled={page.page >= page.pageCount}
          className={cn(linkClass, page.page >= page.pageCount && 'pointer-events-none opacity-40')}
          href={hrefFor(page.page + 1)}
        >
          Next
        </Link>
      </div>
    </div>
  );
}
