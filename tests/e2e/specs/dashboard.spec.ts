import { expect, test } from '@playwright/test';
import { login } from './helpers';

test('the executive dashboard shows charts, forecast and updates live after new payments', async ({
  page,
}) => {
  await login(page, 'supervisor@ircub.test');
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Executive dashboard' })).toBeVisible();
  // One Recharts wrapper per chart: trends by type and channel, targets, water, forecast.
  await expect(page.locator('.recharts-wrapper')).toHaveCount(5, { timeout: 20_000 });
  await expect(page.getByText(/Forecast for the next 3 months/)).toBeVisible();
  await expect(page.getByRole('heading', { name: /Top 10 water arrears/ })).toBeVisible();

  const collected = page.locator('text=Collected today').locator('..').locator('..');
  const before = await collected.innerText();
  await page.getByRole('button', { name: /Demo: simulate 20 mobile money payments/ }).click();
  // Callbacks -> worker -> daily_summary refresh -> SSE -> page refresh, with no manual reload.
  await expect.poll(async () => collected.innerText(), { timeout: 60_000 }).not.toBe(before);
});

test('Swagger UI renders the OpenAPI definition', async ({ page }) => {
  await page.goto('/api-docs');
  await expect(page.getByText('IRCUB API')).toBeVisible();
  await expect(page.getByText('/api/payments/callback').first()).toBeVisible();
});
