import { expect, test } from '@playwright/test';
import { login } from './helpers';

test('a lower meter reading is rejected unless flagged as a rollover', async ({ page }) => {
  await login(page, 'water@ircub.test');
  await page.goto('/water/readings');
  await page.getByLabel('Account number').fill('WA-000002');
  await page.getByLabel('Meter reading (m³)').fill('0');
  await page.getByRole('button', { name: 'Save reading' }).click();
  await expect(page.getByText(/is lower than previous reading/)).toBeVisible();
});

test('the billing cycle runs, produces an exception report and held bills can be released', async ({
  page,
}) => {
  await login(page, 'water@ircub.test');
  await page.goto('/water/billing');
  await page.getByRole('button', { name: 'Run billing cycle' }).click();
  await expect(page.getByText(/Billing started|already being billed/)).toBeVisible();

  const cycleLink = page.getByRole('link', { name: new Date().toISOString().slice(0, 7) });
  await cycleLink.click();
  await expect(page.getByText('COMPLETED', { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('heading', { name: 'Exception report' })).toBeVisible();
  await expect(page.getByText('ESTIMATED').first()).toBeVisible();

  const release = page.getByRole('button', { name: 'Release' }).first();
  if (await release.count()) {
    const before = await page.getByRole('button', { name: 'Release' }).count();
    await release.click();
    await expect(page.getByRole('button', { name: 'Release' })).toHaveCount(before - 1);
  }
});

test('a bill downloads as a PDF and the statement shows a running balance', async ({ page }) => {
  await login(page, 'water@ircub.test');
  await page.goto('/water/accounts/WA-000001');
  await expect(page.getByRole('heading', { name: 'Statement · WA-000001' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Balance' })).toBeVisible();
  const href = await page.getByRole('link', { name: 'PDF' }).first().getAttribute('href');
  const pdf = await page.request.get(href!);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()['content-type']).toBe('application/pdf');
  expect((await pdf.body()).subarray(0, 4).toString()).toBe('%PDF');
});
