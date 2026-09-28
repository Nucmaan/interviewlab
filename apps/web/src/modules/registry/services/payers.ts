import 'server-only';
import {
  findDuplicateMatches,
  normalizeEmail,
  normalizeNationalId,
  normalizePhone,
  roundMoney,
  type DuplicateMatch,
} from '@ircub/core';
import { toNumber, type Prisma, type Tx } from '@ircub/db';
import { audit } from '@/lib/audit';
import { prisma } from '@/lib/db';
import { DomainError, NotFoundError } from '@/lib/errors';
import type { PageRequest } from '@/lib/pagination';
import type { CurrentUser } from '@/lib/rbac';
import type { PayerInput } from '../schemas/payer';

export interface PayerFilters {
  q?: string;
  payerType?: 'INDIVIDUAL' | 'BUSINESS';
  from?: string;
  to?: string;
}

export async function listPayers(filters: PayerFilters, page: PageRequest) {
  const where: Prisma.PayerWhereInput = {
    ...(filters.q
      ? {
          OR: [
            { tin: { startsWith: filters.q } },
            { full_name: { contains: filters.q, mode: 'insensitive' } },
            { phone: { contains: filters.q } },
            { email: { contains: filters.q, mode: 'insensitive' } },
          ],
        }
      : {}),
    ...(filters.payerType ? { payer_type: filters.payerType } : {}),
    ...(filters.from || filters.to
      ? {
          created_at: {
            ...(filters.from ? { gte: new Date(`${filters.from}T00:00:00Z`) } : {}),
            ...(filters.to
              ? { lt: new Date(new Date(`${filters.to}T00:00:00Z`).getTime() + 86_400_000) }
              : {}),
          },
        }
      : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.payer.findMany({
      where,
      orderBy: { full_name: 'asc' },
      skip: page.skip,
      take: page.take,
      include: { _count: { select: { water_accounts: true, assessments: true } } },
    }),
    prisma.payer.count({ where }),
  ]);
  return { rows, total };
}

/**
 * Finds existing payers that share a phone, email or national ID with the candidate.
 * A broad database query narrows the candidates; the precise comparison (after normalising the
 * values) is done by findDuplicateMatches in @ircub/core.
 */
async function detectDuplicates(
  tx: Tx,
  input: PayerInput,
  excludePayerId?: number,
): Promise<DuplicateMatch[]> {
  const phone = normalizePhone(input.phone);
  const email = normalizeEmail(input.email);
  const nationalId = normalizeNationalId(input.nationalId);
  const or: Prisma.PayerWhereInput[] = [];
  if (phone) or.push({ phone: { endsWith: phone } });
  if (email) or.push({ email: { equals: email, mode: 'insensitive' } });
  if (nationalId) or.push({ national_id: { contains: nationalId.slice(-6), mode: 'insensitive' } });
  if (or.length === 0) return [];

  const candidates = await tx.payer.findMany({
    where: { OR: or, ...(excludePayerId ? { payer_id: { not: excludePayerId } } : {}) },
    select: { payer_id: true, phone: true, email: true, national_id: true },
    take: 50,
  });
  return findDuplicateMatches(
    {
      payerId: excludePayerId,
      phone: input.phone,
      email: input.email,
      nationalId: input.nationalId,
    },
    candidates.map((c) => ({
      payerId: c.payer_id,
      phone: c.phone,
      email: c.email,
      nationalId: c.national_id,
    })),
  );
}

function toColumns(input: PayerInput) {
  return {
    payer_type: input.payerType,
    full_name: input.fullName,
    tin: input.tin,
    national_id: input.nationalId ?? null,
    phone: input.phone ?? null,
    email: input.email ? input.email.toLowerCase() : null,
    address: input.address ?? null,
  };
}

/** Registers a payer. Likely duplicates are FLAGGED for review; they never block registration. */
export async function createPayer(input: PayerInput, user: CurrentUser) {
  if (await prisma.payer.findUnique({ where: { tin: input.tin } })) {
    throw new DomainError(`TIN ${input.tin} is already registered`);
  }
  return prisma.$transaction(async (tx) => {
    const payer = await tx.payer.create({ data: { ...toColumns(input), created_by: user.userId } });
    const matches = await detectDuplicates(tx, input, payer.payer_id);
    if (matches.length > 0) {
      await tx.duplicateFlag.createMany({
        data: matches.map((m) => ({
          payer_id: payer.payer_id,
          matched_payer_id: m.matchedPayerId,
          match_field: m.field,
        })),
        skipDuplicates: true,
      });
    }
    await audit(tx, user, {
      action: 'PAYER_CREATED',
      entityType: 'payer',
      entityId: payer.payer_id,
      after: { ...toColumns(input), duplicateFlags: matches },
    });
    return { payerId: payer.payer_id, duplicates: matches.length };
  });
}

export async function updatePayer(payerId: number, input: PayerInput, user: CurrentUser) {
  return prisma.$transaction(async (tx) => {
    const before = await tx.payer.findUnique({ where: { payer_id: payerId } });
    if (!before) throw new NotFoundError('Payer');
    if (before.tin !== input.tin && (await tx.payer.findUnique({ where: { tin: input.tin } }))) {
      throw new DomainError(`TIN ${input.tin} is already registered`);
    }
    const after = await tx.payer.update({ where: { payer_id: payerId }, data: toColumns(input) });
    const matches = await detectDuplicates(tx, input, payerId);
    if (matches.length > 0) {
      await tx.duplicateFlag.createMany({
        data: matches.map((m) => ({
          payer_id: payerId,
          matched_payer_id: m.matchedPayerId,
          match_field: m.field,
        })),
        skipDuplicates: true,
      });
    }
    const { created_at: _c, created_by: _b, ...beforeView } = before;
    const { created_at: _c2, created_by: _b2, ...afterView } = after;
    await audit(tx, user, {
      action: 'PAYER_UPDATED',
      entityType: 'payer',
      entityId: payerId,
      before: beforeView,
      after: afterView,
    });
    return { payerId, duplicates: matches.length };
  });
}

export async function reviewDuplicate(
  flagId: number,
  decision: 'CONFIRMED_DUPLICATE' | 'NOT_DUPLICATE',
  user: CurrentUser,
) {
  return prisma.$transaction(async (tx) => {
    const flag = await tx.duplicateFlag.findUnique({ where: { flag_id: flagId } });
    if (!flag) throw new NotFoundError('Duplicate flag');
    if (flag.status !== 'OPEN') throw new DomainError('This flag was already reviewed');
    await tx.duplicateFlag.update({
      where: { flag_id: flagId },
      data: { status: decision, reviewed_by: user.userId, reviewed_at: new Date() },
    });
    await audit(tx, user, {
      action: 'DUPLICATE_REVIEWED',
      entityType: 'duplicate_flag',
      entityId: flagId,
      before: { status: 'OPEN' },
      after: { status: decision },
    });
    return { flagId };
  });
}

/** Everything about one payer on one screen: the 360-degree view. */
export async function getPayerProfile(payerId: number) {
  const payer = await prisma.payer.findUnique({
    where: { payer_id: payerId },
    include: {
      water_accounts: {
        orderBy: { account_no: 'asc' },
        include: { bills: { orderBy: { billing_month: 'desc' }, take: 1 } },
      },
      duplicate_flags: { include: { matched_payer: { select: { full_name: true, tin: true } } } },
      duplicate_of: { include: { payer: { select: { full_name: true, tin: true } } } },
      user: { select: { email: true } },
    },
  });
  if (!payer) return null;

  const [assessments, payments, taxOutstanding, paidLast12] = await Promise.all([
    prisma.assessment.findMany({
      where: { payer_id: payerId },
      orderBy: { due_date: 'desc' },
      take: 50,
    }),
    prisma.payment.findMany({
      where: { payer_id: payerId },
      orderBy: { paid_at: 'desc' },
      take: 50,
    }),
    prisma.$queryRaw<{ outstanding: Prisma.Decimal | null }[]>`
      SELECT SUM(amount_due + penalty_amount - amount_paid) AS outstanding
      FROM assessment WHERE payer_id = ${payerId} AND status IN ('OPEN', 'PART_PAID')`,
    prisma.payment.aggregate({
      where: {
        payer_id: payerId,
        status: 'DONE',
        paid_at: { gte: new Date(Date.now() - 365 * 86_400_000) },
      },
      _sum: { amount_base: true },
    }),
  ]);
  const waterOutstanding = payer.water_accounts.reduce((sum, account) => {
    const latest = account.bills[0];
    return latest && latest.status !== 'HELD'
      ? sum + toNumber(latest.total_due) - toNumber(latest.amount_paid)
      : sum;
  }, 0);
  const tax = toNumber(taxOutstanding[0]?.outstanding);

  return {
    payer,
    assessments,
    payments,
    balance: {
      taxOutstanding: roundMoney(tax),
      waterOutstanding: roundMoney(waterOutstanding),
      totalOutstanding: roundMoney(tax + waterOutstanding),
      paidLast12Months: toNumber(paidLast12._sum.amount_base),
    },
  };
}
