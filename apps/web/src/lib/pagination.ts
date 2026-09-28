/** Server-side pagination helpers used by every list screen. */

export const PAGE_SIZE_OPTIONS = [20, 50, 100] as const;

export interface PageRequest {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
}

export function parsePage(
  searchParams: Record<string, string | string[] | undefined>,
): PageRequest {
  const page = Math.max(1, Number(first(searchParams.page)) || 1);
  const requested = Number(first(searchParams.pageSize)) || 20;
  const pageSize = (PAGE_SIZE_OPTIONS as readonly number[]).includes(requested) ? requested : 20;
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

export interface Page<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

export function toPage<T>(rows: T[], total: number, request: PageRequest): Page<T> {
  return {
    rows,
    total,
    page: request.page,
    pageSize: request.pageSize,
    pageCount: Math.max(1, Math.ceil(total / request.pageSize)),
  };
}

export function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;
