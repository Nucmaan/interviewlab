/**
 * BullMQ queue names and job payloads shared by the producer (web) and the consumers (worker).
 *
 * Payments get one queue PER REVENUE CATEGORY (tax, water), so a flood of water payments at
 * month end cannot starve tax payments, and each category's worker pool can be scaled
 * separately.
 */
import { Queue, type JobsOptions } from 'bullmq';
import type { Redis } from 'ioredis';

export const QUEUES = {
  paymentsTax: 'payments-tax',
  paymentsWater: 'payments-water',
  paymentStatus: 'payment-status-check',
  penalties: 'penalties',
  billing: 'billing',
  fmis: 'fmis-posting',
  summaries: 'summaries',
  notifications: 'notifications',
  maintenance: 'maintenance',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export interface ProcessPaymentJob {
  paymentId: number;
}
export interface PaymentStatusJob {
  paymentId: number;
}
export interface BillingJob {
  cycleId: number;
}
export interface FmisPostingJob {
  /** Post one business day (YYYY-MM-DD). When omitted, every unposted day before today. */
  businessDate?: string;
  /** Retry an existing FAILED batch. */
  batchId?: number;
}
export interface SummaryJob {
  dates: string[];
}
export interface NotificationJob {
  notificationId: number;
}

export function paymentQueueFor(category: 'TAX' | 'WATER'): QueueName {
  return category === 'WATER' ? QUEUES.paymentsWater : QUEUES.paymentsTax;
}

export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 2000 },
  removeOnComplete: { age: 24 * 3600, count: 10_000 },
  removeOnFail: { age: 7 * 24 * 3600 },
};

const queues = new Map<string, Queue>();

export function getQueue(connection: Redis, name: QueueName): Queue {
  let queue = queues.get(name);
  if (!queue) {
    queue = new Queue(name, { connection, defaultJobOptions: DEFAULT_JOB_OPTIONS });
    queues.set(name, queue);
  }
  return queue;
}

/**
 * Queues payments for processing. The job id is derived from the payment id, so BullMQ ignores
 * a second job for the same payment while the first is still known - one more layer against
 * double processing (the database checks are the real guarantee).
 */
export async function enqueuePayments(
  connection: Redis,
  payments: readonly { paymentId: number; category: 'TAX' | 'WATER' }[],
): Promise<void> {
  const byQueue = new Map<QueueName, ProcessPaymentJob[]>();
  for (const p of payments) {
    const name = paymentQueueFor(p.category);
    byQueue.set(name, [...(byQueue.get(name) ?? []), { paymentId: p.paymentId }]);
  }
  for (const [name, jobs] of byQueue) {
    await getQueue(connection, name).addBulk(
      jobs.map((data) => ({
        name: 'process-payment',
        data,
        opts: { jobId: `payment-${data.paymentId}` },
      })),
    );
  }
}
