import { NextResponse, type NextRequest } from 'next/server';
import { errorResponse } from '@/lib/rbac';
import { MAX_BULK_ROWS } from '@/modules/payments/schemas/payment';
import { authenticateChannelRequest, parseJson } from '@/modules/payments/services/channel-auth';
import { withIdempotency } from '@/modules/payments/services/idempotency';
import { ingestPayments } from '@/modules/payments/services/ingest';

export const dynamic = 'force-dynamic';

/**
 * POST /api/payments/bulk - a JSON array of payment records from a bank or aggregator.
 * Each row is validated on its own: valid rows are stored and queued, invalid rows are stored in
 * rejected_payment, and the response lists the reason for every rejected row.
 */
export async function POST(request: NextRequest) {
  const auth = await authenticateChannelRequest(request);
  if (!auth.ok) return auth.response;
  try {
    const result = await withIdempotency(auth.idempotencyKey, 'bulk', auth.rawBody, async () => {
      const json = parseJson(auth.rawBody);
      if (!json.ok || !Array.isArray(json.value)) {
        return { status: 400, body: { error: 'Body must be a JSON array of payment records' } };
      }
      if (json.value.length === 0 || json.value.length > MAX_BULK_ROWS) {
        return {
          status: 400,
          body: { error: `Send between 1 and ${MAX_BULK_ROWS} records per request` },
        };
      }
      const { payments: _payments, ...summary } = await ingestPayments(json.value, {
        source: 'BULK_API',
        batchRef: auth.idempotencyKey,
      });
      return { status: 200, body: summary };
    });
    return NextResponse.json(result.body, {
      status: result.status,
      headers: result.replayed ? { 'Idempotent-Replayed': 'true' } : undefined,
    });
  } catch (error) {
    return errorResponse(error, request);
  }
}
