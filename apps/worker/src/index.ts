/**
 * IRCUB worker process: consumes the BullMQ queues and runs the scheduled jobs.
 * Several copies of this process can run side by side; the database guarantees (SKIP LOCKED,
 * unique keys, conditional status updates) make that safe.
 */
import { Worker, type Job, type Processor } from 'bullmq';
import {
  createRedis,
  getQueue,
  QUEUES,
  type BillingJob,
  type FmisPostingJob,
  type NotificationJob,
  type PaymentStatusJob,
  type ProcessPaymentJob,
  type QueueName,
  type SummaryJob,
} from '@ircub/platform';
import { createContext } from './lib/context';
import { runBillingCycle } from './jobs/billing';
import { refreshExchangeRates } from './jobs/exchange-rates';
import { postAllPendingDays, postBusinessDay, reverseBatch, sendBatch } from './jobs/fmis-posting';
import { runMaintenance } from './jobs/maintenance';
import { sendNotification } from './jobs/notifications';
import { checkPaymentStatus } from './jobs/payment-status';
import { runPenalties } from './jobs/penalties';
import { markFailed, processPayment, releaseClaim } from './jobs/process-payment';
import { checkAnomalies, refreshSummaries } from './jobs/summaries';

const ctx = createContext();
const workers: Worker[] = [];
const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

function startWorker<T>(name: QueueName, concurrency: number, processor: Processor<T>): Worker<T> {
  const worker = new Worker<T>(name, processor, { connection: createRedis(), concurrency });
  worker.on('failed', (job, error) => {
    ctx.logger.warn(
      { queue: name, jobId: job?.id, attempt: job?.attemptsMade, err: error.message },
      'job failed',
    );
  });
  worker.on('error', (error) => ctx.logger.error({ queue: name, err: error }, 'worker error'));
  workers.push(worker as Worker);
  return worker;
}

const isLastAttempt = (job: Job) => job.attemptsMade + 1 >= (job.opts.attempts ?? 1);

// ── Payments: one queue per revenue category, each with its own worker pool ──
const paymentProcessor: Processor<ProcessPaymentJob> = async (job) => {
  const { paymentId } = job.data;
  try {
    return await processPayment(ctx, paymentId);
  } catch (error) {
    if (isLastAttempt(job)) {
      await markFailed(ctx, paymentId, (error as Error).message);
    } else {
      await releaseClaim(ctx, paymentId);
    }
    throw error;
  }
};
const paymentConcurrency = Number(process.env.PAYMENT_WORKER_CONCURRENCY ?? 8);
startWorker(QUEUES.paymentsTax, paymentConcurrency, paymentProcessor);
startWorker(QUEUES.paymentsWater, paymentConcurrency, paymentProcessor);

startWorker<PaymentStatusJob>(QUEUES.paymentStatus, 5, (job) =>
  checkPaymentStatus(ctx, job.data.paymentId, job.attemptsMade + 1, job.opts.attempts ?? 3),
);

// ── Reporting ──
startWorker<SummaryJob>(QUEUES.summaries, 1, async (job) => {
  if (job.name === 'nightly') {
    await refreshSummaries(ctx, [daysAgo(3), today()]);
    return checkAnomalies(ctx, daysAgo(1), { includeCollectionDrop: true });
  }
  await refreshSummaries(ctx, job.data.dates);
  return checkAnomalies(ctx, today(), { includeCollectionDrop: false });
});

startWorker(QUEUES.penalties, 1, () => runPenalties(ctx));

// One billing cycle at a time; a cycle is idempotent, so a retry never double-bills.
startWorker<BillingJob>(QUEUES.billing, 1, (job) => runBillingCycle(ctx, job.data.cycleId));

// ── FMIS: one at a time, so journals reach FMIS in order ──
startWorker<FmisPostingJob & { userId?: number }>(QUEUES.fmis, 1, async (job) => {
  switch (job.name) {
    case 'post-day':
      return postBusinessDay(ctx, job.data.businessDate!);
    case 'retry-batch':
      return sendBatch(ctx, job.data.batchId!);
    case 'reverse-batch':
      return reverseBatch(ctx, job.data.batchId!, job.data.userId ?? null);
    default:
      return postAllPendingDays(ctx);
  }
});

startWorker<NotificationJob>(QUEUES.notifications, 5, (job) =>
  sendNotification(ctx, job.data.notificationId, isLastAttempt(job)),
);

startWorker(QUEUES.maintenance, 1, async (job) => {
  if (job.name === 'exchange-rates') return refreshExchangeRates(ctx);
  return runMaintenance(ctx);
});

// ── Schedules (upsert = safe to run on every start, and with several worker replicas) ──
async function schedule(): Promise<void> {
  const q = (name: QueueName) => getQueue(ctx.redis, name);
  await q(QUEUES.maintenance).upsertJobScheduler('sweep', { every: 60_000 }, { name: 'sweep' });
  await q(QUEUES.maintenance).upsertJobScheduler(
    'exchange-rates',
    { every: 15 * 60_000 },
    { name: 'exchange-rates' },
  );
  await q(QUEUES.penalties).upsertJobScheduler(
    'daily-penalties',
    { pattern: '0 2 * * *' },
    { name: 'run' },
  );
  await q(QUEUES.summaries).upsertJobScheduler(
    'nightly-summary',
    { pattern: '30 0 * * *' },
    { name: 'nightly', data: { dates: [] } },
  );
  await q(QUEUES.fmis).upsertJobScheduler(
    'nightly-fmis',
    { pattern: '0 1 * * *' },
    { name: 'post-pending', opts: { attempts: 1 } },
  );
  // On start: post any unposted history (see assumptions D23). Interval schedulers above also
  // fire once immediately, so rates are fetched at startup too.
  await q(QUEUES.fmis).add('post-pending', {}, { jobId: `fmis-startup-${today()}`, attempts: 1 });
}

async function shutdown(signal: string): Promise<void> {
  ctx.logger.info({ signal }, 'shutting down worker');
  // Let running jobs finish, then close connections.
  await Promise.allSettled(workers.map((w) => w.close()));
  await ctx.prisma.$disconnect();
  ctx.redis.disconnect();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

schedule()
  .then(() => ctx.logger.info({ queues: workers.map((w) => w.name) }, 'worker started'))
  .catch((error: unknown) => {
    ctx.logger.fatal({ err: error }, 'worker failed to start');
    process.exit(1);
  });
