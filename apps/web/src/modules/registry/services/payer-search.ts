import 'server-only';
import { normalizePhone, roundMoney } from '@ircub/core';
import { toNumber, type Prisma } from '@ircub/db';
import { prisma } from '@/lib/db';

export interface PayerSearchResult {
  payerId: number;
  fullName: string;
  tin: string;
  phone: string | null;
  payerType: string;
  openAssessments: {
    assessmentId: number;
    revenueCode: string;
    controlNumber: string;
    period: string | null;
    dueDate: string;
    outstanding: number;
  }[];
  openBills: {
    billId: number;
    accountNo: string;
    billingMonth: string;
    controlNumber: string;
    outstanding: number;
  }[];
}

/**
 * Step 1 of the payment capture form: find a payer by TIN, phone, water account number or name,
 * with what they currently owe.
 */
export async function searchPayers(query: string): Promise<PayerSearchResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  const or: Prisma.PayerWhereInput[] = [
    { tin: { startsWith: q } },
    { full_name: { contains: q, mode: 'insensitive' } },
  ];
  const phone = normalizePhone(q);
  if (phone) or.push({ phone: { endsWith: phone } });
  if (/^WA-?\d+$/i.test(q)) {
    const accountNo = q.toUpperCase().startsWith('WA-') ? q.toUpperCase() : `WA-${q.slice(2)}`;
    or.push({ water_accounts: { some: { account_no: accountNo } } });
  }

  const payers = await prisma.payer.findMany({
    where: { OR: or },
    take: 10,
    orderBy: { full_name: 'asc' },
    include: {
      assessments: {
        where: { status: { in: ['OPEN', 'PART_PAID'] } },
        orderBy: { due_date: 'asc' },
        take: 20,
      },
      water_accounts: {
        include: {
          // The latest payable bill carries all arrears (see assumptions D7).
          bills: {
            where: { status: { in: ['ISSUED', 'PART_PAID'] } },
            orderBy: { billing_month: 'desc' },
            take: 1,
          },
        },
      },
    },
  });

  return payers.map((p) => ({
    payerId: p.payer_id,
    fullName: p.full_name,
    tin: p.tin,
    phone: p.phone,
    payerType: p.payer_type,
    openAssessments: p.assessments.map((a) => ({
      assessmentId: a.assessment_id,
      revenueCode: a.revenue_code,
      controlNumber: a.control_number,
      period: a.period,
      dueDate: a.due_date.toISOString().slice(0, 10),
      outstanding: roundMoney(
        toNumber(a.amount_due) + toNumber(a.penalty_amount) - toNumber(a.amount_paid),
      ),
    })),
    openBills: p.water_accounts.flatMap((account) =>
      account.bills.map((b) => ({
        billId: b.bill_id,
        accountNo: account.account_no,
        billingMonth: b.billing_month.toISOString().slice(0, 7),
        controlNumber: b.control_number,
        outstanding: roundMoney(toNumber(b.total_due) - toNumber(b.amount_paid)),
      })),
    ),
  }));
}
