/**
 * Sends queued SMS / email notifications through the mock gateway. A notification row is written
 * first (outbox), then this job delivers it, so a gateway outage never loses a message: the job
 * is retried with backoff and the row keeps its status and last error.
 */
import { getQueue, QUEUES, type NotificationJob } from '@ircub/platform';
import type { WorkerContext } from '../lib/context';

export async function sendNotification(
  ctx: WorkerContext,
  notificationId: number,
  isLastAttempt: boolean,
): Promise<void> {
  const n = await ctx.prisma.notification.findUnique({
    where: { notification_id: notificationId },
  });
  if (!n || n.status === 'SENT') return;
  try {
    if (n.channel === 'SMS') {
      await ctx.mock.sendSms(n.recipient, n.body);
    } else {
      await ctx.mock.sendEmail(n.recipient, n.subject ?? 'IRCUB notification', n.body);
    }
    await ctx.prisma.notification.update({
      where: { notification_id: notificationId },
      data: { status: 'SENT', sent_at: new Date(), attempts: { increment: 1 }, error: null },
    });
  } catch (error) {
    await ctx.prisma.notification.update({
      where: { notification_id: notificationId },
      data: {
        attempts: { increment: 1 },
        error: (error as Error).message.slice(0, 500),
        status: isLastAttempt ? 'FAILED' : 'QUEUED',
      },
    });
    throw error;
  }
}

/** Writes a notification to the outbox and queues its delivery. */
export async function queueNotification(
  ctx: WorkerContext,
  input: {
    channel: 'SMS' | 'EMAIL';
    recipient: string;
    subject?: string;
    body: string;
    relatedType?: string;
    relatedId?: string;
  },
): Promise<void> {
  const n = await ctx.prisma.notification.create({
    data: {
      channel: input.channel,
      recipient: input.recipient,
      subject: input.subject ?? null,
      body: input.body,
      related_type: input.relatedType ?? null,
      related_id: input.relatedId ?? null,
    },
  });
  const data: NotificationJob = { notificationId: n.notification_id };
  await getQueue(ctx.redis, QUEUES.notifications).add('send', data, {
    jobId: `notification-${n.notification_id}`,
  });
}

/** Emails every active user who holds the Revenue Supervisor role. */
export async function notifySupervisors(
  ctx: WorkerContext,
  subject: string,
  body: string,
  related: { type: string; id: string },
): Promise<void> {
  const supervisors = await ctx.prisma.user.findMany({
    where: { is_active: true, roles: { some: { role: { code: 'REVENUE_SUPERVISOR' } } } },
    select: { email: true },
  });
  for (const s of supervisors) {
    await queueNotification(ctx, {
      channel: 'EMAIL',
      recipient: s.email,
      subject,
      body,
      relatedType: related.type,
      relatedId: related.id,
    });
  }
}
