import { expect, test, type Page } from '@playwright/test';
import { login, uniqueRef } from './helpers';

/** Captures a cash payment through the UI and returns its reference. */
async function capturePayment(page: Page): Promise<string> {
  const ref = uniqueRef('E2E-REV');
  await page.goto('/payments/capture');
  await page.getByLabel('Search payer').fill('WA-000001');
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByRole('button', { name: /Hodan Trading Ltd/ }).click();
  await page.getByLabel('Revenue type').selectOption('SD');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Amount').fill('500');
  await page.getByLabel('External reference').fill(ref);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Submit payment' }).click();
  await expect(page.getByText('DONE', { exact: true })).toBeVisible({ timeout: 30_000 });
  return ref;
}

async function requestReversal(page: Page, ref: string) {
  await page.goto(`/payments?ref=${ref}`);
  await page.getByRole('link', { name: ref }).click();
  await page.getByLabel('Reason').fill('Captured against the wrong revenue type during E2E test');
  await page.getByRole('button', { name: 'Request reversal' }).click();
  await expect(page.getByText('Reversal requested.')).toBeVisible();
}

test('segregation of duties: a supervisor cannot approve their own reversal, another can', async ({
  page,
}) => {
  await login(page, 'supervisor@ircub.test');
  const ref = await capturePayment(page);
  await requestReversal(page, ref);

  await page.goto('/payments/reversals');
  const row = page.getByRole('row', { name: new RegExp(ref) });
  await expect(row.getByText('You requested this — another supervisor must decide.')).toBeVisible();
  await expect(row.getByRole('button', { name: 'Approve' })).toHaveCount(0);

  await page.context().clearCookies();
  await login(page, 'supervisor2@ircub.test');
  await page.goto('/payments/reversals');
  const row2 = page.getByRole('row', { name: new RegExp(ref) });
  await row2.getByRole('button', { name: 'Approve' }).click();
  await row2.getByRole('button', { name: 'Confirm approve' }).click();
  // Once approved, it leaves the "pending" list.
  await expect(page.getByRole('row', { name: new RegExp(ref) })).toHaveCount(0);
  await page.goto(`/payments?ref=${ref}`);
  await expect(
    page.getByRole('row', { name: new RegExp(ref) }).getByText('REVERSED'),
  ).toBeVisible();
});
