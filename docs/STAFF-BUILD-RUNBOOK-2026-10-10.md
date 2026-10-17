# Staff build runbook and hand-back (10 October 2026)

Covers the Switchboard Assistant and Sales Coordinator build in `maupatrades-cmd/Fund-Now-Capital-2026`.
No personal IDs, salaries, signatures or client data are in this document. No message has been delivered to anyone by the staff build.

## 1. What is live in the database

All migrations below were applied through the migration tool, in this order, each with its own ledger row. Nothing was applied by raw SQL except `staff_access_and_audit` (earlier, verified; its repo file differs only by omitted `drop … if exists` lines).

| Area | Migration files | PR |
|---|---|---|
| Roles, access, audit, organisations/teams, secure intake | `20261007090000` to `20261007094000` | #279 (merged) |
| Owner-only manual commission editor | `20261007095000` | #279 (merged) |
| Switchboard operations, intake lookups | `20261007100000`, `20261007101000` | #281 (merged) |
| Delegated calendars, check-in cron | `20261007102000`, `20261007103000` | #282 (merged) |
| Review fixes | `20261007110000` | #282 (merged) |
| SC1 required document lists (45 drafts, inactive) | `20261007180000` | #283 draft |
| SC2 funder-side stage (Owner only) and approved status wording | `20261007190000` | #284 draft |
| SC3 Deal Summary and Founder decisions | `20261007200000` | #285 draft |
| SC4 Founder open slots and time requests | `20261007210000`, `20261007211000` | #286 draft |
| SC5 Coordinator landing | `20261007220000` | #287 draft |
| SC7 answer-desk timers | `20261007230000`, `20261007231000` | #288 draft |
| Day 3 / day 7 document chasers | `20261007240000` | #289 draft |
| Queue actions (assignable staff list) | `20261007250000` | #290 draft |

Scheduled jobs: `staff-checkin-reminders` (weekdays 04:30 UTC) and `staff-document-chasers` (weekdays 04:40 UTC). Both create in-app items only.
Edge function: `admin-invite-user` v3 (accepts the two staff roles).

## 2. Merge order

The PRs are a stack. Merge bottom-up: #283, #284, #285, #286, #287, #288, #289, #290, then this runbook PR. Each is based on the one before it. None is on `main`; the staff screens reach production only when #280 (Codex integration into `main`) merges, which needs the Owner's say-so.

## 3. Live state

0 staff enabled, 0 intakes, 0 teams, 0 calendar grants, 0 manual commission entries, 0 active document rules (45 drafts), 0 holidays, no confirmation sender.

## 4. Setting up, in order (Owner)

1. Confirm the document lists at `/settings/document-rules` (activates a product's list). Until then no file can be marked Complete.
2. Enter public holidays (`owner_set_business_holiday`). Working-hours timers and chasers skip them only once entered.
3. Invite the Coordinator and Switchboard Assistant, then switch each on at the Team page (`owner_set_staff_access`).
4. Create teams and calendar grants at `/calendar/access`. Open Founder slots; the Coordinator can book only into those (default slot types: urgent, submission, submission_update, consultation).
5. Choose the booking-confirmation sender address. Until then confirmations are queued only.

## 5. What each role can do

- **Switchboard:** four screens (call log, new lead, document tracker, diary) and tasks. No queue, no Home, no Answer desk.
- **Coordinator:** everything above plus Home, Submission queue (Manage file, Send to Founder), Answer desk, Founder time requests. Sees the Founder's decision, category and question only. Never sees funder identity or stage, commission, bank or ID data.
- **Owner (Founder):** decides Founder tasks (approve, send back with question, decline with category, call me), sets funder stage, decides time requests, reverses archives, clears document flags, enters commission by hand.

## 6. Commission rule (Owner, 7 October)

The engine calculates an estimate only, using the locked rules. The Owner enters the payable commission when the deal is finalised, because sometimes the client pays the fee, not the funder. Agents see only their own estimates; staff see no commission figures. The staff build does not touch the commission engine. Codex's guards (conflict register in `docs/STAFF-BUILD-OWNER-COMMISSION-EDITOR-2026-10-07.md`) are not done.

## 7. How the live checks were run

Each slice was checked with a rolled-back test: a `do` block that sets `request.jwt.claims` to a real profile id, uses `set local role authenticated`, exercises the functions, then ends with `raise exception` so nothing is kept. Role cases used the Owner profile and a contractor profile temporarily switched to the coordinator role inside the same rolled-back transaction. Zero test rows remain. Not done anywhere: browser click-through as each real role, two-session race tests, mobile layout, real message delivery.

## 8. Not built, and why

| Item | Waiting on |
|---|---|
| SC10 deal assignment, agent "My files" wording | Owner: does an agent earn commission on a deal that arrived with no agent, and at what rate |
| SC6 status message templates beyond the SC2 wording | Owner: confirm the "withdrawn" wording; sender address |
| SC8 Monday pipeline emails, confirmation sending, any delivery | Owner: sender address, WhatsApp/email setup |
| SC9 KPIs and R35 tracker | Owner: Qualifying File rule and KPI targets |
| Secure staff upload path | Storage design to agree with Codex |
| Commission-engine guards | Codex |
| Reports and fraud red-flag alerts | Report format and recipients (Owner) |
| Column-restricted intake view for partners, agents and Team Leaders | Owner decision |
| Reschedule/cancel notice sequencing, slots reopening on cancel, diary handover count, deal checklist ignoring client-level documents | Open review findings, not yet applied |

## 9. Hand-back

Claude owns the staff roles, workspaces, delegated bookings and reminders. Codex owns signing, Path-A commission, reward payroll, CI and deployment reconciliation. Any change to a shared file is agreed before either side edits it. Never delete or rewrite a migration already applied live; use forward migrations only.
