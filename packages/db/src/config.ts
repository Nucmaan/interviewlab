/**
 * Typed access to the system_config table (penalty rules, thresholds, GL codes ...).
 * Callers always pass a fallback, so a missing key never breaks a job.
 */
import type { PrismaClient } from './generated/prisma/client';

export async function getConfig<T>(prisma: PrismaClient, key: string, fallback: T): Promise<T> {
  const row = await prisma.systemConfig.findUnique({ where: { key } });
  return row ? (row.value as T) : fallback;
}
