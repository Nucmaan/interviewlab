import 'server-only';
import { generateControlNumber } from '@ircub/core';
import { AssessmentStatus, type Prisma, type Tx } from '@ircub/db';
import { audit } from '@/lib/audit';
import { prisma } from '@/lib/db';
import { DomainError } from '@/lib/errors';
import { first, type PageRequest } from '@/lib/pagination';
import type { CurrentUser } from '@/lib/rbac';
import type { AssessmentInput } from '../schemas/revenue';

export interface AssessmentFilters {
  payer?: string;
  revenueCode?: string;
  status?: AssessmentStatus;
  minAmount?: number;
  maxAmount?: number;
  dueFrom?: string;
  dueTo?: string;
  controlNumber?: string;
}

export function parseAssessmentFilters(
  params: Record<string, string | string[] | undefined>,
): AssessmentFilters {
  const num = (v: string | undefined) => (v && Number.isFinite(Number(v)) ? Number(v) : undefined);
  const date = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
  const status = first(params.status);
  return {
    payer: first(params.payer)?.trim() || undefined,
    revenueCode: first(params.revenueCode) || undefined,
    status: (Object.values(AssessmentStatus) as string[]).includes(status ?? '')
      ? (status as AssessmentStatus)
      : undefined,
    minAmount: num(first(params.minAmount)),
    maxAmount: num(first(params.maxAmount)),
    dueFrom: date(first(params.dueFrom)),
    dueTo: date(first(params.dueTo)),
    controlNumber: first(params.controlNumber)?.trim().toUpperCase() || undefined,
  };
}

export async function listAssessments(f: AssessmentFilters, page: PageRequest) {
  const where: Prisma.AssessmentWhereInput = {
    ...(f.payer
      ? {
          payer: {
            OR: [{ tin: f.payer }, { full_name: { contains: f.payer, mode: 'insensitive' } }],
          },
        }
      : {}),
    ...(f.revenueCode ? { revenue_code: f.revenueCode } : {}),
    ...(f.status ? { status: f.status } : {}),
    ...(f.minAmount !== undefined || f.maxAmount !== undefined
      ? {
          amount_due: {
            ...(f.minAmount !== undefined ? { gte: f.minAmount } : {}),
            ...(f.maxAmount !== undefined ? { lte: f.maxAmount } : {}),
          },
        }
      : {}),
    ...(f.dueFrom || f.dueTo
      ? {
          due_date: {
            ...(f.dueFrom ? { gte: new Date(f.dueFrom) } : {}),
            ...(f.dueTo ? { lte: new Date(f.dueTo) } : {}),
          },
        }
      : {}),
    ...(f.controlNumber ? { control_number: { startsWith: f.controlNumber } } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.assessment.findMany({
      where,
      orderBy: { due_date: 'desc' },
      skip: page.skip,
      take: page.take,
      include: { payer: { select: { full_name: true, tin: true } } },
    }),
    prisma.assessment.count({ where }),
  ]);
  return { rows, total };
}

/**
 * Next control number: a PostgreSQL sequence guarantees uniqueness even with many officers
 * creating assessments at the same time; core adds the readable format and Luhn check digit.
 */
async function nextControlNumber(tx: Tx): Promise<string> {
  const [row] = await tx.$queryRaw<
    { seq: bigint }[]
  >`SELECT nextval('assessment_control_seq') AS seq`;
  return generateControlNumber('AS', new Date().getUTCFullYear(), Number(row!.seq));
}

interface ResolvedAssessment {
  payerId: number;
  input: AssessmentInput;
}

/** Checks TIN and revenue type for many rows with two queries; returns rows ready to save. */
export async function resolveAssessments(inputs: readonly AssessmentInput[]) {
  const [payers, types] = await Promise.all([
    prisma.payer.findMany({
      where: { tin: { in: [...new Set(inputs.map((i) => i.tin))] } },
      select: { payer_id: true, tin: true },
    }),
    prisma.revenueType.findMany(),
  ]);
  const payerByTin = new Map(payers.map((p) => [p.tin, p.payer_id]));
  const typeByCode = new Map(types.map((t) => [t.revenue_code, t]));
  const valid: (ResolvedAssessment & { row: number })[] = [];
  const errors: { row: number; reason: string }[] = [];
  inputs.forEach((input, index) => {
    const row = index + 1;
    const payerId = payerByTin.get(input.tin);
    const type = typeByCode.get(input.revenueCode.toUpperCase());
    if (!payerId) errors.push({ row, reason: `No payer with TIN ${input.tin}` });
    else if (!type) errors.push({ row, reason: `Revenue code ${input.revenueCode} is not valid` });
    else if (!type.is_active)
      errors.push({ row, reason: `Revenue code ${input.revenueCode} is not active` });
    else if (type.category !== 'TAX')
      errors.push({ row, reason: 'Water charges are billed by the billing cycle, not assessed' });
    else valid.push({ row, payerId, input: { ...input, revenueCode: type.revenue_code } });
  });
  return { valid, errors };
}

export async function saveAssessments(
  rows: readonly ResolvedAssessment[],
  user: CurrentUser,
  source: string,
) {
  return prisma.$transaction(async (tx) => {
    const created: { assessmentId: number; controlNumber: string }[] = [];
    for (const { payerId, input } of rows) {
      const a = await tx.assessment.create({
        data: {
          payer_id: payerId,
          revenue_code: input.revenueCode,
          amount_due: input.amountDue,
          due_date: new Date(`${input.dueDate}T00:00:00Z`),
          control_number: await nextControlNumber(tx),
          period: input.period ?? null,
          description: input.description ?? null,
          created_by: user.userId,
        },
      });
      created.push({ assessmentId: a.assessment_id, controlNumber: a.control_number });
    }
    await audit(tx, user, {
      action: 'ASSESSMENTS_CREATED',
      entityType: 'assessment',
      entityId: created.length === 1 ? created[0]!.assessmentId : `${source}:${created.length}`,
      after: {
        source,
        count: created.length,
        controlNumbers: created.slice(0, 50).map((c) => c.controlNumber),
      },
    });
    return created;
  });
}

export async function createAssessment(input: AssessmentInput, user: CurrentUser) {
  const { valid, errors } = await resolveAssessments([input]);
  if (errors.length > 0) throw new DomainError(errors[0]!.reason);
  const [created] = await saveAssessments(valid, user, 'form');
  return created!;
}
