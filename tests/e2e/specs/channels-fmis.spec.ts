import { expect, test } from '@playwright/test';
import { login } from './helpers';

const MOCK_URL = process.env.E2E_MOCK_URL ?? 'http://localhost:4000';

test.describe('payment channels', () => {
  // Make the simulated provider reliable for this test; restore the defaults afterwards.
  test.beforeAll(async ({ request }) => {
    await request.post(`${MOCK_URL}/admin/config`, {
      data: { failureRate: 0, callbackDropRate: 0 },
    });
  });
  test.afterAll(async ({ request }) => {
    await request.post(`${MOCK_URL}/admin/config`, {
      data: { failureRate: 0.1, callbackDropRate: 0.2 },
    });
  });

  test('a customer pays a water bill with mobile money and sees it confirmed live', async ({
    page,
  }) => {
    await login(page, 'taxpayer@ircub.test');
    await page.goto('/portal');
    const pay = page.getByRole('button', { name: 'Pay with mobile money' }).first();
    test.skip((await pay.count()) === 0, 'Nothing outstanding for the demo customer');
    await pay.click();
    await page.getByRole('button', { name: /^Pay SOS/ }).click();
    await expect(page.getByText('Confirm the payment on your phone…')).toBeVisible();
    await expect(page.getByText('Paid. Thank you!')).toBeVisible({ timeout: 45_000 });
  });

  test('channel reconciliation reports matches and differences', async ({ page }) => {
    await login(page, 'supervisor@ircub.test');
    await page.goto('/payments/reconciliation');
    await page.getByRole('button', { name: 'Reconcile' }).click();
    await expect(page.getByText(/statement lines vs \d+ IRCUB payments/)).toBeVisible({
      timeout: 30_000,
    });
  });
});

test('FMIS batches and the IRCUB vs FMIS reconciliation are visible to the supervisor', async ({
  page,
}) => {
  await login(page, 'supervisor@ircub.test');
  await page.goto('/fmis');
  await expect(page.getByRole('heading', { name: 'FMIS journal batches' })).toBeVisible();
  await page
    .getByRole('link', { name: /^#\d+$/ })
    .first()
    .click();
  await expect(page.getByRole('heading', { name: /Journal batch #\d+/ })).toBeVisible();

  await page.goto('/fmis/reconciliation');
  await expect(page.getByRole('heading', { name: 'IRCUB vs FMIS reconciliation' })).toBeVisible();
  await page
    .getByRole('link', { name: /\d{4}-\d{3}/ })
    .first()
    .click();
  await expect(page.getByText(/Payments on \d{4}-\d{2}-\d{2} for GL/)).toBeVisible();
});
