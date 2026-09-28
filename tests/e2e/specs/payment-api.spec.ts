import { createHmac, randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { login, uniqueRef } from './helpers';

/** Contract tests of the channel APIs: signature, replay window, idempotency and validation. */
const SECRET = process.env.CHANNEL_CALLBACK_SECRET ?? 'local-demo-callback-secret';

function signedHeaders(body: string, key: string, timestamp = Math.floor(Date.now() / 1000)) {
  const ts = String(timestamp);
  return {
    'Content-Type': 'application/json',
    'X-Timestamp': ts,
    'X-Signature': createHmac('sha256', SECRET).update(`${ts}.${body}`).digest('hex'),
    'Idempotency-Key': key,
  };
}

const post = (
  request: APIRequestContext,
  path: string,
  body: string,
  headers: Record<string, string>,
) => request.post(path, { data: body, headers });

const bulkBody = () =>
  JSON.stringify([
    {
      payer_id: 1,
      revenue_code: 'SD',
      amount: 1000,
      currency: 'SOS',
      channel: 'BANK',
      external_ref: uniqueRef('API-OK'),
      paid_at: new Date().toISOString(),
    },
    {
      payer_id: 1,
      revenue_code: 'SD',
      amount: -1,
      currency: 'SOS',
      channel: 'BANK',
      external_ref: uniqueRef('API-BAD'),
      paid_at: new Date().toISOString(),
    },
  ]);

test('a request with a wrong signature is rejected', async ({ request }) => {
  const body = bulkBody();
  const headers = { ...signedHeaders(body, randomUUID()), 'X-Signature': 'ab'.repeat(32) };
  const response = await post(request, '/api/payments/bulk', body, headers);
  expect(response.status()).toBe(401);
  expect(await response.json()).toMatchObject({ reason: 'BAD_SIGNATURE' });
});

test('a correctly signed request older than 5 minutes is rejected (replay protection)', async ({
  request,
}) => {
  const body = bulkBody();
  const response = await post(
    request,
    '/api/payments/bulk',
    body,
    signedHeaders(body, randomUUID(), Math.floor(Date.now() / 1000) - 600),
  );
  expect(response.status()).toBe(401);
  expect(await response.json()).toMatchObject({ reason: 'EXPIRED' });
});

test('the Idempotency-Key header is required', async ({ request }) => {
  const body = bulkBody();
  const headers: Record<string, string> = signedHeaders(body, 'x');
  delete headers['Idempotency-Key'];
  expect((await post(request, '/api/payments/bulk', body, headers)).status()).toBe(400);
});

test('bulk upload validates each row and a repeated key returns the original response', async ({
  request,
}) => {
  const body = bulkBody();
  const key = randomUUID();
  const first = await post(request, '/api/payments/bulk', body, signedHeaders(body, key));
  expect(first.status()).toBe(200);
  const summary = await first.json();
  expect(summary).toMatchObject({ received: 2, accepted: 1, rejected: 1, errors: [{ row: 2 }] });

  const replay = await post(request, '/api/payments/bulk', body, signedHeaders(body, key));
  expect(replay.headers()['idempotent-replayed']).toBe('true');
  expect(await replay.json()).toEqual(summary);

  const conflict = await post(
    request,
    '/api/payments/bulk',
    bulkBody(),
    signedHeaders(bulkBody(), key),
  );
  expect(conflict.status()).toBe(422);
});

test('a callback paying a control number is accepted once; the duplicate is reported', async ({
  page,
  request,
}) => {
  // Create a fresh assessment so the test does not depend on seeded data still being unpaid.
  await login(page, 'officer@ircub.test');
  await page.goto('/revenue/assessments');
  await page.locator('#new-tin').fill('2001000004');
  await page.locator('#new-revenueCode').selectOption('SD');
  await page.locator('#new-amountDue').fill('50000');
  await page.locator('#new-dueDate').fill('2026-12-31');
  await page.getByRole('button', { name: 'Create assessment' }).click();
  const message = await page.getByText(/Assessment created with control number/).innerText();
  const controlNumber = /AS-\d{4}-\d{7}-\d/.exec(message)![0];

  const body = JSON.stringify({
    external_ref: uniqueRef('API-CB'),
    status: 'SUCCESS',
    amount: 10,
    currency: 'USD',
    channel: 'MOBILE_MONEY',
    paid_at: new Date().toISOString(),
    control_number: controlNumber,
  });
  const accepted = await post(
    request,
    '/api/payments/callback',
    body,
    signedHeaders(body, randomUUID()),
  );
  expect(await accepted.json()).toMatchObject({ received: 1, accepted: 1, rejected: 0 });

  // The channel retries with a NEW key: the unique external_ref still stops double processing.
  const duplicate = await post(
    request,
    '/api/payments/callback',
    body,
    signedHeaders(body, randomUUID()),
  );
  const result = await duplicate.json();
  expect(result).toMatchObject({ accepted: 0, rejected: 1 });
  expect(result.errors[0].reason).toMatch(/Duplicate/);
});
