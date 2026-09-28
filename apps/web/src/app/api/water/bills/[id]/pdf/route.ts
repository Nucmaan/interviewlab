import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { hasPermission, withPermission } from '@/lib/rbac';
import { renderBillPdf } from '@/modules/water/services/bill-pdf';

export const dynamic = 'force-dynamic';

/** GET /api/water/bills/:id/pdf - staff with water.view, or the customer who owns the bill. */
export const GET = withPermission<{ id: string }>(
  ['water.view', 'self.view'],
  async (_request, { user, params }) => {
    const billId = Number(params.id);
    if (!Number.isInteger(billId) || billId <= 0)
      return NextResponse.json({ error: 'Invalid bill id' }, { status: 400 });
    if (!hasPermission(user, 'water.view')) {
      // Self-service users may only download their own bills.
      const owned = await prisma.waterBill.count({
        where: { bill_id: billId, account: { payer_id: user.payerId ?? -1 } },
      });
      if (owned === 0) return NextResponse.json({ error: 'Bill not found' }, { status: 404 });
    }
    const pdf = await renderBillPdf(billId);
    if (!pdf) return NextResponse.json({ error: 'Bill not found' }, { status: 404 });
    return new Response(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="water-bill-${billId}.pdf"`,
        'Cache-Control': 'private, no-store',
      },
    });
  },
);
