import { NextResponse } from 'next/server';
import { withPermission } from '@/lib/rbac';
import { searchPayers } from '@/modules/registry/services/payer-search';

export const dynamic = 'force-dynamic';

/** GET /api/payers/search?q=... - search by TIN, phone, water account number or name. */
export const GET = withPermission(['payments.capture', 'payers.view'], async (request) => {
  const q = request.nextUrl.searchParams.get('q') ?? '';
  if (q.length > 100) return NextResponse.json({ error: 'Query too long' }, { status: 400 });
  return NextResponse.json({ results: await searchPayers(q) });
});
