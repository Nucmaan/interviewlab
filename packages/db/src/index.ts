/**
 * Shared database access for the web app, the worker and the scripts.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { type Prisma, PrismaClient } from './generated/prisma/client';

export * from './generated/prisma/client';
export { recordAudit, verifyAuditLog, type AuditEntry } from './audit';
export { getConfig } from './config';

export type Tx = Prisma.TransactionClient;

export function createPrismaClient(options: { connectionString?: string; poolSize?: number } = {}) {
  const connectionString = options.connectionString ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set');
  }
  // Prisma 7 talks to PostgreSQL through the node-postgres driver adapter.
  const adapter = new PrismaPg({ connectionString, max: options.poolSize ?? 10 });
  return new PrismaClient({ adapter });
}

// One client per process. Next.js dev mode reloads modules on every change, so the client is kept
// on globalThis; otherwise each reload would open a new connection pool until Postgres runs out.
const globalForPrisma = globalThis as unknown as { __ircubPrisma?: PrismaClient };

export function getPrisma(): PrismaClient {
  globalForPrisma.__ircubPrisma ??= createPrismaClient({
    poolSize: Number(process.env.DATABASE_POOL_SIZE ?? 10),
  });
  return globalForPrisma.__ircubPrisma;
}

/** Converts a Prisma Decimal (or null) to a JS number at the edge of the data layer. */
export function toNumber(value: Prisma.Decimal | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return typeof value === 'number' ? value : value.toNumber();
}
