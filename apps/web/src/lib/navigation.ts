import type { PermissionCode } from '@ircub/core';

/**
 * The menu. Each item lists the permissions that unlock it (any one is enough). The layout only
 * shows items the signed-in user can open, which gives each role its own menu. The pages still
 * check the permission themselves - hiding a link is not security.
 */
export interface NavItem {
  href: string;
  label: string;
  permission: PermissionCode | PermissionCode[];
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

export const NAVIGATION: NavSection[] = [
  {
    title: 'Overview',
    items: [
      { href: '/dashboard', label: 'Executive dashboard', permission: 'dashboard.view' },
      { href: '/alerts', label: 'Alerts', permission: ['alerts.manage', 'audit.view'] },
    ],
  },
  {
    title: 'Self-service',
    items: [{ href: '/portal', label: 'My account', permission: 'self.view' }],
  },
  {
    title: 'Registry',
    items: [
      { href: '/payers', label: 'Payers', permission: 'payers.view' },
      { href: '/payers/duplicates', label: 'Possible duplicates', permission: 'duplicates.review' },
    ],
  },
  {
    title: 'Revenue',
    items: [
      { href: '/revenue/assessments', label: 'Assessments', permission: 'assessments.view' },
      { href: '/revenue/upload', label: 'Bulk upload (CSV)', permission: 'payments.upload' },
      {
        href: '/revenue/types',
        label: 'Revenue types & GL codes',
        permission: ['revenue_types.manage', 'assessments.view'],
      },
    ],
  },
  {
    title: 'Payments',
    items: [
      { href: '/payments/capture', label: 'Capture payment', permission: 'payments.capture' },
      { href: '/payments', label: 'Payments', permission: 'payments.view' },
      {
        href: '/payments/reversals',
        label: 'Reversals',
        permission: ['reversals.request', 'reversals.approve'],
      },
      {
        href: '/payments/rejected',
        label: 'Rejected records',
        permission: ['payments.upload', 'reversals.approve', 'audit.view'],
      },
      {
        href: '/payments/reconciliation',
        label: 'Channel reconciliation',
        permission: 'reconciliation.run',
      },
    ],
  },
  {
    title: 'Water',
    items: [
      { href: '/water/accounts', label: 'Water accounts', permission: 'water.view' },
      { href: '/water/readings', label: 'Meter readings', permission: 'readings.capture' },
      {
        href: '/water/billing',
        label: 'Billing cycles',
        permission: ['billing.run', 'water.view'],
      },
      { href: '/water/tariffs', label: 'Tariffs', permission: 'water.view' },
    ],
  },
  {
    title: 'FMIS',
    items: [
      { href: '/fmis', label: 'Journal batches', permission: 'fmis.view' },
      { href: '/fmis/reconciliation', label: 'FMIS reconciliation', permission: 'fmis.view' },
    ],
  },
  {
    title: 'Administration',
    items: [
      { href: '/admin/users', label: 'Users', permission: 'users.view' },
      { href: '/admin/roles', label: 'Roles & permissions', permission: 'roles.manage' },
      { href: '/admin/config', label: 'System configuration', permission: 'config.manage' },
      { href: '/audit', label: 'Audit log', permission: 'audit.view' },
    ],
  },
];
