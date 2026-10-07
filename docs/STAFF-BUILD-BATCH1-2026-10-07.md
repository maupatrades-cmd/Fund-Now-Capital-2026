# Staff build, Batch 1: roles, organisations, secure intake

Status: **source only. Not merged, not applied to the live database, not deployed, not role-tested live.**
Branch: `claude/staff-build-batch1`, started from `ba57f5670b9af92cd82fad6f5a476a20f4f6afda` (`codex/integration-repair`).
Owner handover: FNC STAFF BUILD v2, 6 October 2026, with the Owner commission clarification.

## Inventory (source / merged / applied / deployed / role-tested)

| Item | Source | Merged | Applied live | Deployed | Role-tested live |
|---|---|---|---|---|---|
| 5 staff-build migrations below | yes | no | no | n/a | no |
| `admin-invite-user` accepts staff roles | yes | no | n/a | no (Edge Function must be redeployed) | no |
| Role types / labels in the app | yes | no | n/a | no | no |
| PGlite role tests (`tests/sql/staff-intake.test.mjs`) | yes | no | n/a | n/a | isolated DB only |

## Migrations (forward-only, unique timestamps, applied in this order by the single integrator)

1. `20261007090000_staff_roles_enum.sql`: adds `switchboard` and `coordinator` to `user_role`. Its own migration because a new enum value cannot be used in the transaction that adds it.
2. `20261007091000_staff_access_and_audit.sql`: `staff_access` (the Owner switches each person on after checking their signed contract; stores a contract reference code only), append-only `staff_audit_events`, `staff_actor_role()`, profile role/is_active guard, role change auto-disables staff access.
3. `20261007092000_organisation_team_structure.sql`: organisations stay `referral_partners` rows (Bright Destiny is just one), new `referral_teams` and `referral_team_memberships` with effective dates, validated branding config, Owner RPCs to create organisations, teams and memberships.
4. `20261007093000_submission_intake_core.sql`: `submission_intakes`, `submission_introducing_parties`, `intake_review_flags`, `intake_document_receipts`, `intake_document_flag_events`, guards and RLS.
5. `20261007094000_submission_intake_rpcs.sql`: the only doors into those tables, plus the safe staff projections.

Ledger notes for the integrator: none of these files touch signing, payroll, Path-A or commission objects, and none rewrite an existing migration. The only existing objects touched are `profiles` (two triggers added), `referral_partners` (one column and one CHECK added; the table is small) and `deals` (one AFTER trigger that links an intake to its deal when `qualify_lead` creates one, so `qualify_lead` itself is unchanged). Per Codex's notes, do not blind-push; apply only these five files after the signing/Path-A/payroll reconciliation is settled. Verify after applying with `scripts/ops/staff-deny-audit.sql`.

## Permissions matrix (enforced in the database)

| Action | Owner | Coordinator | Switchboard | Agent / Team Leader / Partner |
|---|---|---|---|---|
| Enable or disable staff access | yes | no | no | no |
| Create organisation / team / membership | yes | no | no | no |
| Register an enquiry (`staff_register_intake`) | yes | yes | yes | no |
| Status: New, Documents incomplete, Complete, With Founder | any | forward path + audited corrections | no | no |
| Verified, reversal of Complete after Owner action | yes | no | no | no |
| Archive withdrawn / duplicate / lapsed (reason mandatory) | yes | yes (not Verified, not once the deal is with funders) | no | no |
| Reverse an archive | yes | no | no | no |
| Assign operational assignee | yes | yes | no | no |
| Add introducing party | yes | yes | yes | no |
| Remove introducing party (reason) | yes | yes | no | no |
| Record document receipt (metadata only) | yes | yes | yes | no |
| Flag a document suspicious | yes | yes | yes | no |
| Clear a suspicious flag | yes | no | no | no |
| Resolve a duplicate / registration-conflict flag | yes | no | no | no |
| Correct attribution (history kept) | yes | no | no | no |
| Read queue / detail (safe projection, max 100 rows) | yes | yes | yes | no |
| Read own intake rows directly | yes | no | no | own files, own team (leader), own organisation (partner) |
| Deal stages, funder identity, commission, bank, ID contents, stored documents | per existing rules | none | none | per existing rules |

Staff have no table policy on any existing sensitive table, no storage policy, and no read path to a stored document. Receipts return `receipt_id`, `document_type`, `received_at` only.

## Decisions taken as safe defaults (change on request)

- A person is in at most one team at a time, and a team has one Team Leader at a time. Memberships can only be ended, never edited or deleted.
- A team member's organisation must equal the team's organisation, so cross-organisation membership is impossible.
- A "direct agent" is an independent lead-referrer with no organisation.
- Staff intake does **not** set `leads.referral_partner_id` or any `attributed_to_*` column. The caller's claim is recorded as unverified, and nothing downstream (badges, progression, commission) can fire from it. The Owner confirms attribution later.
- A registration conflict (same CIPC as an existing lead or client) creates no second file. It raises an Owner review flag, and the caller only learns that a conflict exists. Recent same-name submissions (6 months) and shared contact details create the file plus a review flag.
- Complete is gated on the existing `document_requirement_rules` (product baseline, required) being satisfied by **received** documents. With no rules configured for a funding type, Complete is refused rather than guessed. The fuller versioned Schedule 2 checklist and its applicability rules arrive with the Document Tracker in Batch 2.
- The first Complete timestamp is set by the database once and never moves. Reversal is its own event type, and re-completing keeps the original timestamp.
- Staff invited through the existing invite function get no authority until the Owner enables them.

## Not in Batch 1 (and why)

- Storage upload path for staff: no staff storage policy exists yet. The secure-upload design (insert-only, no read, registered through an RPC) ships with the Document Tracker in Batch 2.
- Owner staff-access toggle in the Team page: Batch 2 (until then the Owner calls `owner_set_staff_access` from the SQL editor).
- Notifications for flags and routing: Batch 2 (routing) and Batch 4 (red-flag alerts). Nothing here claims an alert was delivered.
- Owner-only commission editor: separate design and conflict register, `docs/STAFF-BUILD-OWNER-COMMISSION-EDITOR-2026-10-07.md`.

## Validation so far

- `node --test tests/sql/staff-intake.test.mjs`: passes against an isolated PostgreSQL (PGlite) with a synthetic prerequisite schema. Covers staff access gate, no self-escalation (RLS and trigger), second organisation, cross-organisation denial, team and leader rules, idempotent registration, conflict flag, complete gate, forbidden transitions, protected first-Complete timestamp, archive and reversal, assignment not changing attribution, append-only audit, and "no storage policy added".
- Full repository tests, typecheck, lint and repository contract check still pass.
- **Not proven:** behaviour against the live schema, real Supabase Auth sessions, storage policies, concurrent sessions, the redeployed Edge Function. Those belong to the live smoke test after the integrator applies the migrations.

## Batch 1 live smoke test (run by the Owner after the integrator applies the migrations)

1. As Owner: create a second organisation, a team and a Team Leader through the RPCs. Expect success; adding a profile from the other organisation to the team is refused.
2. As the second organisation's partner: open another organisation's intake or team. Expect no rows.
3. As Coordinator and Switchboard (enabled): try to read `deals`, `commission_records`, `documents`, a storage object by guessed path. Expect denial or zero rows.
4. As Switchboard: try to change a status, archive, assign. Expect refusal. As Coordinator: try Verified. Expect refusal.
5. As either staff user: update own role through the API. Expect refusal.
6. Run `scripts/ops/staff-deny-audit.sql` and review any rows it returns.

## Rollback and recovery (never delete audit or applied history)

- Switch staff off without removing anything: `owner_set_staff_access(<profile>, false)`, or set the profile inactive. All staff authority depends on that row.
- To stop the intake workflow quickly: revoke execute on the `staff_*` RPCs from `authenticated`. Data and audit stay.
- Do not drop the new tables or edit the migrations once applied. If a defect is found, ship a forward migration that replaces the function body (`create or replace function`).
- The enum values added in migration 1 cannot be removed in PostgreSQL and are harmless while no staff profile exists.
