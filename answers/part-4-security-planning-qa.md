# Part 4 · Project Planning, Security & Quality Assurance

## 4.1 Security & compliance

**1. Authentication, authorisation, sessions, channel API authentication**

- Login with argon2id-hashed passwords, 12+ character policy, lockout after 5 failures (15 min), optional TOTP 2FA (mandatory for privileged roles in production).
- Session: signed HttpOnly cookie (8 h); roles and permissions are re-read from the database on every request, so deactivation is immediate.
- RBAC stored in the database with role hierarchy; one guard checks every page, action and API route (`lib/rbac.ts`); four-eyes reversals enforced in code and by a DB `CHECK`.
- Channels: HMAC-SHA256 signature + timestamp, no sessions. Production: one secret per channel, rotation, mTLS or IP allow-list.

**2. Data protection at rest and in transit**

- HTTPS/TLS everywhere, HSTS; TLS to the database; private network for internal traffic.
- Encrypted disks and backups; column encryption for national IDs and TOTP secrets.
- Masking in lists and exports; logs redact passwords, hashes, secrets and cookies; test data only outside production.

**3. Secrets and API keys across environments**

- `.env` never committed (only `.env.example` placeholders); config validated at startup.
- Different secrets per environment; production secrets in a vault (Vault / cloud key vault), injected at runtime, rotated every 90 days; secret scanning in CI.

**4. Rate limiting, idempotency, replayed or forged callbacks**

- Rate limit per IP in Redis (429 + `Retry-After`).
- Forged → HMAC over the raw body, constant-time compare. Replayed → rejected after 5 minutes.
- Duplicates → `Idempotency-Key` returns the stored response, and `UNIQUE (external_ref)` blocks a second payment anyway.

**5. OWASP Top 10**

- Access control on the server for every request; parameterised queries (Prisma / tagged SQL); Zod validation of all input; React escaping (no raw HTML); CSRF protection (Auth.js, Origin check, SameSite cookies); security headers; non-root containers; dependency audit in CI; no user-supplied URLs fetched (no SSRF).

**6. Audit trail integrity**

- Audit row written in the same transaction as the change, with before/after JSON.
- **Prevent:** append-only table (trigger blocks UPDATE/DELETE/TRUNCATE); app user has INSERT/SELECT only.
- **Detect:** hash chain `SHA256(prev_hash + row)`; _Verify chain_ finds the first changed row (`pnpm --filter @ircub/db tamper-demo` shows it).
- Plus daily reconciliation with bank statements and FMIS.

## 4.2 Project timeline (POC, working alone)

| Phase                                                  | Tasks                                                                                                 | Estimated effort                |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- | ------------------------------- |
| 1. Requirements & Design                               | Brief analysis, assumptions, ERD, architecture, API contract, security design                         | 14 h                            |
| 2. Environment & Backend Setup                         | Monorepo, Docker Compose, schema, migrations, SQL, seed data, logging, CI                             | 22 h                            |
| 3. Core Modules (Users, Registry, Assessment, Billing) | Auth, RBAC, registry, assessments, CSV upload, audit, readings, tariff, billing cycle, PDF, penalties | 58 h                            |
| 4. Integrations (Payment Channels, SMS, FMIS)          | Callback/bulk APIs, worker pipeline, mock services, retries, reconciliations, FMIS posting            | 38 h                            |
| 5. UI & API Integration, Dashboard                     | Capture form, portal, screens, dashboard, forecast, alerts, live updates, Swagger                     | 26 h                            |
| 6. Testing & QA                                        | Unit, integration, E2E, API and load tests, fixes                                                     | 24 h                            |
| 7. Documentation, Deployment & Packaging               | README, answers, guides, Postman, Dockerfiles, fresh-install check                                    | 16 h                            |
| **Total estimated time**                               |                                                                                                       | **198 hours ≈ 25 working days** |

**5-day note:** 198 h is about five weeks for one person. It fits the window only because scope was kept to the brief and an AI coding assistant was used (declared in the README); production hardening is listed as known limitations.

## 4.3 QA & testing strategy

| Level       | Tools                          | What                                                                                                                        | Run                                  |
| ----------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Unit        | Vitest                         | All business rules in `packages/core` (158 tests)                                                                           | `pnpm test`                          |
| Integration | Vitest + real PostgreSQL/Redis | Penalty SQL = TypeScript and idempotent; exactly-once payments under concurrency; FMIS retries/FAILED; cache; billing cycle | `pnpm test:integration`              |
| E2E         | Playwright (desktop + tablet)  | All roles, capture form, SoD, CSV, billing, portal payment, reconciliations, dashboard, API contract                        | `pnpm test:e2e`                      |
| Load        | k6                             | 5,000 payments/min + 5 callbacks/s; result: 0% errors, p95 281 ms                                                           | `k6 run tests/load/payments-peak.js` |

**Manual test cases**

| #   | Test                                              | Expected result                                                     |
| --- | ------------------------------------------------- | ------------------------------------------------------------------- |
| 1   | 5 wrong passwords                                 | Account locked 15 min; 5 audit rows                                 |
| 2   | Enable 2FA and sign in again                      | 6-digit code required                                               |
| 3   | Sign in as each role                              | Only that role's menu; others get "no access"                       |
| 4   | Capture USD + SOS lines on a tablet               | Receipt, USD converted, statuses turn DONE live                     |
| 5   | Reuse an external reference                       | Rejected: duplicate reference                                       |
| 6   | Bulk file with bad rows, sent twice with same key | Reason per row; second call replays the same response               |
| 7   | Callback with wrong signature / old timestamp     | 401, nothing stored                                                 |
| 8   | Supervisor approves own reversal                  | Blocked; a second supervisor can approve                            |
| 9   | Lower meter reading without / with rollover flag  | Rejected / accepted with correct consumption                        |
| 10  | Run billing cycle                                 | Estimated and HELD bills in the exception report; release sends SMS |
| 11  | Open a bill PDF                                   | Tiered charges, arrears, QR code                                    |
| 12  | FMIS down, then retry                             | FAILED after 3 attempts + alert; retry → POSTED                     |
| 13  | Tamper with an audit row, verify chain            | Tampered row reported                                               |

**Failure scenarios** — simulated with the mock services' failure switch (`POST /admin/config`) and fake servers in tests:

| Failure            | Expected behaviour                                         |
| ------------------ | ---------------------------------------------------------- |
| Network timeout    | Request aborted, retried with backoff, no partial data     |
| Duplicate callback | Stored response replayed / rejected by unique reference    |
| Declined payment   | Payment FAILED or stored in `rejected_payment`             |
| Channel downtime   | Status check retried 3×, then FAILED + supervisor notified |
| FMIS unavailable   | 3 attempts, then FAILED + alert; manual retry              |

**Tools:** mock services (WireMock equivalent), fake HTTP servers in tests, Postman collection, Swagger UI, deterministic seed data, 1M-row generator.

**CI/CD:** pull request → CI (`.github/workflows/ci.yml`: lint, typecheck, unit, integration, E2E) → code review (1–2 approvals) → merge → build versioned image and scan → staging + UAT → approved release to production with health checks and rollback. The same image moves between environments; only config differs.

## 4.4 Bonus: QR code on water bills

Each PDF bill has a scan-to-pay QR code (`IRCUB|WB-…|SOS|amount|account`), so payers and tellers never retype the control number. Code: `apps/web/src/modules/water/services/bill-pdf.ts`. **Extra time: about 4 hours.**
