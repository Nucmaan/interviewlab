import { createRedis, EVENTS_CHANNEL, type IrcubEvent } from '@ircub/platform';
import type { NextRequest } from 'next/server';
import { logger } from '@/lib/logger';
import { getCurrentUser, hasPermission } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

const HEARTBEAT_MS = 25_000;

/**
 * Server-Sent Events stream of live updates (payments processed, alerts, FMIS batches ...).
 *
 * Why SSE rather than WebSockets: updates only flow server -> browser, SSE works over plain
 * HTTP through proxies, and the browser's EventSource reconnects automatically.
 * Each connection subscribes to the Redis channel the worker publishes to.
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return new Response('Authentication required', { status: 401 });

  const seesEverything = hasPermission(user, ['dashboard.view', 'payments.view', 'fmis.view']);
  // Self-service users only receive events about their own payments.
  const allowed = (event: IrcubEvent) =>
    seesEverything || (event.type === 'payment.updated' && event.payerId === user.payerId);

  const subscriber = createRedis();
  const encoder = new TextEncoder();
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // The client has gone; cleanup happens in the abort handler.
        }
      };
      subscriber.on('message', (_channel, message) => {
        try {
          const event = JSON.parse(message) as IrcubEvent;
          if (allowed(event)) send(`event: ${event.type}\ndata: ${message}\n\n`);
        } catch (error) {
          logger.warn({ err: error }, 'ignoring malformed event');
        }
      });
      await subscriber.subscribe(EVENTS_CHANNEL);
      send(`event: ready\ndata: {}\n\n`);
      // Comment lines keep idle connections open through proxies and load balancers.
      heartbeat = setInterval(() => send(`: ping\n\n`), HEARTBEAT_MS);
    },
    cancel() {
      clearInterval(heartbeat);
      subscriber.disconnect();
    },
  });

  request.signal.addEventListener('abort', () => {
    clearInterval(heartbeat);
    subscriber.disconnect();
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
