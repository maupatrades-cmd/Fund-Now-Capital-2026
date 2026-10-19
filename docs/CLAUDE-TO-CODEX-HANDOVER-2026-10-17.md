# Claude → Codex: staff build status, planned batches, money flow and R100 (17 October 2026)

Purpose: so we do not build over each other. Ownership stays as agreed: Claude owns Switchboard, Sales Coordinator,
the new Administrator role, staff migrations, the required-documents catalogue, intake workflows and staff calendars.
Codex owns signing, Path-A commission, R100 payroll, commission payment routes, CI and deployment. Nothing below
changes `calculate_commission`, `commission_records`, the R100 lock or payroll tables, or any payment route.

## 1. Merged to main and applied live (17 Oct)

| PR | What | Shared objects touched (please note) |
|---|---|---|
| #297 | Staff screens SC1–SC9, queue actions, document chasers, catalogue | Staff-only objects. Live migrations already existed |
| #298 | Six review fixes + **required-documents catalogue cut-over** | **`funding_product_catalog`: 17 new rows (24 funding types in total) + `doc_list_code` column.** **`client_form_responses`: the hard-coded 7-product CHECK is replaced by an FK to the catalogue** (client lane: new products have no client-side document rules yet). `intake_required_docs_missing` (the staff Complete gate) now reads the confirmed catalogue lists. `staff_document_checklist` has a new return shape (old one renamed `_retired_v1`). `intake_document_receipts` has a new `doc_code` column, and `document_type` is now nullable. New append-only `intake_doc_list_pins` table |
| — | `staff_review_fixes_2`, `staff_checklist_receipt_alignment`, `calendar_notice_revision_guard` | Staff functions only |

**Not applied live:** `20261010050432_external_intake_safe_projection.sql` (the Supabase tool hangs on DROP POLICY;
the owner will run it). Your R100 migrations remain unapplied as you asked.

**Tooling note:** the Supabase MCP tool silently hangs on `DROP FUNCTION` and `DROP POLICY` (it waits for a confirmation
that never arrives). `DROP CONSTRAINT` works. I retire functions by `ALTER FUNCTION … RENAME` instead.

## 2. In review: PR #301, Administrator batch 1 (not merged, not applied)

- New `user_role` value **`administrator`** and notification event **`DIARY_BOOKING_CHANGED`** (separate enum migration).
- `staff_role_of`, `staff_access` and `owner_set_staff_access` accept the Administrator.
- **`intake_require_actor`: an Administrator passes any check that admits `'coordinator'` and gets `'coordinator'` back.**
  If any of your functions call `intake_require_actor` or compare staff roles, the Administrator will look like a
  Coordinator there. `staff_actor_role()` still returns `'administrator'`.
- `calendar_has_permission` gives the Administrator all four rights on the **Founder's** calendar (role `owner`) without grants.
- **Booking windows on the Founder's diary** replace the SC4 open-slot rule for staff RPCs only:

  | Who | Window |
  |---|---|
  | Administrator / Coordinator | 08:30–14:00 (consultations and presentations 14:00–17:00) |
  | Switchboard | 08:00–17:00 |
  | Others | 14:00–17:00 |
  | Founder | any time |

  Important and after-hours (to 19:00) requests need approval by the Administrator or the Founder.
- Trigger on `owner_calendar_events` sends in-app notices to the Founder with the Administrator CC'd (it writes
  `notifications` + `notification_deliveries` directly; no email). **It fires for every insert or update of
  starts_at, ends_at or status on the Founder's calendar, including your public-booking and owner paths.**
- New append-only `calendar_meeting_notes`.

**Request to Codex:** the public booking pages (clients, agents, partners, Team Leaders) should enforce the owner's
14:00–17:00 window. That is your booking flow (`owner_calendar_bookings`, `booking_standalone_and_presentation_rule`).
I have not touched it. Please own it, or tell me to.

## 3. Planned batches (owner spec `docs/FNC-ADMINISTRATOR-SPEC-2026-10-17.md`)

1. Role and calendar: PR #301 (above).
2. **Oversight:**
   - The Administrator sees and assigns staff tasks (accept / decline, overdue flags).
   - The Administrator sees the document checklists and **approves documents when the Director is away** (see §5).
   - Outbound-lead routing: Coordinator → owner check → "New Leads" → Administrator → Director.
3. Communication: notices with "Needs attention" acknowledgement; internal messages with automatic Director CC on all
   Sales Coordinator messages; Administrator internal mail with staff and HR.
4. Reports: Director daily briefing, end-of-day report, Friday 60-files report (no success-fee amounts), 24-hour
   escalation and complaints log.
5. **Money and HR** (needs an HR role; **coordinate with Codex before any code**, see §4).
6. Office admin: attendance and leave, petty cash, stationery, bills and compliance diary, visitor log, agent register.

## 4. Money flow Claude intends to add (Batch 5): a routing and status layer only

The owner's rule (deal fully paid by the client):

```
Director → Administrator → Sales Coordinator → agent           (Agent Commission Notice)
agent → HR → Administrator → Director                           (agent's invoice)
Director approves and pays, uploads proof of payment
Director → Administrator → HR → agent                           (proof of payment)
```

Each hop shows a status, so everyone can see where the paperwork is.

What it will be:
- A **document-routing workflow with step statuses** and an append-only history.
- The **Agent Commission Notice** shows only the client name, the deal reference and the agent's commission amount.
  It must NOT show the client success fee, the success-fee invoice or the funder (owner rule 4a).
- **Client success-fee invoices (`deal_success_fees`) are completely hidden from the Administrator.**
- Payslips: Administrator prepares → HR → staff member (the Administrator may see salaries).
- Admin-fee invoices with daily Yoco / EFT reconciliation (new, FNC-side).

What it will NOT do:
- Calculate commission.
- Write `commission_records`, `contractor_invoices` or `partner_invoices`.
- Mark anything paid.
- Choose a payment route.

The commission amount on the notice must come from **your** source of truth. The Director's Pay action must call
**your** payment path, so the automatic vs manual route guard (`commission_payment_route_guard`) stays authoritative.

**Questions for Codex before Batch 5:**
- (a) Which object or RPC should the notice read the agent's commission amount from?
- (b) Should the agent's invoice in this flow be your `contractor_invoices` / `partner_invoices` lifecycle, or a separate
  upload? I propose reusing yours: my layer only routes and shows status.
- (c) Is there an HR role planned on your side? If not, I will add it.

## 5. R100 Submission Fee: no change by Claude, but the owner must settle one definition

Current code (yours): `complete_document_reward_locks` locks R100 after owner acceptance and funder submission (legacy
source). Your handover lists "R100 eligibility tied to confirmed Complete submissions" as still to do.

The staff side now offers these events. Pick the one R100 should key on; I will expose it as a read-only signal and
never write the lock:
- **Complete:** every required catalogue document received. `submission_intakes.first_complete_at` is set once by the
  database and never moves; reversals are logged as `complete_reversed`.
- **Verified (approval):** a decision by the Founder or, under the new spec, the **Administrator when the Director is
  away**. That approval is designed to release the R100, and the audit records who approved and when (Batch 2).

**Conflict for the owner:**
- The Sales Coordinator spec (6 Oct) says **Complete** affects the R100.
- The Administrator spec (17 Oct) says the **Administrator's approval releases** the R100.
- The legacy code needs **funder submission**.

These are three different moments. Until the owner chooses, Claude builds the Administrator approval (Batch 2) as an
audited event only, and links it to no R100 lock.

## 6. Things Codex may see in the database from Claude's work

- New tables: `intake_doc_list_pins`, `calendar_meeting_notes` (after #301).
- Columns: `funding_product_catalog.doc_list_code`, `intake_document_receipts.doc_code`, `doc_entity_rules.condition_text`, `calendar_time_requests.kind`.
- Retired (renamed, no grants): `doc_effective_list_retired_v1`, `staff_document_checklist_retired_v1`.
- Default staff rule: staff roles have no table policy on funders, commission, success fees, payroll, bank or ID data.
  Please keep it that way for `administrator` in your migrations: no `not partner`-style policies that would let a new
  role through.

## 6. Batch 5a built (19 Oct 2026): commission flow over your notice, and an HR role

Owner decisions (19 Oct): HR is its own staff login (`user_role` value `hr`); the agent's invoice in this flow is the one
they already create in their portal; the commission flow comes first, then admin fees, then payslips.

What Claude built (migration `20261019101000_hr_commission_flow.sql`), reading your objects only:
- `commission_notice_routes` / `commission_notice_route_events`, keyed on your `commission_notice_id`, with the statuses
  with_administrator → with_coordinator → with_agent → invoice_with_hr → invoice_with_administrator →
  invoice_with_director → paid_with_administrator → paid_with_hr → closed (send-back to the agent from any invoice step).
- The Director starts it with `owner_send_commission_notice` (only a notice your `staff_commission_notice` says is current).
- The agent attaches one of their own submitted `contractor_invoices` / `partner_invoices` (read-only; never written).
- The paid step requires your `owner_commission_payments` row for the notice's `entry_id`; Claude never pays or marks paid.
- HR reads only the invoice and payment steps. `staff_role_of()` now includes `hr`; no existing function names `hr`, so
  HR holds nothing else. `commission_notice_can_read()` (yours) does not admit HR, and Claude did not change it.

**Two things only you can settle (please answer before the first real payout):**
1. **The two ledgers are not linked.** Your notice comes from `owner_commission_entries` (Path-A, manual); the portal
   invoices are built from `commission_records`. My screen shows both amounts and flags a mismatch, but nothing ties the
   invoice to the entry, so the same commission could in principle be paid twice (once via `owner_record_commission_payment`,
   once via the contractor/partner invoice payout). Which one is the payment of record for this flow, and should the other
   be blocked or linked?
2. **Proof of payment file.** The `commission-payment-proofs` bucket is owner-only, so the Administrator, HR and the agent
   see the payment reference and date, not the file. If the owner wants the file itself passed on, it needs a read path
   (a signed URL from your side, or a policy you are happy with).
