# Part 6 · Behavioural & Soft Skills Scenarios (drafts)

First-person drafts in STAR form (Situation, Task, Action, Result). Add a real example where marked `TODO(Nasri)`.

## 1. Stakeholder management

- **Situation:** MoF and the Water Agency change requirements often.
- **Task:** stay on schedule while meeting real needs.
- **Action:** one product owner per agency and one shared backlog; every change goes through a short change request with its cost shown ("this moves X to the next sprint"); two-week sprints with a joint demo; the current sprint is protected except for emergencies; things that change often (tariffs, penalty rates, GL codes, thresholds) are configuration, not code; decisions confirmed in writing.
- **Result:** predictable releases and stakeholders who choose the trade-offs themselves.
- TODO(Nasri): a real example and its result.

## 2. Conflict resolution

- **Situation:** a colleague's poor code caused delays.
- **Task:** fix quality without hurting morale.
- **Action:** talk privately about the code, not the person, and listen first; fix it together (pairing); agree team-wide rules — definition of done, PR checklist, CI that blocks failing tests; kind, specific reviews; escalate only if it continues after support.
- **Result:** the bug is fixed, the colleague learns, and the process stops it happening again.
- TODO(Nasri): a real example and its result.

## 3. Deadline management

- **Situation:** a critical module is late, go-live in 2 weeks.
- **Task:** meet the date without lowering quality.
- **Action:** get the real remaining work in one day; agree the must-have scope with the owners and cut scope, not quality (tests, reconciliation and audit stay); put the strongest people on the critical path; test with the real partner systems early; prepare a fallback; tell sponsors the status and plan now, with daily updates.
- **Result:** on-time go-live with the essentials, or an agreed fallback — no surprises.
- TODO(Nasri): a real example and its result.

## 4. Production incident: payments not posting to FMIS on the last day of the year

- **Situation:** payments arrive but are not posted to FMIS on year-end.
- **Task:** fix it quickly, lose and double-post nothing, keep stakeholders informed.
- **Action:**
  1. Open an incident, name a lead, inform the Ministry and FMIS within 15 minutes ("payments are safe in IRCUB; posting is delayed"); update every 30 minutes.
  2. Confirm payments are still received and applied.
  3. Check FAILED batches and their error, worker logs and queues, FMIS reachability, credentials, open period and GL mappings.
  4. Fix the root cause, then retry the batches — safe, because a payment can only be posted once.
  5. Confirm with the FMIS reconciliation and the finance team.
  6. Blameless review afterwards: earlier alerts, a year-end runbook and dry run.
- **Result:** everything posted and reconciled before closing; the problem is caught earlier next time.
- TODO(Nasri): a real incident I handled.

## 5. Integrity & ethics: request to edit a payment directly in the database

- **Situation:** a senior official asks me to edit a payment record in production to clear a taxpayer's arrears, skipping the reversal process.
- **Task:** refuse, stay respectful, protect the records.
- **Action:**
  - I **refuse firmly and politely**: "I can't change payment records directly. It bypasses the approved controls and breaks financial regulations."
  - I explain it would be detected anyway: the tamper-evident audit log and the bank and FMIS reconciliations would show it.
  - I **redirect to the approved process**: a documented adjustment or reversal request with evidence, approved by a second person — and offer to help prepare it.
  - I **document** the request and my answer in writing.
  - If the pressure continues, I **escalate** to my manager and compliance / internal audit through official channels.
- **Result:** records change only through the audited four-eyes process, and the taxpayer's real issue is handled properly.

## 6. Knowledge transfer to the client's ICT team

- **Situation:** the client's ICT team will run first-line support.
- **Task:** make them independent, with a clear escalation path.
- **Action:** involve them early (demos, UAT, deployments); give them a runbook and troubleshooting guide (start with `docs/how-it-works.md`); hands-on training with injected failures (mock services' failure switch); shadowing, then reverse shadowing; a written support model with severities and escalation; their own accounts, dashboards and alerts; a hyper-care period after go-live.
- **Result:** they solve most issues themselves and escalations arrive with the right information.
- TODO(Nasri): a real handover or training example.
