/**
 * Real-time events over Redis pub/sub. The worker publishes; every web instance subscribes and
 * forwards events to browsers through Server-Sent Events (/api/events). Using Redis in the middle
 * means this also works with several web containers behind a load balancer.
 */
import type { Redis } from 'ioredis';

export const EVENTS_CHANNEL = 'ircub:events';

export type IrcubEvent =
  | {
      type: 'payment.updated';
      paymentId: number;
      status: string;
      externalRef: string;
      payerId: number;
    }
  | { type: 'summary.updated'; dates: string[] }
  | { type: 'alert.created'; alertId: number; severity: string; message: string }
  | { type: 'fmis.batch'; batchId: number; status: string; businessDate: string }
  | { type: 'billing.cycle'; cycleId: number; status: string };

export async function publishEvent(redis: Redis, event: IrcubEvent): Promise<void> {
  await redis.publish(EVENTS_CHANNEL, JSON.stringify({ ...event, at: new Date().toISOString() }));
}
