import { expect, test, type Page } from '@playwright/test';
import { login } from './helpers';

const nav = (page: Page) => page.getByRole('navigation', { name: 'Main' }).first();

test('each role gets its own menu', async ({ page }) => {
  const expectations: [string, string[], string[]][] = [
    [
      'admin@ircub.test',
      ['Users', 'Roles & permissions', 'System configuration'],
      ['Capture payment', 'Meter readings'],
    ],
    [
      'officer@ircub.test',
      ['Capture payment', 'Payers', 'Assessments'],
      ['Users', 'Audit log', 'Journal batches'],
    ],
    [
      'supervisor@ircub.test',
      ['Capture payment', 'Reversals', 'Journal batches', 'Possible duplicates'],
      ['Users'],
    ],
    ['water@ircub.test', ['Meter readings', 'Billing cycles'], ['Capture payment', 'Users']],
    [
      'auditor@ircub.test',
      ['Audit log', 'Payments'],
      ['Capture payment', 'Users', 'Meter readings'],
    ],
    ['taxpayer@ircub.test', ['My account'], ['Payers', 'Payments', 'Users']],
  ];
  for (const [email, visible, hidden] of expectations) {
    await page.context().clearCookies();
    await login(page, email);
    for (const label of visible)
      await expect(nav(page).getByRole('link', { name: label, exact: true })).toBeVisible();
    for (const label of hidden)
      await expect(nav(page).getByRole('link', { name: label, exact: true })).toHaveCount(0);
  }
});

test('a page the role may not open shows the forbidden page', async ({ page }) => {
  await login(page, 'officer@ircub.test');
  await page.goto('/admin/users');
  await expect(page).toHaveURL(/\/forbidden/);
  await expect(
    page.getByRole('heading', { name: 'You do not have access to this page' }),
  ).toBeVisible();
});

test('API routes answer 401 without a session and 403 without permission', async ({
  page,
  request,
}) => {
  const anonymous = await request.get('/api/reports/revenue-summary');
  expect(anonymous.status()).toBe(401);

  // The self-service taxpayer has no reporting permission.
  await login(page, 'taxpayer@ircub.test');
  const forbidden = await page.request.get('/api/reports/revenue-summary');
  expect(forbidden.status()).toBe(403);
});

test('a wrong password is rejected with a generic message', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('auditor@ircub.test');
  await page.getByLabel('Password').fill('not-the-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Email or password is incorrect.')).toBeVisible();
});
