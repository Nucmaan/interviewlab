/**
 * Catalogue of permission codes and the six system roles from the brief.
 *
 * The CODES are defined here so TypeScript catches typos in `requirePermission('...')`.
 * Which role HAS which permission is data: the seed writes the defaults below into
 * role_permission, and administrators can change them (or create new roles) at runtime.
 */

export const PERMISSIONS = {
  'users.view': ['users', 'View user accounts'],
  'users.manage': ['users', 'Create, edit and deactivate users'],
  'roles.manage': ['users', 'Create roles and assign permissions'],
  'config.manage': ['users', 'Change system configuration (penalty rules, thresholds, GL mapping)'],

  'payers.view': ['registry', 'View payers and their 360° profile'],
  'payers.create': ['registry', 'Register payers'],
  'payers.edit': ['registry', 'Edit payer details'],
  'duplicates.review': ['registry', 'Review possible duplicate registrations'],

  'revenue_types.manage': ['revenue', 'Configure revenue types, rates and GL codes'],
  'assessments.view': ['revenue', 'View assessments'],
  'assessments.create': ['revenue', 'Create assessments'],

  'payments.view': ['payments', 'View payments and receipts'],
  'payments.capture': ['payments', 'Capture payments at the counter'],
  'payments.upload': ['payments', 'Bulk upload payment files'],
  'reversals.request': ['payments', 'Request a payment reversal'],
  'reversals.approve': ['payments', 'Approve or reject payment reversals'],
  'reconciliation.run': ['payments', 'Run channel reconciliation'],

  'water.view': ['water', 'View water accounts, readings and bills'],
  'water.accounts.manage': ['water', 'Create and edit water accounts'],
  'readings.capture': ['water', 'Capture meter readings'],
  'billing.run': ['water', 'Run the monthly billing cycle'],
  'billing.release': ['water', 'Release bills held for investigation'],

  'fmis.view': ['fmis', 'View FMIS journals and reconciliation'],
  'fmis.post': ['fmis', 'Trigger or retry FMIS posting'],

  'dashboard.view': ['dashboard', 'View the executive dashboard'],
  'alerts.manage': ['dashboard', 'Acknowledge alerts'],

  'audit.view': ['audit', 'View the audit log'],
  'audit.verify': ['audit', 'Run the audit chain verification'],

  'self.view': ['portal', 'View own bills, assessments and payments'],
  'self.pay': ['portal', 'Pay own bills and assessments'],
} as const satisfies Record<string, readonly [string, string]>;

export type PermissionCode = keyof typeof PERMISSIONS;

export const PERMISSION_CODES = Object.keys(PERMISSIONS) as PermissionCode[];

export interface SystemRoleDefinition {
  code: string;
  name: string;
  description: string;
  parent: string | null;
  permissions: PermissionCode[];
}

const OFFICER_PERMISSIONS: PermissionCode[] = [
  'payers.view',
  'payers.create',
  'payers.edit',
  'assessments.view',
  'assessments.create',
  'payments.view',
  'payments.capture',
  'payments.upload',
  'reversals.request',
  'water.view',
  'dashboard.view',
];

export const SYSTEM_ROLES: SystemRoleDefinition[] = [
  {
    code: 'SYSTEM_ADMIN',
    name: 'System Administrator',
    description: 'Manages users, roles and system configuration.',
    parent: null,
    permissions: [
      'users.view',
      'users.manage',
      'roles.manage',
      'config.manage',
      'revenue_types.manage',
      'dashboard.view',
    ],
  },
  {
    code: 'REVENUE_OFFICER',
    name: 'Revenue Officer',
    description: 'Registers payers, creates assessments and captures payments.',
    parent: null,
    permissions: OFFICER_PERMISSIONS,
  },
  {
    code: 'REVENUE_SUPERVISOR',
    name: 'Revenue Supervisor',
    description: 'Views, approves and reverses revenue transactions. Inherits Revenue Officer.',
    parent: 'REVENUE_OFFICER',
    permissions: [
      'reversals.approve',
      'duplicates.review',
      'reconciliation.run',
      'fmis.view',
      'fmis.post',
      'alerts.manage',
    ],
  },
  {
    code: 'WATER_BILLING_OFFICER',
    name: 'Water Billing Officer',
    description: 'Captures meter readings and runs billing cycles.',
    parent: null,
    permissions: [
      'payers.view',
      'water.view',
      'water.accounts.manage',
      'readings.capture',
      'billing.run',
      'billing.release',
      'dashboard.view',
    ],
  },
  {
    code: 'AUDITOR',
    name: 'Auditor',
    description: 'View-only access to transactions, audit logs and reports.',
    parent: null,
    permissions: [
      'payers.view',
      'assessments.view',
      'payments.view',
      'water.view',
      'fmis.view',
      'dashboard.view',
      'audit.view',
      'audit.verify',
    ],
  },
  {
    code: 'TAXPAYER',
    name: 'Taxpayer / Customer',
    description: 'Self-service: views own bills and assessments and makes payments.',
    parent: null,
    permissions: ['self.view', 'self.pay'],
  },
];
