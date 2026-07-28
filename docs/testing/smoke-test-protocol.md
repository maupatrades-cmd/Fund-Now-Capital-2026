# Money Engine — Live Smoke Test Protocol

> **Provenance:** authored fresh 2026-07-28 by NEW CC 2 (no prior file existed in the repo or on any
> branch — this is not an in-place edit of an earlier version). Incorporates the owner's 6 corrections
> from the revised protocol. Every DB fact below was verified against the live schema, not assumed.
> **Owner should confirm the section structure matches the intended layout.**

**Target:** Fund Now Capital CRM · Supabase project `hvxruwkgmhjoypepffgv` · production (`main`).
**Scope:** end-to-end exercise of the Phase C money engine that has never been run against real rows —
funder invoicing (C1.1/C1.2), the commission ledger + state lifecycle (C2.1/C2.2/C2.3), the 6
idempotency-hardened UI buttons, the 3 pg_cron sweeps, and notification delivery (in-app + email).

---

## ⚠️ Read before you start — safety & irreversibility

1. **`INV-0032` is permanent once generated.** `funder_invoices_seq` is at **32** and does not roll back.
   Generating an invoice **burns the number even if you later void it**. Decide up front: is this the
   real first invoice, or a disposable test? A voided test still consumes INV-0032; the next real one
   would be INV-0033.
2. **This runs on LIVE data.** Prefer a **disposable test client → deal → funded submission** created for
   this run and removed in Part 6, OR a real deal you genuinely intend to fund. Do **not** move a real
   client-facing deal to `funded` unless that reflects reality.
3. **Commission rows auto-write on `funded`.** Moving a deal to `funded` fires
   `write_commission_record` automatically (C2.2) — you do not insert commission rows by hand.
4. **Owner-only.** Every money RPC is `is_owner()`-gated; run the UI logged in as
   `business.lekgoro@gmail.com`, and run SQL via the Supabase SQL editor / service role.
5. **Never** discuss real funder rates in any partner-facing surface (CLAUDE.md).

---

## Part 0 — Funder rate structures (setup)

The invoice/commission math reads the funder's rate structure. Confirm these exist in
`funder_commission_structures` before testing. **rate_fraction is a fraction (0.025 = 2.5%).**

| Funder | rate_type | Rate | Notes |
|--------|-----------|------|-------|
| **Flow48** (Chloe) | `percent_of_gross_funded` | **2.5%** first advance / **2.0%** repeat | ✅ In enum — **use this for the live invoice test.** `rate_fraction` 0.025 / 0.020. First-vs-repeat is banked S7B future logic; for this test use one row (2.5%). |
| **Pollen Finance** (Palesa) | `percent_of_finance_charge` | **10%** | ✅ In enum — **finance-charge path.** The C1.2 modal captures the finance charge and persists it to the submission before generating. `rate_fraction` 0.10. |
| **Merchant Capital** (…) | `percent_of_revenue` **10% first / 5% subsequent** | — | 🚧 **BANKED FUTURE WORK (SPEC S7B) — `percent_of_revenue` is NOT yet in the `funder_rate_type` enum.** Merchant Capital **cannot be invoiced through the current engine.** Do not use MC for the live invoice test; it is documentation-only until the C2 rate-type extension ships (new `percent_of_revenue` type + `deal_funder_submissions.revenue_amount`). |

> **Correction #1 + #2 applied:** MC fixed to `percent_of_revenue` 10%/5% and marked banked/not-in-enum;
> Flow48 (`percent_of_gross_funded` 2.5%/2.0%) and Pollen (`percent_of_finance_charge` 10%) added as the
> two live-testable paths.

**The live invoice test below uses Flow48** (cleanest `percent_of_gross_funded` path). Repeat with
Pollen afterwards to exercise the finance-charge branch.

---

## Part 1 — Invoice lifecycle (C1.1 + C1.2 UI)

**Precondition:** a deal at `funded` with a Flow48 submission carrying `amount_funded`.

1. **Set up the funded deal** (disposable test path):
   - Create a test client + deal (`/pipeline` → New Deal), add a **Flow48** funder submission.
   - Set the submission's `amount_funded` (e.g. R500,000).
   - Move the deal to **Funded**. → this auto-writes the commission row (verify in Part 2).
2. **Generate INV-0032** — on the deal detail **Invoices** section, click **Generate invoice — Flow48**.
   - The preview modal shows facility advanced, rate/basis, Lead Provider Commission, VAT (Not VAT
     registered), total, terms, due date, payment-reference pattern. Confirm the commission = 2.5% ×
     amount funded.
   - Click **Generate draft invoice** → RPC `generate_funder_invoice`. Expect INV-0032, state **draft**.
3. **Issue** (draft → issued) — invoice detail → **Issue** → RPC `issue_funder_invoice`.
4. **Mark as paid** (issued → paid) — **Mark as paid**, enter amount + reference → `mark_funder_invoice_paid`.
5. **(Optional) Void path** — on a *separate* draft/issued test invoice, **Void** (typed `OVERRIDE` for
   issued) → `void_funder_invoice`. Confirm the linked commission reverts (Part 2).

**Expected invoice states walked:** draft → issued → paid (and, on the void branch, → void).

---

## Part 2 — Commission ledger verification (C2.2 + C2.3)

The commission row is created on `funded` and transitions as the invoice moves. **`commission_records`
links to the deal via `deal_funder_submission_id` — always JOIN through `deal_funder_submissions`.**

```sql
-- Correction #4 applied: JOIN via deal_funder_submissions (NOT a non-existent commission_records.deal_id)
select cr.id,
       cr.status                     as commission_state,   -- earned|outstanding|payable|settled|void
       cr.gross_commission,
       cr.company_retention,
       cr.partner_share,
       cr.owner_share,
       cr.tier_pct,
       cr.funder_invoice_id,
       cr.earned_at, cr.outstanding_at, cr.payable_at, cr.settled_at,
       dfs.deal_id,
       dfs.funder_id,
       d.reference                   as deal_reference,
       fi.invoice_number
from public.commission_records cr
join public.deal_funder_submissions dfs on dfs.id = cr.deal_funder_submission_id
join public.deals d                       on d.id  = dfs.deal_id
left join public.funder_invoices fi        on fi.id = cr.funder_invoice_id
order by cr.earned_at desc;
```

**Verify the lifecycle** (`commission_state` enum: `earned, outstanding, payable, settled, void`):

| After you… | Commission state should be | Set by |
|------------|----------------------------|--------|
| Move deal to **Funded** (Part 1.1) | `earned` | `write_commission_record` (C2.2) |
| **Issue** INV-0032 (Part 1.3) | `outstanding` (+ `funder_invoice_id` linked, `outstanding_at` set) | C2.3 cascade `draft→issued` |
| **Mark paid** (Part 1.4) | `payable` (`payable_at` set) | C2.3 cascade `issued/overdue→paid` |
| **Void** an issued invoice (Part 1.5) | reverts to `earned` (FK unlinked) | C2.3 cascade `→void` |

**Invariant check** (must always hold): `company_retention + partner_share + owner_share = gross_commission`
(enforced by `commission_records_sums_ck`). For a no-partner test deal, `partner_share = 0` and the
owner keeps the pool.

---

## Part 3 — UI idempotency button sweep (6 buttons)

> **Correction #3 applied:** extended from 4 to **6** — added **Delete Rate** and **Qualify Lead override**.

For each button, do a **deliberate rapid double-click** and confirm: (a) the button **disables** while
in flight, (b) a spinner/working label shows, (c) exactly **one** success toast, (d) **no duplicate
row / no double-effect**, (e) an error toast on failure.

| # | Button | Where | Verify |
|---|--------|-------|--------|
| 1 | **Delete Document** | client/lead → Documents | disables + confirm + one delete + success toast |
| 2 | **Delete Funder Submission** | deal detail → Funder submissions | disables + confirm + single delete (cascades to its commission) |
| 3 | **Change Deal Stage** | deal detail stage `<select>` | control disables while saving; no double stage-history write |
| 4 | **Toggle Priority (star)** | deal detail | disables while pending; star settles to one state |
| 5 | **Delete Rate** | `/settings/funders` → rate structure | disables + confirm + single delete + toast |
| 6 | **Qualify Lead (override path)** | lead detail → Qualify modal → *Override & qualify* | disables ("Qualifying…"); a second click does **not** create a 2nd client/deal (DB is idempotent via `SELECT … FOR UPDATE` + `qualification_stage='qualified'` short-circuit, but the button must still disable) |

> If NEW CC 1's UI-hardening PR is not yet merged, buttons 1–5 may still be double-clickable; button 6's
> DB layer is already safe (verified). Note which are pre- vs post-PR when recording results.

---

## Part 4 — pg_cron sweep tests (3 jobs)

> **Correction #5 applied.** Windows verified against the live detection functions. Each sweep can be
> triggered immediately with a manual `select`, rather than waiting for the 04:00–04:30 UTC schedule.

### 4a. Document-expiry sweep — `EXPIRING_30D`
```sql
-- expiry 25 days out → falls in the 8–30 day window → DOCUMENT_EXPIRING_30D (NOT a past date, which
-- would mark it EXPIRED). Verified: document_expiry_due() → EXPIRING_30D when (expiry - today) in (7,30].
update public.documents
   set expiry_date = public.current_sast_date() + 25   -- +25 days
 where id = '<a real document id>';
select public.check_document_expiries();               -- run the sweep now
```
Expect: a `DOCUMENT_EXPIRING_30D` notification to the owner + one row in the expiry dedup ledger
(`document_expiry_alerts`), once-per-(document,threshold).

### 4b. Call-followup sweep — `FOLLOW_UP_DUE`
```sql
-- ⚠️ Verified predicate: followups_due() fires when follow_up_date <= today. Use TODAY so it fires on
-- this same-day manual run. (Owner's "+1 day" note = the row fires on TOMORROW's 04:15 sweep, not today.)
update public.call_logs
   set follow_up_needed = true,
       follow_up_date    = public.current_sast_date()   -- due today → fires now
 where id = '<a real call_log id>';
select public.check_followups_due();                    -- run the sweep now
```
Expect: a `FOLLOW_UP_DUE` notification to the owner + one claim in `call_log_followup_alerts`
(claim-then-act dedup). *To test the owner's +1-day variant instead, set `+ 1` and wait for tomorrow's
04:15 sweep, or run `select * from public.followups_due(public.current_sast_date() + 1);` to simulate it.*

### 4c. Invoice-overdue sweep — `INVOICE_OVERDUE`
```sql
-- Verified predicate: state='issued' AND payment_terms <> 'Due on receipt' AND due_date < today.
-- Use an ISSUED invoice with a backdated due_date. (Owner: "invoice-overdue is correct with backdated due_date".)
update public.funder_invoices
   set due_date = public.current_sast_date() - 5        -- backdated
 where id = '<an ISSUED test invoice id>'
   and state = 'issued';
select public.check_overdue_invoices();                 -- run the sweep now
```
Expect: invoice flips `issued → overdue` + an `INVOICE_OVERDUE` owner notification.

---

## Part 5 — Notification verification (in-app + email)

> **Correction #6 applied.** For **every** notification-emitting action above (deal funded, invoice
> issued/paid, and the 3 sweeps), verify BOTH channels:

1. **In-app bell** — the bell badge count increments in real time (Supabase Realtime); open the dropdown
   and confirm the new notification with the correct title and link.
2. **Email (Resend)** — check the owner inbox **business.lekgoro@gmail.com**. **Wait 30–60 seconds**
   for Resend delivery (email is fired async via `pg_net` → `send-notification-email`, so it never blocks
   the write). Confirm:
   - the **email arrives**, from `hello@fundnowcapital.africa`;
   - the **subject line matches the event** (e.g. deal approved / funded / commission / weekly summary);
   - the branded template renders (navy header, teal CTA).
3. **Delivery ledger** (optional cross-check):
```sql
select n.event_type, n.title, n.created_at,
       nd.channel, nd.delivery_status, nd.error_message, nd.sent_at
from public.notifications n
join public.notification_deliveries nd on nd.notification_id = n.id
order by n.created_at desc limit 20;
```
Expect an `in_app / delivered` row and, for the four email-enabled events, an `email / sent` row (or
`skipped` with a reason if in quiet hours / digest / disabled).

---

## Part 6 — Cleanup (if you used disposable test data)

Remove test rows in FK-safe order, and **record what was left behind**. Note: a generated invoice
number (INV-0032) is permanently consumed — that is expected and not "residue".

```sql
-- Adjust ids to your test rows. Delete children before parents.
-- funder_invoices (void first if issued/paid), commission_records (cascades from submission delete),
-- deal_funder_submissions, deals, clients, call_logs, documents, notifications/deliveries.
```
Re-run the residue scan pattern (clients/leads/deals/documents/call_logs/notifications) to confirm zero
test rows remain, and confirm the only footprints are the immutable `activity_logs` audit rows.

---

## Appendix — verified reference (as of 2026-07-28)

- `funder_invoices_seq` last_value **32**, `is_called=false` → next invoice **INV-0032**.
- `commission_state` enum: `earned, outstanding, payable, settled, void`.
- `funder_rate_type` in-enum types used here: `percent_of_gross_funded`, `percent_of_finance_charge`,
  `flat_rand_per_deal`. **`percent_of_revenue` is NOT in the enum** (Merchant Capital — banked S7B).
- `commission_records.deal_funder_submission_id` → the only join path to a deal (via
  `deal_funder_submissions`). One non-void commission per funded submission (partial-unique).
- pg_cron jobs: `document-expiry-sweep` 04:00, `call-followup-sweep` 04:15, `invoice-overdue-sweep`
  04:30 (UTC), all active, all green through 2026-07-28.
- Money RPCs (all `SECURITY DEFINER` + `is_owner()` + advisory-lock / state-guard): `generate_funder_invoice`,
  `issue_funder_invoice`, `mark_funder_invoice_paid`, `void_funder_invoice`, `update_draft_invoice`,
  `write_commission_record`, `transition_commission_record`.
- Owner inbox for email checks: **business.lekgoro@gmail.com**.
