import { NextResponse, type NextRequest } from 'next/server';
import { errorResponse } from '@/lib/rbac';
import { handleCallback } from '@/modules/payments/services/callbacks';
import { authenticateChannelRequest, parseJson } from '@/modules/payments/services/channel-auth';
import { withIdempotency } from '@/modules/payments/services/idempotency';

export const dynamic = 'force-dynamic';

/**
 * POST /api/payments/callback - payment notification from a bank or mobile money provider.
 * Authenticated by HMAC signature (not a user session). See docs/api/openapi.yaml.
 */
export async function POST(request: NextRequest) {
  const auth = await authenticateChannelRequest(request);
  if (!auth.ok) return auth.response;
  try {
    const result = await withIdempotency(
      auth.idempotencyKey,
      'callback',
      auth.rawBody,
      async () => {
        const json = parseJson(auth.rawBody);
        if (!json.ok) return { status: 400, body: { error: 'Body must be valid JSON' } };
        return { status: 200, body: await handleCallback(json.value) };
      },
    );
    return NextResponse.json(result.body, {
      status: result.status,
      headers: result.replayed ? { 'Idempotent-Replayed': 'true' } : undefined,
    });
  } catch (error) {
    return errorResponse(error, request);
  }
}
