import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { hasPermission, withPermission } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

/**
 * GET /api/payments/status?ids=1,2,3 - current status of up to 50 payments.
 * Used by screens that then follow live updates over SSE (so an update that happened before the
 * SSE connection opened is not missed). Self-service users only see their own payments.
 */
export const GET = withPermission(
  ['payments.view', 'payments.capture', 'self.view'],
  async (request, { user }) => {
    const ids = (request.nextUrl.searchParams.get('ids') ?? '')
      .split(',')
      .map(Number)
      .filter((id) => Number.isInteger(id) && id > 0)
      .slice(0, 50);
    const ownOnly = !hasPermission(user, ['payments.view', 'payments.capture']);
    const rows = await prisma.payment.findMany({
      where: { payment_id: { in: ids }, ...(ownOnly ? { payer_id: user.payerId ?? -1 } : {}) },
      select: { payment_id: true, status: true },
    });
    return NextResponse.json({
      statuses: Object.fromEntries(rows.map((r) => [r.payment_id, r.status])),
    });
  },
);
