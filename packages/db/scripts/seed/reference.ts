/**
 * Reference data: permissions, the six system roles, demo users, revenue types, tariffs and
 * system configuration.
 */
import { hash } from '@node-rs/argon2';
import { PERMISSIONS, PERMISSION_CODES, SYSTEM_ROLES } from '@ircub/core';
import type { Prisma, PrismaClient } from '../../src/generated/prisma/client';

export const COLLECTION_BANK_GL = '1101-000';

export const REVENUE_TYPES = [
  {
    revenue_code: 'BL',
    name: 'Business Licence',
    category: 'TAX',
    gl_code: '1410-100',
    default_amount: 450000,
    description: 'Annual business licence, due 31 January',
  },
  {
    revenue_code: 'PR',
    name: 'Property Rate',
    category: 'TAX',
    gl_code: '1420-100',
    default_amount: 90000,
    description: 'Quarterly property rate',
  },
  {
    revenue_code: 'MF',
    name: 'Market Fees',
    category: 'TAX',
    gl_code: '1430-100',
    default_amount: 15000,
    description: 'Monthly market stall fee',
  },
  {
    revenue_code: 'VL',
    name: 'Vehicle Licence',
    category: 'TAX',
    gl_code: '1440-100',
    default_amount: 110000,
    description: 'Annual vehicle licence',
  },
  {
    revenue_code: 'SD',
    name: 'Stamp Duty',
    category: 'TAX',
    gl_code: '1450-100',
    default_amount: 60000,
    description: 'Duty on registered documents',
  },
  {
    revenue_code: 'WTR',
    name: 'Water Charges',
    category: 'WATER',
    gl_code: '1510-100',
    default_amount: null,
    description: 'Metered water bills (State Water Agency)',
  },
  {
    revenue_code: 'ROAD',
    name: 'Road Levy (discontinued)',
    category: 'TAX',
    gl_code: '1490-100',
    default_amount: 20000,
    description: 'Inactive: kept for history and validation tests',
    is_active: false,
  },
] as const;

export const TARIFFS = [
  {
    tariff_class: 'DOMESTIC',
    name: 'Domestic 2024',
    service_charge: 200,
    bands: [
      [10, 50],
      [30, 75],
      [null, 110],
    ],
  },
  {
    tariff_class: 'COMMERCIAL',
    name: 'Commercial 2024',
    service_charge: 500,
    bands: [
      [20, 90],
      [null, 130],
    ],
  },
  {
    tariff_class: 'INSTITUTIONAL',
    name: 'Institutional 2024',
    service_charge: 400,
    bands: [
      [50, 80],
      [null, 100],
    ],
  },
] as const;

export const DEMO_USERS = [
  { email: 'admin@ircub.test', full_name: 'Amina Admin', role: 'SYSTEM_ADMIN' },
  { email: 'supervisor@ircub.test', full_name: 'Samira Supervisor', role: 'REVENUE_SUPERVISOR' },
  {
    email: 'supervisor2@ircub.test',
    full_name: 'Said Second-Supervisor',
    role: 'REVENUE_SUPERVISOR',
  },
  { email: 'officer@ircub.test', full_name: 'Omar Officer', role: 'REVENUE_OFFICER' },
  { email: 'water@ircub.test', full_name: 'Warsame Water-Billing', role: 'WATER_BILLING_OFFICER' },
  { email: 'auditor@ircub.test', full_name: 'Idil Auditor', role: 'AUDITOR' },
  { email: 'taxpayer@ircub.test', full_name: 'Hodan (Taxpayer)', role: 'TAXPAYER' },
] as const;

export async function seedAccessControl(prisma: PrismaClient): Promise<void> {
  await prisma.permission.createMany({
    data: PERMISSION_CODES.map((code) => ({
      code,
      module: PERMISSIONS[code][0],
      description: PERMISSIONS[code][1],
    })),
  });
  const permissionIds = new Map(
    (await prisma.permission.findMany()).map((p) => [p.code, p.permission_id]),
  );

  // Parents first, so child roles can reference them.
  const ordered = [...SYSTEM_ROLES].sort(
    (a, b) => Number(a.parent !== null) - Number(b.parent !== null),
  );
  const roleIds = new Map<string, number>();
  for (const role of ordered) {
    const created = await prisma.role.create({
      data: {
        code: role.code,
        name: role.name,
        description: role.description,
        is_system: true,
        parent_role_id: role.parent ? roleIds.get(role.parent) : null,
        permissions: {
          create: role.permissions.map((code) => ({ permission_id: permissionIds.get(code)! })),
        },
      },
    });
    roleIds.set(role.code, created.role_id);
  }
}

/**
 * Creates one demo user per role. The System Administrator gets its own email and password from
 * SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD (.env); every other demo user uses SEED_DEMO_PASSWORD.
 */
export async function seedDemoUsers(
  prisma: PrismaClient,
  password: string,
  admin: { email: string; password: string },
): Promise<Map<string, number>> {
  const passwordHash = await hash(password);
  const adminHash = await hash(admin.password);
  const roles = new Map((await prisma.role.findMany()).map((r) => [r.code, r.role_id]));
  const userIds = new Map<string, number>();
  for (const user of DEMO_USERS) {
    const isAdmin = user.role === 'SYSTEM_ADMIN';
    const email = isAdmin ? admin.email : user.email;
    const created = await prisma.user.create({
      data: {
        email,
        full_name: user.full_name,
        password_hash: isAdmin ? adminHash : passwordHash,
        roles: { create: [{ role_id: roles.get(user.role)! }] },
      },
    });
    userIds.set(user.email, created.user_id);
  }
  return userIds;
}

export async function seedRevenueAndTariffs(
  prisma: PrismaClient,
  effectiveFrom: Date,
): Promise<void> {
  await prisma.revenueType.createMany({
    data: REVENUE_TYPES.map((rt) => ({
      revenue_code: rt.revenue_code,
      name: rt.name,
      category: rt.category,
      gl_code: rt.gl_code,
      default_amount: rt.default_amount,
      description: rt.description,
      is_active: 'is_active' in rt ? rt.is_active : true,
    })),
  });
  for (const tariff of TARIFFS) {
    await prisma.tariff.create({
      data: {
        tariff_class: tariff.tariff_class,
        name: tariff.name,
        service_charge: tariff.service_charge,
        effective_from: effectiveFrom,
        bands: {
          create: tariff.bands.map(([upTo, rate], index) => ({
            sort_order: index + 1,
            up_to_m3: upTo,
            rate_per_m3: rate,
          })),
        },
      },
    });
  }
}

export async function seedSystemConfig(prisma: PrismaClient): Promise<void> {
  const config: Record<string, unknown> = {
    penalty_rules: {
      initialMonths: 3,
      initialRatePercent: 5,
      laterRatePercent: 10,
      capPercent: 100,
    },
    collection_bank_gl: COLLECTION_BANK_GL,
    abnormal_consumption_threshold_pct: 200,
    bill_due_days: 21,
    financial_year_start_month: 1,
    alert_rules: { collectionDropPercent: 50, reversalSpikeFactor: 3, reversalSpikeMinCount: 5 },
    payment_status_check: { maxAttempts: 3, baseDelayMs: 2000 },
  };
  await prisma.systemConfig.createMany({
    data: Object.entries(config).map(([key, value]) => ({
      key,
      value: value as Prisma.InputJsonValue,
    })),
  });
}
