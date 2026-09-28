import { expect, test, type Page } from '@playwright/test';
import { login, uniqueRef } from './helpers';

test('officer captures a counter payment in three steps and sees it processed live', async ({
  page,
}) => {
  await login(page, 'officer@ircub.test');
  await page.goto('/payments/capture');

  // Step 1: find the payer by water account number, choose revenue type.
  await page.getByLabel('Search payer').fill('WA-000001');
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByRole('button', { name: /Hodan Trading Ltd/ }).click();
  await page.getByLabel('Revenue type').selectOption('SD');
  await page.getByRole('button', { name: 'Continue' }).click();

  // Step 2: client-side validation blocks an empty amount.
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Enter an amount')).toBeVisible();
  await page.getByLabel('Amount').fill('25000');
  await page.getByLabel('External reference').fill(uniqueRef('E2E-CSH'));
  await page.getByRole('button', { name: 'Continue' }).click();

  // Step 3: submit and see the receipt; the worker marks the payment DONE via SSE.
  await page.getByRole('button', { name: 'Submit payment' }).click();
  await expect(page.getByText('All 1 payment line(s) were accepted.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Payment receipt' })).toBeVisible();
  await expect(page.getByText('DONE', { exact: true })).toBeVisible({ timeout: 30_000 });
});

async function captureOnce(page: Page, ref: string) {
  await page.getByLabel('Search payer').fill('WA-000001');
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByRole('button', { name: /Hodan Trading Ltd/ }).click();
  await page.getByLabel('Revenue type').selectOption('SD');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Amount').fill('100');
  await page.getByLabel('External reference').fill(ref);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Submit payment' }).click();
}

test('the server rejects an external reference that was already received', async ({ page }) => {
  const ref = uniqueRef('E2E-DUP');
  await login(page, 'officer@ircub.test');
  await page.goto('/payments/capture');
  await captureOnce(page, ref);
  await expect(page.getByText('All 1 payment line(s) were accepted.')).toBeVisible();

  await page.getByRole('button', { name: 'Capture another payment' }).click();
  await captureOnce(page, ref);
  await expect(
    page.getByText(`Duplicate external reference ${ref} (already received)`),
  ).toBeVisible();
});
