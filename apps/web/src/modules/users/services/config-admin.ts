import 'server-only';
import type { Prisma } from '@ircub/db';
import { z } from 'zod';
import { audit } from '@/lib/audit';
import { prisma } from '@/lib/db';
import { DomainError } from '@/lib/errors';
import type { CurrentUser } from '@/lib/rbac';

/**
 * System configuration the administrator may change at runtime. Every key has its own schema,
 * so a typo cannot, for example, set a negative penalty rate.
 */
export const CONFIG_SCHEMAS = {
  penalty_rules: z.object({
    initialMonths: z.number().int().min(0).max(24),
    initialRatePercent: z.number().min(0).max(100),
    laterRatePercent: z.number().min(0).max(100),
    capPercent: z.number().min(0).max(100),
  }),
  collection_bank_gl: z.string().trim().min(3).max(20),
  abnormal_consumption_threshold_pct: z.number().min(100).max(1000),
  bill_due_days: z.number().int().min(1).max(90),
  financial_year_start_month: z.number().int().min(1).max(12),
  alert_rules: z.object({
    collectionDropPercent: z.number().min(1).max(100),
    reversalSpikeFactor: z.number().min(1).max(20),
    reversalSpikeMinCount: z.number().int().min(1).max(1000),
  }),
  payment_status_check: z.object({
    maxAttempts: z.number().int().min(1).max(10),
    baseDelayMs: z.number().int().min(500).max(60_000),
  }),
} as const;

export type ConfigKey = keyof typeof CONFIG_SCHEMAS;

export const CONFIG_DESCRIPTIONS: Record<ConfigKey, string> = {
  penalty_rules:
    'Overdue penalty: months at the first rate, first and later monthly rates (%), cap (% of amount due).',
  collection_bank_gl: 'GL code of the collection bank account (debit side of FMIS journals).',
  abnormal_consumption_threshold_pct:
    'Hold water bills when consumption exceeds this % of the 3-month average.',
  bill_due_days: 'Days after the end of the billing month before a water bill is due.',
  financial_year_start_month: 'First month of the financial year (1 = January).',
  alert_rules: 'Dashboard alerts: collection drop %, reversal spike factor and minimum count.',
  payment_status_check: 'Retries of channel status checks for initiated payments.',
};

export async function listConfig() {
  const rows = await prisma.systemConfig.findMany();
  const values = new Map(rows.map((r) => [r.key, r]));
  return (Object.keys(CONFIG_SCHEMAS) as ConfigKey[]).map((key) => ({
    key,
    description: CONFIG_DESCRIPTIONS[key],
    value: values.get(key)?.value ?? null,
    updatedAt: values.get(key)?.updated_at ?? null,
  }));
}

export async function updateConfig(key: string, rawJson: string, actor: CurrentUser) {
  if (!(key in CONFIG_SCHEMAS)) throw new DomainError(`Unknown setting ${key}`);
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawJson);
  } catch {
    throw new DomainError('The value must be valid JSON (strings in double quotes)');
  }
  const result = CONFIG_SCHEMAS[key as ConfigKey].safeParse(parsedJson);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new DomainError(
      `Invalid value: ${issue?.path.join('.') || 'value'} ${issue?.message ?? ''}`.trim(),
    );
  }
  const value = result.data as Prisma.InputJsonValue;
  await prisma.$transaction(async (tx) => {
    const before = await tx.systemConfig.findUnique({ where: { key } });
    await tx.systemConfig.upsert({
      where: { key },
      create: { key, value, updated_by: actor.userId },
      update: { value, updated_by: actor.userId },
    });
    await audit(tx, actor, {
      action: 'CONFIG_UPDATED',
      entityType: 'system_config',
      entityId: key,
      before: before?.value ?? null,
      after: value,
    });
  });
}
