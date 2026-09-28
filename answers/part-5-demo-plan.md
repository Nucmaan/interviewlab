# Part 5 · Demonstration of a Previously Developed Application — plan (template)

> This part is about **my own past system**, not the IRCUB POC. Everything below is a structure to fill in.
> Every `TODO(Nasri)` needs a real fact from my experience. Use anonymised / test data only; no client names, credentials or real personal data.

**Format:** 30 minutes demonstration + 15 minutes questions. Live demo on a demo/staging/local environment (preferred); fallback: recorded walkthrough + screenshots + code walkthrough.

## Timing plan (30 minutes)

| Min   | Section                                        | Scoring criterion it serves (weight)                        |
| ----- | ---------------------------------------------- | ----------------------------------------------------------- |
| 0–3   | 1. Context & problem, my role                  | Clarity of problem, context and personal contribution (10%) |
| 3–7   | 2. Solution architecture & technology choices  | Architecture and justification of technology choices (15%)  |
| 7–15  | 3. Live walkthrough of core journeys           | Working functionality and end-to-end user journeys (20%)    |
| 15–19 | 4. Data model · 5. Integrations                | Data model, integrations and error handling (15%)           |
| 19–23 | 6. Security · 7. Code walkthrough · 8. Testing | Security, testing and code quality (15%)                    |
| 23–26 | 9. Deployment & operations · 10. Performance   | Deployment, operations, performance and support (10%)       |
| 26–29 | 11. Reporting · 12. Outcomes & lessons         | Outcomes, lessons learned and communication (10%)           |
| 29–30 | Summary and hand-over to questions             | Response to panel questions (5%)                            |

## Pre-demo checklist

- [ ] TODO(Nasri): environment to use (demo / staging / local Docker) and a backup (recording + screenshots).
- [ ] TODO(Nasri): anonymised demo data loaded; no real names, IDs, phone numbers or amounts.
- [ ] TODO(Nasri): two demo accounts with different roles, passwords tested the day before.
- [ ] TODO(Nasri): architecture diagram and ERD exported as images (in case screen sharing of tools fails).
- [ ] TODO(Nasri): code open in the editor at the files for section 7; font size large.
- [ ] Browser notifications off, other windows closed, second screen for notes.

## 1. Context & problem statement (3 min)

- **Business problem:** TODO(Nasri): what the system solves, for whom, what was painful before.
- **Users:** TODO(Nasri): user types and roles.
- **Scale:** TODO(Nasri): number of users, transactions per day/month, data volume, peak load.
- **My role:** TODO(Nasri): title, dates, team size and composition.
- **What I personally designed and built:** TODO(Nasri): specific modules / services / decisions that were mine (be precise — the panel verifies personal contribution).

## 2. Solution architecture (4 min)

- **Diagram:** TODO(Nasri): frontend, backend, database, integrations, hosting (show one clear diagram).
- **Technology stack:** TODO(Nasri): language(s), frameworks, database, queue/cache, hosting.
- **Why these choices + trade-offs:** TODO(Nasri): for each major choice, one reason and one trade-off (e.g. "chose X for Y; the cost was Z; today I would …").

## 3. Live walkthrough of core user journeys (8 min)

- **Login and role-based access for at least two user types:** TODO(Nasri): user A (what they can see/do) vs user B (what is hidden / refused).
- **One complete end-to-end business process:** TODO(Nasri): e.g. registration → transaction → report; list the exact clicks.
- **Validation and error handling:** TODO(Nasri): show a wrong input, the error message, and how the system prevents bad data (client and server).

## 4. Data model & database design (2 min)

- **ERD:** TODO(Nasri): key entities and relationships.
- **Indexing:** TODO(Nasri): the most important indexes and the query they speed up.
- **Data integrity:** TODO(Nasri): constraints (unique, foreign keys, checks), transactions, how duplicates are prevented.

## 5. Integrations (2 min)

- **At least one external integration:** TODO(Nasri): API / payment gateway / SMS / ERP / identity provider.
- **Failures, retries, timeouts, duplicate messages:** TODO(Nasri): how each is handled (timeouts values, retry policy, idempotency keys, dead-letter/manual review).

## 6. Security implementation (1.5 min)

- **Authentication and authorisation:** TODO(Nasri).
- **Data protection (in transit / at rest / masking):** TODO(Nasri).
- **Secret management:** TODO(Nasri).
- **Audit logging:** TODO(Nasri).

## 7. Code walkthrough (1.5 min)

- **Module I wrote:** TODO(Nasri): folder structure, design patterns, error handling and logging.
- **Code I am most proud of, and why:** TODO(Nasri).
- **Code I would refactor today, and how:** TODO(Nasri).

## 8. Testing & quality (1 min)

- **Automated tests:** TODO(Nasri): unit / integration / end-to-end, tools, rough coverage.
- **Code review process:** TODO(Nasri).
- **CI/CD pipeline:** TODO(Nasri): stages from commit to production.

## 9. Deployment, operations & support (2 min)

- **Deployment:** TODO(Nasri): how it is deployed (containers, servers, cloud), environments.
- **Monitoring, logging, alerting, backups:** TODO(Nasri).
- **A real production incident I handled:** TODO(Nasri): what happened → root cause → fix → prevention (STAR format, with numbers if possible).

## 10. Performance & scalability (1 min)

- **Volumes:** TODO(Nasri).
- **Bottlenecks encountered and optimisations applied:** TODO(Nasri): before/after numbers.

## 11. Reporting & analytics (1 min)

- **Key reports / dashboards:** TODO(Nasri).
- **Decisions they support:** TODO(Nasri).

## 12. Outcomes & lessons learned (2 min)

- **Measurable results:** TODO(Nasri): time saved, revenue increase, error reduction, adoption (with numbers).
- **Key challenges:** TODO(Nasri).
- **What I learned / what I would do differently:** TODO(Nasri).

## Likely panel questions — prepare short answers

| Question                                                          | My answer (notes) |
| ----------------------------------------------------------------- | ----------------- |
| Which part exactly did you build yourself?                        | TODO(Nasri)       |
| Why that database / framework and not an alternative?             | TODO(Nasri)       |
| How do you prevent a payment / transaction being processed twice? | TODO(Nasri)       |
| What happens if the external API is down for an hour?             | TODO(Nasri)       |
| How do you know the system is healthy in production?              | TODO(Nasri)       |
| What was the hardest bug and how did you find it?                 | TODO(Nasri)       |
| How would you scale it 10×?                                       | TODO(Nasri)       |
| What would you change if you started again?                       | TODO(Nasri)       |
