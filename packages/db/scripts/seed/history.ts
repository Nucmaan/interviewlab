/**
 * Generates two years of realistic, FICTIONAL history: payers, water accounts, meter readings,
 * bills, tax assessments, payments, reversals, exchange rates and revenue targets.
 *
 * The data has deliberate shape so the dashboard and forecast have something to show:
 *   - an upward trend (more accounts, slightly rising amounts, compliance improving over time)
 *   - seasonality (business licences due every January, more water used in the dry season)
 *   - a mix of good, average and poor payers, so arrears and penalties exist
 * All money logic reuses @ircub/core (tariff, bill composition, currency conversion), so seeded
 * bills follow exactly the same rules as bills produced by the billing cycle.
 */
import {
  calculateWaterBill,
  composeBill,
  convertToBase,
  estimateConsumption,
  findDuplicateMatches,
  generateControlNumber,
  linearRegression,
  predict,
  type TariffConfig,
} from '@ircub/core';
import type { Prisma, PrismaClient } from '../../src/generated/prisma/client';
import { BUSINESS_TYPES, BUSINESS_WORDS, DISTRICTS, FAMILY_NAMES, FIRST_NAMES } from './names';
import { Random } from './random';
import { TARIFFS } from './reference';

type Reliability = 'GOOD' | 'AVERAGE' | 'POOR';
type Channel = 'BANK' | 'MOBILE_MONEY' | 'CASH';
type TariffClass = 'DOMESTIC' | 'COMMERCIAL' | 'INSTITUTIONAL';

interface SeedPayer {
  payer_id: number;
  payer_type: 'INDIVIDUAL' | 'BUSINESS';
  full_name: string;
  tin: string;
  national_id: string | null;
  phone: string | null;
  email: string | null;
  address: string;
  created_at: Date;
  reliability: Reliability;
}

export interface HistoryOptions {
  today: Date;
  payerCount: number;
  waterAccountCount: number;
  officerId: number;
  supervisorId: number;
  secondSupervisorId: number;
}

export interface HistoryResult {
  payers: number;
  waterAccounts: number;
  readings: number;
  bills: number;
  assessments: number;
  payments: number;
  reversals: number;
  duplicateFlags: number;
  taxpayerPayerId: number;
}

const DAY_MS = 86_400_000;
const CHUNK = 2000;

const utcDate = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d));
const addDays = (date: Date, days: number) => new Date(date.getTime() + days * DAY_MS);
const monthStart = (date: Date) => utcDate(date.getUTCFullYear(), date.getUTCMonth(), 1);
const addMonths = (date: Date, months: number) =>
  utcDate(date.getUTCFullYear(), date.getUTCMonth() + months, date.getUTCDate());
const monthKey = (date: Date) =>
  `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
const ymd = (date: Date) => date.toISOString().slice(0, 10).replaceAll('-', '');
const round2 = (value: number) => Math.round(value * 100) / 100;

async function insertInChunks<T>(
  rows: T[],
  insert: (chunk: T[]) => Promise<unknown>,
): Promise<void> {
  for (let i = 0; i < rows.length; i += CHUNK) {
    await insert(rows.slice(i, i + CHUNK));
  }
}

export async function seedHistory(
  prisma: PrismaClient,
  options: HistoryOptions,
): Promise<HistoryResult> {
  const rng = new Random(20260928);
  const today = utcDate(
    options.today.getUTCFullYear(),
    options.today.getUTCMonth(),
    options.today.getUTCDate(),
  );
  const historyStart = addMonths(monthStart(today), -24);
  const totalMonths = 24;
  /** 0 at the start of the history, 1 today: used to make compliance improve over time. */
  const progressAt = (date: Date) =>
    Math.min(
      1,
      Math.max(
        0,
        (date.getTime() - historyStart.getTime()) / (today.getTime() - historyStart.getTime()),
      ),
    );

  // ── Exchange rates: 1 USD in SOS, drifting slowly month by month ──
  const rateByMonth = new Map<string, number>();
  const exchangeRates: Prisma.ExchangeRateCreateManyInput[] = [];
  for (let m = 0; m <= totalMonths; m++) {
    const month = addMonths(historyStart, m);
    const rate = round2(571 + 4 * Math.sin(m / 3) + m * 0.15);
    rateByMonth.set(monthKey(month), rate);
    exchangeRates.push({ currency: 'USD', rate_to_base: rate, source: 'seed', fetched_at: month });
  }
  const rateFor = (date: Date) => rateByMonth.get(monthKey(date)) ?? 571;

  // ── Payers ──
  const payers: SeedPayer[] = [];
  const usedNames = new Set<string>();
  for (let id = 1; id <= options.payerCount; id++) {
    const isBusiness = id === 1 || id % 10 < 3; // ~30% businesses
    let fullName: string;
    do {
      fullName =
        id === 1
          ? 'Hodan Trading Ltd'
          : isBusiness
            ? `${rng.pick(BUSINESS_WORDS)} ${rng.pick(BUSINESS_TYPES)} ${rng.pick(['Ltd', 'Co', 'Enterprise', ''])}`.trim()
            : `${rng.pick(FIRST_NAMES)} ${rng.pick(FAMILY_NAMES)} ${rng.pick(FAMILY_NAMES)}`;
    } while (usedNames.has(fullName) && id !== 1);
    usedNames.add(fullName);
    const emailName = fullName
      .toLowerCase()
      .replace(/[^a-z]+/g, '.')
      .replace(/^\.|\.$/g, '');
    payers.push({
      payer_id: id,
      payer_type: isBusiness ? 'BUSINESS' : 'INDIVIDUAL',
      full_name: fullName,
      tin: String(2_001_000_000 + id),
      national_id: isBusiness ? null : `SO${String(rng.int(10_000_000, 99_999_999))}`,
      phone: `+25261${String(rng.int(1_000_000, 9_999_999))}`,
      email: rng.chance(isBusiness ? 0.9 : 0.6) ? `${emailName}${id}@example.test` : null,
      address: `${rng.pick(DISTRICTS)} District, Plot ${rng.int(1, 999)}`,
      created_at: rng.chance(0.7)
        ? addDays(historyStart, -rng.int(30, 900))
        : addDays(historyStart, rng.int(0, 700)),
      reliability:
        id === 1
          ? 'AVERAGE'
          : rng.weighted([
              ['GOOD', 55],
              ['AVERAGE', 33],
              ['POOR', 12],
            ] as const),
    });
  }
  // A few deliberate duplicate registrations (same phone / email / national ID written
  // differently) so the duplicate review queue has something in it.
  const duplicateCandidates: number[] = [];
  for (let i = 0; i < 12; i++) {
    const copy = payers[payers.length - 1 - i * 7]!;
    const original = payers[20 + i * 11]!;
    const field = i % 3;
    if (field === 0 && original.phone) copy.phone = original.phone.replace('+252', '0');
    if (field === 1 && original.email) copy.email = original.email.toUpperCase();
    if (field === 2) {
      copy.payer_type = 'INDIVIDUAL';
      copy.national_id = original.national_id ?? `SO${rng.int(10_000_000, 99_999_999)}`;
      original.national_id ??= copy.national_id;
    }
    duplicateCandidates.push(copy.payer_id);
  }
  await prisma.payer.createMany({
    data: payers.map(({ reliability: _reliability, ...payer }) => payer),
  });

  const duplicateFlags: Prisma.DuplicateFlagCreateManyInput[] = [];
  const identities = payers.map((p) => ({
    payerId: p.payer_id,
    phone: p.phone,
    email: p.email,
    nationalId: p.national_id,
  }));
  for (const candidateId of duplicateCandidates) {
    const candidate = identities.find((p) => p.payerId === candidateId)!;
    for (const match of findDuplicateMatches(candidate, identities)) {
      duplicateFlags.push({
        payer_id: candidateId,
        matched_payer_id: match.matchedPayerId,
        match_field: match.field,
      });
    }
  }
  await prisma.duplicateFlag.createMany({ data: duplicateFlags, skipDuplicates: true });

  // ── Payment factory shared by water and tax ──
  const payments: Prisma.PaymentCreateManyInput[] = [];
  const reversals: Prisma.ReversalCreateManyInput[] = [];
  let paymentId = 0;
  const refCounters: Record<Channel, number> = { BANK: 0, MOBILE_MONEY: 0, CASH: 0 };
  const refPrefix: Record<Channel, string> = { BANK: 'BNK', MOBILE_MONEY: 'MM', CASH: 'CSH' };

  /** Records a payment and returns the amount (base currency) that counts towards the target. */
  function pay(input: {
    payer: SeedPayer;
    revenueCode: string;
    amountBase: number;
    paidAt: Date;
    usdShare: number;
    assessmentId?: number;
    billId?: number;
    isFull: boolean;
  }): number {
    if (input.paidAt > options.today || input.amountBase <= 0) return 0;
    const channel = rng.weighted([
      ['MOBILE_MONEY', 5],
      ['BANK', 4],
      ['CASH', 1],
    ] as const);
    const currency = rng.chance(input.usdShare) ? 'USD' : 'SOS';
    const rate = rateFor(input.paidAt);
    // Full payments in USD are rounded UP to the cent so the converted amount covers the bill.
    const amount =
      currency === 'SOS'
        ? input.amountBase
        : (input.isFull
            ? Math.ceil((input.amountBase / rate) * 100)
            : Math.round((input.amountBase / rate) * 100)) / 100;
    if (amount <= 0) return 0;
    const amountBase = convertToBase(amount, currency, currency === 'USD' ? rate : 1);
    const id = ++paymentId;
    refCounters[channel] += 1;
    const reversed = rng.chance(0.003);
    payments.push({
      payment_id: id,
      payer_id: input.payer.payer_id,
      assessment_id: input.assessmentId ?? null,
      bill_id: input.billId ?? null,
      revenue_code: input.revenueCode,
      amount,
      currency,
      exchange_rate: currency === 'USD' ? rate : 1,
      amount_base: amountBase,
      channel,
      external_ref: `${refPrefix[channel]}-${ymd(input.paidAt)}-${String(refCounters[channel]).padStart(6, '0')}`,
      paid_at: input.paidAt,
      status: reversed ? 'REVERSED' : 'DONE',
      source: channel === 'CASH' ? 'COUNTER' : rng.chance(0.6) ? 'CALLBACK' : 'BULK_API',
      provider_ref: channel === 'MOBILE_MONEY' ? `PRV${String(id).padStart(9, '0')}` : null,
      captured_by: channel === 'CASH' ? options.officerId : null,
      processed_at: new Date(input.paidAt.getTime() + 60_000),
      created_at: input.paidAt,
    });
    if (reversed) {
      const decidedAt = new Date(
        Math.min(options.today.getTime(), input.paidAt.getTime() + rng.int(1, 3) * DAY_MS),
      );
      reversals.push({
        payment_id: id,
        reason: rng.pick([
          'Duplicate receipt issued',
          'Posted to wrong payer',
          'Bank recalled the transfer',
        ]),
        status: 'APPROVED',
        requested_by: options.officerId,
        requested_at: new Date(input.paidAt.getTime() + 3_600_000),
        decided_by: options.supervisorId,
        decided_at: decidedAt,
        decision_note: 'Verified against channel statement',
      });
      return 0;
    }
    return amountBase;
  }

  const payTime = (day: Date) => new Date(day.getTime() + rng.int(6 * 60, 17 * 60) * 60_000);

  // ── Water accounts ──
  const tariffConfigs = new Map<TariffClass, TariffConfig>(
    TARIFFS.map((t) => [
      t.tariff_class,
      {
        serviceCharge: t.service_charge,
        bands: t.bands.map(([upToM3, ratePerM3]) => ({ upToM3, ratePerM3 })),
      },
    ]),
  );
  const classMean: Record<TariffClass, [number, number]> = {
    DOMESTIC: [14, 5],
    COMMERCIAL: [40, 12],
    INSTITUTIONAL: [90, 20],
  };
  // Dry season (Jan-Mar) uses more water; the short rains (Oct-Dec) less.
  const seasonal = [1.2, 1.2, 1.15, 0.95, 0.95, 0.95, 1.05, 1.05, 1.05, 0.9, 0.9, 0.9];

  const accounts: Prisma.WaterAccountCreateManyInput[] = [];
  const readings: Prisma.MeterReadingCreateManyInput[] = [];
  const bills: Prisma.WaterBillCreateManyInput[] = [];
  let readingId = 0;
  let billId = 0;
  let billSeq = 0;
  const currentMonth = monthStart(today);

  for (let n = 1; n <= options.waterAccountCount; n++) {
    const payer = n === 1 ? payers[0]! : payers[(n * 7) % Math.min(payers.length, 400)]!;
    const tariffClass: TariffClass =
      payer.payer_type === 'INDIVIDUAL' ? 'DOMESTIC' : n % 9 === 0 ? 'INSTITUTIONAL' : 'COMMERCIAL';
    const accountNo = `WA-${String(n).padStart(6, '0')}`;
    const meterNo = `MTR-${String(100_000 + n)}`;
    // 80% of accounts exist for the whole history; the rest are connected over time (growth).
    const startMonth = rng.chance(0.8) ? historyStart : addMonths(historyStart, rng.int(1, 20));
    accounts.push({
      account_no: accountNo,
      payer_id: payer.payer_id,
      meter_no: meterNo,
      meter_digits: 5,
      tariff_class: tariffClass,
      address: payer.address,
      created_at: addDays(startMonth, -10),
    });

    const [mean, sd] = classMean[tariffClass];
    const personalFactor = 0.6 + rng.next() * 0.8;
    // A handful of meters start close to 99,999 so the history contains real rollovers.
    let value = n % 97 === 0 ? 99_700 + rng.int(0, 200) : rng.int(0, 30_000);
    readings.push({
      reading_id: ++readingId,
      meter_no: meterNo,
      reading_date: addDays(startMonth, -6),
      reading_value: value,
      reading_type: 'ACTUAL',
      consumption_m3: 0,
    });
    const history: { consumptionM3: number; readingType: 'ACTUAL' | 'ESTIMATED' }[] = [];

    let previousTotalDue = 0;
    let paidOnPreviousBill = 0;
    for (let month = startMonth; month <= currentMonth; month = addMonths(month, 1)) {
      const isCurrentMonth = month.getTime() === currentMonth.getTime();
      const readingDate = isCurrentMonth
        ? utcDate(today.getUTCFullYear(), today.getUTCMonth(), Math.min(25, today.getUTCDate()))
        : addDays(month, 24);
      if (isCurrentMonth && rng.chance(0.05)) continue; // missing reading -> estimated by the cycle

      let consumption = Math.max(
        0,
        Math.round(rng.normal(mean * personalFactor * seasonal[month.getUTCMonth()]!, sd)),
      );
      let readingType: 'ACTUAL' | 'ESTIMATED' = 'ACTUAL';
      if (!isCurrentMonth && rng.chance(0.04)) {
        readingType = 'ESTIMATED';
        consumption = estimateConsumption(history) ?? mean;
      }
      // In the current month a few meters jump well above normal: the billing cycle should hold them.
      if (isCurrentMonth && rng.chance(0.03)) {
        const avg =
          history.slice(0, 3).reduce((s, h) => s + h.consumptionM3, 0) /
          Math.max(1, Math.min(3, history.length));
        consumption = Math.round(Math.max(avg, 5) * 3.5);
      }
      const next = value + consumption;
      const rolledOver = next >= 100_000;
      value = next % 100_000;
      history.unshift({ consumptionM3: consumption, readingType });
      readings.push({
        reading_id: ++readingId,
        meter_no: meterNo,
        reading_date: readingDate,
        reading_value: value,
        reading_type: readingType,
        reading_flag: rolledOver ? 'ROLLOVER' : 'NORMAL',
        consumption_m3: consumption,
      });
      if (isCurrentMonth) break; // the current month is billed by the demo billing cycle

      // Bill for this month, issued on the 1st of next month and due on the 21st.
      const charges = calculateWaterBill(consumption, tariffConfigs.get(tariffClass)!);
      const composition = composeBill({
        previousBalance: previousTotalDue,
        paymentsReceived: paidOnPreviousBill,
        currentCharges: charges.total,
      });
      const issueDate = addMonths(month, 1);
      const id = ++billId;

      // Will the customer pay this bill?
      const p = progressAt(issueDate);
      const payProbability = { GOOD: 0.9, AVERAGE: 0.7, POOR: 0.25 }[payer.reliability] + 0.08 * p;
      let paid = 0;
      if (composition.totalDue > 0 && rng.chance(payProbability)) {
        const full = rng.chance(0.8);
        const amount = full
          ? composition.totalDue
          : Math.round((composition.totalDue * (0.4 + rng.next() * 0.4)) / 10) * 10;
        paid = pay({
          payer,
          revenueCode: 'WTR',
          amountBase: amount,
          paidAt: payTime(addDays(issueDate, rng.int(2, 25))),
          usdShare: 0.15,
          billId: id,
          isFull: full,
        });
      }
      const isLatest = addMonths(month, 1).getTime() === currentMonth.getTime();
      bills.push({
        bill_id: id,
        account_no: accountNo,
        billing_month: month,
        reading_id: readingId,
        consumption_m3: consumption,
        is_estimated: readingType === 'ESTIMATED',
        consumption_charge: charges.consumptionCharge,
        service_charge: charges.serviceCharge,
        amount_billed: charges.total,
        previous_balance: composition.previousBalance,
        payments_received: composition.paymentsReceived,
        arrears_brought_forward: composition.arrearsBroughtForward,
        total_due: composition.totalDue,
        amount_paid: paid,
        due_date: addDays(issueDate, 20),
        status:
          paid >= composition.totalDue
            ? 'PAID'
            : !isLatest
              ? 'CARRIED_FORWARD'
              : paid > 0
                ? 'PART_PAID'
                : 'ISSUED',
        control_number: generateControlNumber('WB', issueDate.getUTCFullYear(), ++billSeq),
        created_at: issueDate,
      });
      previousTotalDue = composition.totalDue;
      paidOnPreviousBill = paid;
    }
  }

  // ── Tax assessments ──
  const assessments: Prisma.AssessmentCreateManyInput[] = [];
  let assessmentId = 0;
  let assessmentSeq = 0;
  const outcomeWeights: Record<Reliability, [number, number, number, number]> = {
    GOOD: [85, 8, 5, 2],
    AVERAGE: [60, 18, 10, 12],
    POOR: [30, 20, 10, 40],
  };

  function assess(
    payer: SeedPayer,
    revenueCode: string,
    baseAmount: number,
    createdAt: Date,
    dueDate: Date,
    period: string,
    forceUnpaid = false,
  ) {
    if (createdAt > today) return;
    // Amounts rise ~0.5% a month (inflation / rate reviews).
    const monthsIn = Math.max(0, (createdAt.getTime() - historyStart.getTime()) / (30 * DAY_MS));
    const amountDue = Math.round((baseAmount * (1 + 0.005 * monthsIn)) / 100) * 100;
    const id = ++assessmentId;

    const [onTime, late, instalments, none] = outcomeWeights[payer.reliability];
    const shift = 10 * progressAt(createdAt); // compliance improves over time
    const outcome = forceUnpaid
      ? 'NONE'
      : rng.weighted([
          ['ON_TIME', onTime + shift],
          ['LATE', late],
          ['INSTALMENTS', instalments],
          ['NONE', Math.max(0, none - shift)],
        ] as const);
    const usdShare = revenueCode === 'MF' ? 0.1 : 0.6;
    let paid = 0;
    const window = Math.max(1, Math.round((dueDate.getTime() - createdAt.getTime()) / DAY_MS));

    if (outcome === 'ON_TIME' || outcome === 'LATE') {
      const day =
        outcome === 'ON_TIME'
          ? addDays(createdAt, rng.int(0, window))
          : addDays(dueDate, rng.int(5, 75));
      paid += pay({
        payer,
        revenueCode,
        amountBase: amountDue,
        paidAt: payTime(day),
        usdShare,
        assessmentId: id,
        isFull: true,
      });
    } else if (outcome === 'INSTALMENTS') {
      const first = Math.round((amountDue * (0.4 + rng.next() * 0.2)) / 100) * 100;
      let day = addDays(createdAt, rng.int(0, window));
      paid += pay({
        payer,
        revenueCode,
        amountBase: first,
        paidAt: payTime(day),
        usdShare,
        assessmentId: id,
        isFull: false,
      });
      if (rng.chance(0.6)) {
        day = addDays(day, rng.int(20, 40));
        paid += pay({
          payer,
          revenueCode,
          amountBase: amountDue - first,
          paidAt: payTime(day),
          usdShare,
          assessmentId: id,
          isFull: true,
        });
      }
    }
    assessments.push({
      assessment_id: id,
      payer_id: payer.payer_id,
      revenue_code: revenueCode,
      amount_due: amountDue,
      amount_paid: round2(paid),
      due_date: dueDate,
      status: paid <= 0 ? 'OPEN' : paid >= amountDue ? 'PAID' : 'PART_PAID',
      control_number: generateControlNumber('AS', createdAt.getUTCFullYear(), ++assessmentSeq),
      period,
      description: `${period} ${revenueCode}`,
      created_by: options.officerId,
      created_at: createdAt,
    });
  }

  const businesses = payers.filter((p) => p.payer_type === 'BUSINESS');
  const individuals = payers.filter((p) => p.payer_type === 'INDIVIDUAL');
  const lastYear = today.getUTCFullYear();

  // Business licence: every business, due 31 January each year (the January spike).
  for (const payer of businesses) {
    const base = rng.int(30, 300) * 5000;
    for (let year = historyStart.getUTCFullYear() + 1; year <= lastYear; year++) {
      assess(
        payer,
        'BL',
        base,
        utcDate(year, 0, 2),
        utcDate(year, 0, 31),
        `FY${year}`,
        payer.payer_id === 1 && year === lastYear,
      );
    }
  }
  // Property rate: quarterly for 400 property owners.
  for (const payer of payers.slice(0, 400)) {
    const base = rng.int(30, 250) * 1000;
    for (let q = 0; q <= 9; q++) {
      const quarterStart = addMonths(
        utcDate(historyStart.getUTCFullYear(), Math.floor(historyStart.getUTCMonth() / 3) * 3, 1),
        q * 3,
      );
      if (quarterStart < historyStart) continue;
      const period = `${quarterStart.getUTCFullYear()}-Q${Math.floor(quarterStart.getUTCMonth() / 3) + 1}`;
      assess(payer, 'PR', base, quarterStart, addDays(quarterStart, 45), period);
    }
  }
  // Market fees: monthly for 260 market traders.
  for (const payer of individuals.slice(0, 260)) {
    const base = rng.int(8, 25) * 1000;
    for (let m = 0; m <= totalMonths; m++) {
      const month = addMonths(historyStart, m);
      assess(payer, 'MF', base, month, addDays(month, 9), monthKey(month));
    }
  }
  // Vehicle licence: annual, each owner in their own month.
  for (const payer of payers.filter((_, i) => i % 3 === 1).slice(0, 150)) {
    const base = rng.int(60, 180) * 1000;
    const anniversary = rng.int(0, 11);
    for (let year = historyStart.getUTCFullYear(); year <= lastYear; year++) {
      const created = utcDate(year, anniversary, 1);
      if (created < historyStart) continue;
      assess(payer, 'VL', base, created, addDays(created, 30), `${year}`);
    }
  }
  // Stamp duty: ad hoc, about 60 documents a month.
  for (let m = 0; m <= totalMonths; m++) {
    const month = addMonths(historyStart, m);
    for (let i = 0; i < 60; i++) {
      const created = addDays(month, rng.int(0, 27));
      assess(
        rng.pick(payers),
        'SD',
        rng.int(20, 400) * 1000,
        created,
        addDays(created, 14),
        monthKey(month),
      );
    }
  }

  // Two reversal requests waiting for approval, to demonstrate segregation of duties:
  // one requested by supervisor@ (so only supervisor2@ may approve it) and one by the officer.
  const pendingCandidates = payments
    .filter((p) => p.status === 'DONE' && p.assessment_id != null)
    .slice(-2);
  const requesters = [options.supervisorId, options.officerId];
  pendingCandidates.forEach((payment, i) => {
    reversals.push({
      payment_id: payment.payment_id!,
      reason:
        i === 0 ? 'Receipt issued to wrong TIN' : 'Customer paid twice for the same assessment',
      status: 'PENDING_APPROVAL',
      requested_by: requesters[i]!,
      requested_at: addDays(today, -1),
    });
  });

  // ── Write everything ──
  await prisma.waterAccount.createMany({ data: accounts });
  await insertInChunks(readings, (chunk) => prisma.meterReading.createMany({ data: chunk }));
  await insertInChunks(bills, (chunk) => prisma.waterBill.createMany({ data: chunk }));
  await insertInChunks(assessments, (chunk) => prisma.assessment.createMany({ data: chunk }));
  await insertInChunks(payments, (chunk) => prisma.payment.createMany({ data: chunk }));
  await prisma.reversal.createMany({ data: reversals });
  await prisma.exchangeRate.createMany({ data: exchangeRates });

  // Explicit ids were used above, so move each sequence past the highest id.
  for (const [table, column] of [
    ['payer', 'payer_id'],
    ['meter_reading', 'reading_id'],
    ['water_bill', 'bill_id'],
    ['assessment', 'assessment_id'],
    ['payment', 'payment_id'],
  ] as const) {
    await prisma.$executeRawUnsafe(
      `SELECT setval(pg_get_serial_sequence('${table}', '${column}'), (SELECT MAX(${column}) FROM ${table}))`,
    );
  }
  await prisma.$executeRawUnsafe(`SELECT setval('assessment_control_seq', ${assessmentSeq})`);
  await prisma.$executeRawUnsafe(`SELECT setval('bill_control_seq', ${billSeq})`);

  await seedTargets(prisma, payments, historyStart, totalMonths);

  return {
    payers: payers.length,
    waterAccounts: accounts.length,
    readings: readings.length,
    bills: bills.length,
    assessments: assessments.length,
    payments: payments.length,
    reversals: reversals.length,
    duplicateFlags: duplicateFlags.length,
    taxpayerPayerId: 1,
  };
}

/**
 * Monthly targets per revenue type: the trend line of actual collections plus 7% (targets are
 * usually set a little above what was achieved), extended 6 months into the future.
 */
async function seedTargets(
  prisma: PrismaClient,
  payments: Prisma.PaymentCreateManyInput[],
  historyStart: Date,
  totalMonths: number,
): Promise<void> {
  const totals = new Map<string, number[]>();
  for (const payment of payments) {
    if (payment.status !== 'DONE') continue;
    const paidAt = payment.paid_at as Date;
    const index =
      (paidAt.getUTCFullYear() - historyStart.getUTCFullYear()) * 12 +
      paidAt.getUTCMonth() -
      historyStart.getUTCMonth();
    const series = totals.get(payment.revenue_code) ?? new Array<number>(totalMonths).fill(0);
    if (index >= 0 && index < totalMonths) series[index]! += Number(payment.amount_base);
    totals.set(payment.revenue_code, series);
  }
  const targets: Prisma.RevenueTargetCreateManyInput[] = [];
  for (const [revenueCode, series] of totals) {
    const model = linearRegression(series.map((y, x) => ({ x, y })));
    for (let m = 0; m < totalMonths + 6; m++) {
      const target = Math.max(0, Math.round((predict(model, m) * 1.07) / 1000) * 1000);
      targets.push({
        revenue_code: revenueCode,
        period_month: addMonths(historyStart, m),
        target_amount: target,
      });
    }
  }
  await prisma.revenueTarget.createMany({ data: targets });
}
