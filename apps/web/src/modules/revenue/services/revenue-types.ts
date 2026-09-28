import 'server-only';
import type { z } from 'zod';
import { audit } from '@/lib/audit';
import { prisma } from '@/lib/db';
import type { CurrentUser } from '@/lib/rbac';
import type { revenueTypeSchema } from '../schemas/revenue';

/**
 * Revenue types with their rate and GL code. The GL code is the configurable
 * "revenue type -> GL" mapping used by FMIS posting; changing it affects future journals only
 * (journal lines keep the GL code they were posted with).
 */
export async function saveRevenueType(
  input: z.output<typeof revenueTypeSchema>,
  user: CurrentUser,
) {
  return prisma.$transaction(async (tx) => {
    const before = await tx.revenueType.findUnique({ where: { revenue_code: input.revenueCode } });
    const data = {
      name: input.name,
      category: input.category,
      gl_code: input.glCode,
      default_amount: input.defaultAmount ?? null,
      is_active: input.isActive,
      description: input.description ?? null,
    };
    const after = await tx.revenueType.upsert({
      where: { revenue_code: input.revenueCode },
      create: { revenue_code: input.revenueCode, ...data },
      update: data,
    });
    await audit(tx, user, {
      action: before ? 'REVENUE_TYPE_UPDATED' : 'REVENUE_TYPE_CREATED',
      entityType: 'revenue_type',
      entityId: input.revenueCode,
      before,
      after,
    });
    return { revenueCode: after.revenue_code };
  });
}
