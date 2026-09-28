/**
 * k6 load test: month-end peak of 5,000 payments per minute.
 *
 *   k6 run tests/load/payments-peak.js
 *   docker run --rm -i -e BASE_URL=http://host.docker.internal:3000 \
 *     -e CHANNEL_CALLBACK_SECRET=local-demo-callback-secret grafana/k6 run - < tests/load/payments-peak.js
 *
 * Two scenarios run together:
 *   bulk_peak  - banks send batches of 50 payments; 100 batches a minute = 5,000 payments/minute
 *   callbacks  - mobile money sends single callbacks at 5 per second (300/minute) on top
 * Every request is HMAC-signed exactly like a real channel would sign it.
 *
 * Pass criteria (thresholds): < 1% failed requests, 95% of bulk requests under 2 s, 99% of checks OK.
 * Watch the worker drain the queues afterwards: payments move PENDING -> DONE within seconds.
 */
import crypto from 'k6/crypto';
import http from 'k6/http';
import { check } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const SECRET = __ENV.CHANNEL_CALLBACK_SECRET || 'local-demo-callback-secret';
const DURATION = __ENV.DURATION || '5m';
const BATCH_SIZE = 50;
const REVENUE_CODES = ['BL', 'PR', 'MF', 'VL', 'SD'];

export const options = {
  scenarios: {
    bulk_peak: {
      executor: 'constant-arrival-rate',
      exec: 'bulkPeak',
      rate: 100, // batches...
      timeUnit: '1m', // ...per minute -> 100 x 50 = 5,000 payments per minute
      duration: DURATION,
      preAllocatedVUs: 10,
      maxVUs: 50,
    },
    callbacks: {
      executor: 'constant-arrival-rate',
      exec: 'callback',
      rate: 5,
      timeUnit: '1s',
      duration: DURATION,
      preAllocatedVUs: 5,
      maxVUs: 30,
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{scenario:bulk_peak}': ['p(95)<2000'],
    'http_req_duration{scenario:callbacks}': ['p(95)<1000'],
    checks: ['rate>0.99'],
  },
};

function signedPost(path, payload) {
  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = crypto.hmac('sha256', SECRET, `${timestamp}.${body}`, 'hex');
  return http.post(`${BASE_URL}${path}`, body, {
    headers: {
      'Content-Type': 'application/json',
      'X-Timestamp': timestamp,
      'X-Signature': signature,
      'Idempotency-Key': `k6-${__VU}-${__ITER}-${Date.now()}`,
    },
    tags: { endpoint: path },
  });
}

const unique = (prefix, i) => `${prefix}-${__VU}-${__ITER}-${i}-${Date.now()}`;

export function bulkPeak() {
  const now = new Date().toISOString();
  const rows = [];
  for (let i = 0; i < BATCH_SIZE; i++) {
    rows.push({
      payer_id: 1 + Math.floor(Math.random() * 500),
      revenue_code: REVENUE_CODES[i % REVENUE_CODES.length],
      amount: Math.round(1000 + Math.random() * 50000),
      currency: Math.random() < 0.3 ? 'USD' : 'SOS',
      channel: 'BANK',
      external_ref: unique('K6B', i),
      paid_at: now,
    });
  }
  const response = signedPost('/api/payments/bulk', rows);
  check(response, {
    'bulk: status 200': (r) => r.status === 200,
    'bulk: all 50 accepted': (r) => r.status === 200 && r.json('accepted') === BATCH_SIZE,
  });
}

export function callback() {
  // Payment for an unknown control number is rejected by design; this measures the full
  // signature + idempotency + validation path at speed.
  const response = signedPost('/api/payments/callback', {
    external_ref: unique('K6C', 0),
    status: 'SUCCESS',
    amount: 10,
    currency: 'USD',
    channel: 'MOBILE_MONEY',
    paid_at: new Date().toISOString(),
    control_number: 'AS-2026-0000000-0',
  });
  check(response, { 'callback: status 200': (r) => r.status === 200 });
}
