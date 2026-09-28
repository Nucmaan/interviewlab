import 'server-only';
import { PaymentChannel, PaymentStatus, type Prisma } from '@ircub/db';
import { prisma } from '@/lib/db';
import { first, type PageRequest } from '@/lib/pagination';

/** Advanced filters for the payments list: payer, revenue type, amount range, channel, status, dates. */
export interface PaymentFilters {
  payer?: string;
  revenueCode?: string;
  channel?: PaymentChannel;
  status?: PaymentStatus;
  minAmount?: number;
  maxAmount?: number;
  from?: string;
  to?: string;
  ref?: string;
}

export function parsePaymentFilters(
  params: Record<string, string | string[] | undefined>,
): PaymentFilters {
  const num = (v: string | undefined) => (v && Number.isFinite(Number(v)) ? Number(v) : undefined);
  const date = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
  // Only accept known enum values; anything else in the URL is ignored.
  const oneOf = <T extends string>(values: Record<string, T>, v: string | undefined) =>
    (Object.values(values) as string[]).includes(v ?? '') ? (v as T) : undefined;
  return {
    payer: first(params.payer)?.trim() || undefined,
    revenueCode: first(params.revenueCode) || undefined,
    channel: oneOf(PaymentChannel, first(params.channel)),
    status: oneOf(PaymentStatus, first(params.status)),
    minAmount: num(first(params.minAmount)),
    maxAmount: num(first(params.maxAmount)),
    from: date(first(params.from)),
    to: date(first(params.to)),
    ref: first(params.ref)?.trim() || undefined,
  };
}

export function paymentWhere(f: PaymentFilters): Prisma.PaymentWhereInput {
  const payerAsNumber = f.payer && /^\d+$/.test(f.payer) ? Number(f.payer) : undefined;
  return {
    ...(f.payer
      ? {
          OR: [
            // payer_id is a 32-bit integer; a longer number can only be a TIN.
            ...(payerAsNumber && payerAsNumber <= 2_147_483_647
              ? [{ payer_id: payerAsNumber }]
              : []),
            { payer: { tin: f.payer } },
            { payer: { full_name: { contains: f.payer, mode: 'insensitive' as const } } },
          ],
        }
      : {}),
    ...(f.revenueCode ? { revenue_code: f.revenueCode } : {}),
    ...(f.channel ? { channel: f.channel } : {}),
    ...(f.status ? { status: f.status } : {}),
    // Amount filters use the base currency, so USD and SOS payments compare fairly.
    ...(f.minAmount !== undefined || f.maxAmount !== undefined
      ? {
          amount_base: {
            ...(f.minAmount !== undefined ? { gte: f.minAmount } : {}),
            ...(f.maxAmount !== undefined ? { lte: f.maxAmount } : {}),
          },
        }
      : {}),
    ...(f.from || f.to
      ? {
          paid_at: {
            ...(f.from ? { gte: new Date(`${f.from}T00:00:00Z`) } : {}),
            ...(f.to ? { lt: new Date(new Date(`${f.to}T00:00:00Z`).getTime() + 86_400_000) } : {}),
          },
        }
      : {}),
    ...(f.ref ? { external_ref: { startsWith: f.ref } } : {}),
  };
}

export async function listPayments(filters: PaymentFilters, page: PageRequest) {
  const where = paymentWhere(filters);
  const [rows, total, sum] = await Promise.all([
    prisma.payment.findMany({
      where,
      orderBy: { paid_at: 'desc' },
      skip: page.skip,
      take: page.take,
      include: { payer: { select: { full_name: true, tin: true } } },
    }),
    prisma.payment.count({ where }),
    prisma.payment.aggregate({ where: { ...where, status: 'DONE' }, _sum: { amount_base: true } }),
  ]);
  return { rows, total, doneTotal: sum._sum.amount_base };
}
