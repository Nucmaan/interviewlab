import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withPermission } from '@/lib/rbac';
import { getRevenueSummaryForDay } from '@/modules/dashboard/services/revenue-summary';

export const dynamic = 'force-dynamic';

const querySchema = z.object({ date: z.iso.date().optional() });

/** GET /api/reports/revenue-summary?date=YYYY-MM-DD - cached revenue summary per revenue type. */
export const GET = withPermission(['dashboard.view', 'payments.view'], async (request) => {
  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 });
  }
  const date = parsed.data.date ?? new Date().toISOString().slice(0, 10);
  return NextResponse.json(await getRevenueSummaryForDay(date));
});
