import { expect, test } from '@playwright/test';
import { login } from './helpers';

test('TIN is unique: registering the same TIN twice is refused', async ({ page }) => {
  const tin = String(Date.now()).slice(-10);
  await login(page, 'officer@ircub.test');
  await page.goto('/payers/new');
  await page.getByLabel('TIN').fill(tin);
  await page.getByLabel('Full name / business name').fill('E2E Unique TIN');
  await page.getByLabel('National ID (individuals)').fill(`SO${tin.slice(-8)}`);
  await page.getByRole('button', { name: 'Register payer' }).click();
  await expect(page.getByRole('heading', { name: 'E2E Unique TIN' })).toBeVisible();

  await page.goto('/payers/new');
  await page.getByLabel('TIN').fill(tin);
  await page.getByLabel('Full name / business name').fill('E2E Unique TIN again');
  await page.getByLabel('National ID (individuals)').fill('SO11112222');
  await page.getByRole('button', { name: 'Register payer' }).click();
  await expect(page.getByText(`TIN ${tin} is already registered`)).toBeVisible();
});

test('a phone number already used by another payer is flagged for review, not blocked', async ({
  page,
}) => {
  const tin = String(Date.now() + 1).slice(-10);
  await login(page, 'officer@ircub.test');
  const search = await page.request.get('/api/payers/search?q=2001000002');
  const phone = ((await search.json()) as { results: { phone: string }[] }).results[0]!.phone;

  await page.goto('/payers/new');
  await page.getByLabel('TIN').fill(tin);
  await page.getByLabel('Full name / business name').fill('E2E Shared Phone');
  await page.getByLabel('National ID (individuals)').fill(`SO${tin.slice(-8)}`);
  // Same number written the local way (0 instead of +252).
  await page.getByLabel('Phone').fill(phone.replace('+252', '0'));
  await page.getByRole('button', { name: 'Register payer' }).click();
  await expect(page.getByText(/flagged for review/)).toBeVisible();
  await expect(page.getByText(/Possible duplicate/)).toBeVisible();
});

test('CSV upload validates rows in the browser and reports accepted and rejected rows', async ({
  page,
}) => {
  await login(page, 'officer@ircub.test');
  await page.goto('/revenue/upload');
  const stamp = Date.now();
  const csv = [
    'payer_id,revenue_code,amount,currency,channel,external_ref,paid_at',
    `12,BL,150.50,USD,BANK,E2E-CSV-${stamp}-1,2026-01-15`,
    `13,MF,-5,SOS,CASH,E2E-CSV-${stamp}-2,2026-01-15`,
    `99999,BL,10,USD,BANK,E2E-CSV-${stamp}-3,2026-01-15`,
  ].join('\n');
  await page
    .getByLabel('CSV file')
    .setInputFiles({ name: 'e2e.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  // Live validation catches the negative amount before upload.
  await expect(page.getByText('Preview: 3 rows · 2 look valid · 1 with problems')).toBeVisible();
  await page.getByRole('button', { name: /Upload/ }).click();
  await expect(page.getByText('Upload report · e2e.csv')).toBeVisible();
  await expect(page.getByText('Payer 99999 does not exist')).toBeVisible();
  await expect(page.getByText('amount: Amount must be greater than 0')).toBeVisible();
});

test('an assessment gets a control number with a check digit', async ({ page }) => {
  await login(page, 'officer@ircub.test');
  await page.goto('/revenue/assessments');
  // The list filters also have a "Revenue type" field, so target the create form's ids.
  await page.locator('#new-tin').fill('2001000003');
  await page.locator('#new-revenueCode').selectOption('PR');
  await page.locator('#new-amountDue').fill('90000');
  await page.locator('#new-dueDate').fill('2026-12-31');
  await page.getByRole('button', { name: 'Create assessment' }).click();
  await expect(
    page.getByText(/Assessment created with control number AS-\d{4}-\d{7}-\d\./),
  ).toBeVisible();
});

test('the auditor can verify the audit chain', async ({ page }) => {
  await login(page, 'auditor@ircub.test');
  await page.goto('/audit');
  await page.getByRole('button', { name: 'Verify chain' }).click();
  await expect(page.getByText(/Chain intact: all [\d,]+ rows verified/)).toBeVisible({
    timeout: 30_000,
  });
});
