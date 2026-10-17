# Staff build, Batch 2: Switchboard screens, shared tasks and routing

Status (updated 10 Oct 2026): **merged into `codex/integration-repair` (#281) and applied to the live database; not deployed to production; not click-tested as real roles.** See `docs/STAFF-BUILD-RUNBOOK-2026-10-10.md` for the current state of the whole build.
Branch: `claude/staff-build-batch2`, stacked on `claude/staff-build-batch1` (PR #279). Merge Batch 1 first.

## Inventory

| Item | Source | Merged | Applied live | Deployed | Role-tested live |
|---|---|---|---|---|---|
| `20261007100000_switchboard_operations.sql` | yes | no | no | n/a | no |
| `20261007101000_staff_intake_lookups.sql` | yes | no | no | n/a | no |
| `/staff` workspace (6 screens) and `StaffGate` | yes | no | n/a | no | no |
| Team page staff-access switch (Owner) | yes | no | n/a | no | no |
| PGlite test `tests/sql/switchboard-operations.test.mjs` | yes | no | n/a | n/a | isolated DB only |

## What was built

- **Call log with shift handover** (`/staff`): append-only call records (a correction is a new row pointing at the old one), callback outcome needs a due time, shift handover per author per shift, acknowledged once by someone else.
- **New lead** (`/staff/new-lead`): calls `staff_register_intake` (Batch 1). The channel, team, organisation and agent lists come from `staff_intake_lookups()` (names and ids only). One idempotency key per form fill. A registration-number conflict shows only that a conflict exists.
- **Document tracker** (`/staff/documents`): checklist per funding type from the existing required-document rules against received documents, and "record receipt" (type, channel, time; no file access).
- **Diary** (`/staff/diary`): tasks due or overdue, callbacks due, handovers waiting. Calendar bookings and the Founder diary are Batch 3.
- **Tasks** (`/staff/tasks`): shared tasks with routing. Switchboard may send to Coordinator or Owner; Coordinator to anyone; a founder decision is always Owner-only and only the Owner can close it. Routing needs a reason and keeps an event history.
- **Submission queue** (`/staff/queue`, Coordinator and Owner): read-only list with missing documents and Owner-review markers. The status, archive and assign RPCs exist from Batch 1; their screens are the next increment.
- **Staff routing and gate**: `roleHome` sends the two staff roles to `/staff`. `StaffGate` fails closed and shows a "waiting for activation" card until the Owner switches access on.
- **Owner switch** on the Team page: "Staff access ON/OFF", asks for a contract reference code (document code only).

## Safety rules enforced in the database

- Staff roles have no table access to anything new (Owner SELECT only); every read is a role-checked projection, capped at 100 rows.
- Free text in calls, handovers and tasks is rejected if it holds a run of 9 or more digits (ID-number and account-number shapes). Phone numbers have their own field.
- Call logs, task events and audit rows are append-only. Tasks change only through the task functions. Handovers can only be acknowledged, once.
- No commission, bank, ID, funder, signing, payroll or Path-A object is touched.

## Not in this batch (reported, not hidden)

- **Secure upload path for staff** (insert-only storage, no read, registered through an RPC): not built. It needs a Supabase Storage policy that cannot be exercised in the isolated test database, so it needs a design agreed with you and Codex before it is written. Until then the tracker records that a document arrived, not the file.
- Status, archive, assign and suspicious-document screens: RPCs exist, screens are not built. The suspicious-document flag needs receipt ids, which the checklist does not return yet.
- Duplicate and review-flag handling screens for the Owner (the Owner resolves flags through the Batch 1 RPCs for now).
- Notifications for routing and flags (not claimed anywhere; Batch 4).
- Type-specific receipts and checklists beyond the existing product baseline rules (the Schedule 2 documents are still outstanding).

## Validation so far

- `node --test tests/sql/switchboard-operations.test.mjs`: roles, call log immutability, unsafe-text rejection, routing rules, founder-decision rule, handover rules, checklist projection, lookups, no direct table reads. All repository tests, `tsc -b`, `oxlint` and the repository contract check pass.
- **Not proven:** behaviour on the live schema, real sessions, the screens in a browser, mobile layout, concurrency.

## Live smoke test (after migrations 90000 to 101000 are applied by the single integrator)

1. As Owner on the Team page: switch a Switchboard user on. Before that, sign in as them: expect the waiting card.
2. As Switchboard: log a call, write a handover, register a lead, record a receipt, create a task for Coordinator. Try to type an ID-length number: expect refusal.
3. As Coordinator: acknowledge the handover, send a task to the desk, open the queue.
4. As Switchboard: try to close a founder decision and open `/staff/queue`: expect refusal or redirect.
5. As a partner: open `/staff`: expect redirect. Call `staff_call_log_list` through the API: expect permission error.

## Rollback

Switch staff off (`owner_set_staff_access(<id>, false)` or the Team page switch). Revoke execute on the `staff_*` functions to stop the workspace quickly. Never drop tables or edit applied migrations; ship a forward migration. Removing synthetic test data needs a service-role session that disables the append-only triggers deliberately for that one cleanup.
