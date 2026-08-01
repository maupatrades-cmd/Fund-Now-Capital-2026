# FUND NOW CAPITAL CRM — FULL SYSTEM AUDIT

**Date:** 2026-07-31 · **Auditor:** AUDIT-FIX lane (Claude Code) · **Method:** read-only inventory of the live Supabase project `hvxruwkgmhjoypepffgv` (pg_catalog / pg_policies / pg_trigger / cron.job / storage / Supabase advisors / Edge Function listing) cross-checked against the repo at `main` (commit `e1af539`) and the four governing docs (CLAUDE.md, SPEC.md, ROADMAP.md, `.coordination/status.md`).

**Headline: no production-breaking blockers found.** The money layer is guarded (advisory locks, state guards, idempotency, owner-only RLS), all three pg_cron sweeps are green, and the live commission ledgers are legitimately empty (no genuine funding event yet). The significant findings are (a) documentation drift — the live system is *ahead* of CLAUDE.md/ROADMAP/status.md, which still describe B5.2/B6/C0–C3 as pending when they are built and live; (b) a batch of security-hygiene advisor warnings (anon EXECUTE grants, one unpinned search_path, SECURITY DEFINER views, leaked-password protection off); and (c) the frontend notification-preferences surface lagging 13 live event types, so the owner cannot manage email prefs for the invoice/bonus/lead-lifecycle/document-expiry events.

---

## 1. FINDINGS — CATEGORIZED

### 1.1 Blockers (breaks production / corrupts data)
**None found.** Specifically verified: commission/bonus ledgers empty and correctly so (no submission carries `amount_funded`); every money RPC recomputes server-side; `documents` ownership XOR holds for all rows (0 violations); all cron sweeps succeeded on their last 3 runs; no orphaned child rows surfaced.

### 1.2 High-risk gaps (fix in order of severity — each is one small PR unless noted)

| # | Finding | Detail | Severity |
|---|---|---|---|
| **F1** | **Anon/PUBLIC EXECUTE grants on RPC + trigger functions** | Supabase security advisor flags ~14 `anon_security_definer_function_executable` WARNs. `anon` (and PUBLIC) hold EXECUTE on: `mark_notification_read`, `mark_notifications_read`, `mark_all_notifications_read`, `reopen_deal`, `find_lead_duplicates`, `find_client_duplicates`, `calculate_commission`, `commission_tier_pct`, `current_partner_id`, `is_owner`, plus several trigger functions (`notify_*`, `documents_*`, `*_cipc_block`, `*_write_commission_on_funded`, `*_cascade_on_invoice_state`, `rls_auto_enable`). **No active exploit**: the mark-read RPCs scope to `auth.uid()` (null for anon → no-op), `reopen_deal`/`find_*` are SECURITY INVOKER so RLS returns nothing to anon, and PostgREST refuses to invoke trigger-returning functions. But it violates the project's own belt-and-braces grants-matrix rule. Fix: one migration — `REVOKE EXECUTE ... FROM anon, public` on the RPC surface and on all trigger functions (trigger functions need EXECUTE for no API role at all). | High (hygiene, zero behaviour change) |
| **F2** | **`leads_qualification_guard` has a mutable search_path** | Advisor WARN `function_search_path_mutable`. It is the **only** function in `public` without `SET search_path = ''` (every other function pins it). Fix: one-line `ALTER FUNCTION ... SET search_path = ''` (re-verify the body's identifiers are schema-qualified — they are in the repo migration). | High (consistency with the non-negotiable security style) |
| **F3** | **Auth leaked-password protection disabled** | Advisor WARN `auth_leaked_password_protection`. HaveIBeenPwned check is off. **Owner dashboard toggle, not a code PR** (Auth → Providers → Password security). Two-user system today, but free to enable. | High (one-click, owner action) |
| **F4** | **Frontend notification surface missing 13 live event types** | `src/lib/notifications.ts` `NOTIFICATION_EVENT_TYPES` stops at the original A11 list (17 values). Missing live enum values: `LEAD_QUALIFIED`, `LEAD_NOT_QUALIFIED`, `LEAD_STARTED_QUALIFICATION`, `LEAD_UPDATED`, `DOCUMENT_EXPIRING_30D`, `DOCUMENT_EXPIRING_7D`, `DOCUMENT_EXPIRED`, `LEAD_DOCUMENT_REJECTED`, `FUNDER_INVOICE_ISSUED`, `INVOICE_OVERDUE`, `INVOICE_MARKED_PAID`, `BONUS_PAID`, `WEEKLY_SUMMARY`. Consequences: (a) the **preferences matrix cannot show/toggle these events** — and since the owner has **no `notification_preferences` rows** for `FUNDER_INVOICE_ISSUED` / `INVOICE_MARKED_PAID` / `INVOICE_OVERDUE` / `BONUS_PAID` / `WEEKLY_SUMMARY`, the Edge Function's "no row ⇒ email ON" default applies and **cannot be switched off in the UI**; (b) bell/list items for these events render raw enum text with the generic Bell icon. Notifications still deliver (safe fallback) — this is a control gap, not a delivery gap. Fix: extend the labels/icons list (1 frontend PR); optionally backfill owner pref rows. This is the already-triaged "finding #3" from the OLD CC 1 handover — still open. | High-Medium |
| **F5** | **4 partner views are SECURITY DEFINER** (advisor ERROR ×4) | `partner_leads_view`, `partner_submission_view`, `partner_funder_industry_appetite`, `partner_stakeholders_view`. Each embeds its own `is_owner() OR current_partner_id()`-scoping WHERE and projects only partner-safe columns, so **no data leaks today** — this is the deliberate B1/B2.3/A9.5/B6 design (partners have no SELECT policy on the base tables; the view IS the partner surface). But definer views bypass base-table RLS permanently, are the advisor's only ERROR-level lints, and the pattern must be consciously re-affirmed or reworked (e.g. `security_invoker = true` + explicit partner RLS policies) **before Phase D gives partners a real login**. No unilateral change — owner decision at D1 scope time. | Medium now / High at Phase D |
| **F6** | **Two contracted funders lack an explicit `short_code`** | `Business Partners` and `Better Banc` have `is_contracted = true`, `short_code = NULL`. **Invoicing does NOT fail** — `funder_shortcode()` is `coalesce(f.short_code, suggest_client_short_code(f.name))`, so generation falls back to a name-derived code (first alphanumeric run, uppercased, ≤12 chars: `BUSINESS`, `BETTER`) in `payment_reference_expected`. The gap is a data-quality preference: an auto-derived reference may not match what the funder's remittance desk expects, so the owner should still set deliberate codes before first invoicing these two. Data entry by owner, not a schema fix. Already flagged in status.md NEW CC 1 lane; still open. *(Reframed 2026-08-01 per Macroscope on PR #98 — the original wording claimed generation would fail/malform, which the coalesce fallback disproves.)* | Low (cosmetic reference quality, not a block) |

### 1.3 Drift (SPEC/ROADMAP/status.md vs live — propose fix scope, owner approves)

| # | Drift | Live truth |
|---|---|---|
| **D1** | **CLAUDE.md "Current build state" + ROADMAP are one full phase behind live.** CLAUDE.md says "NEXT: B5 … then Phase C opens with C0"; ROADMAP marks B5.2 pending, B6 ⬜ not started, all of C0–C7 ⬜. | Live DB + merged main have: **B5.2** (`find_client_duplicates` RPC, `clients_cipc_block` trigger, clients CIPC unique index), **B6.1+B6.2** (`client_stakeholders` table + XOR CHECKs + `partner_stakeholders_view` + qualify-lead stakeholder re-pointer + `src/components/stakeholders/` UI), **B4.1** (`client_stories.lead_id` XOR + story re-pointer + `STORY_MIGRATED_LEAD_TO_CLIENT` event), **C0** (`funder_commission_structures` + `is_contracted` gate + `funder_rate_at`), **C1.1/C1.2** (`funder_invoices` + full RPC lifecycle + `/invoices` UI + PDF Edge Function + overdue sweep), **C2.1–C2.4** (`deals.deal_type` cutover, `commission_records` reshape with state machine, invoice-driven cascade triggers, `bonus_records`), **C3** (owner-side `/partner-earnings` reconciliation view, PR #91). Fix: docs-only PR updating CLAUDE.md build-state, ROADMAP checkmarks, and SPEC S1/S7A "not yet built" notes. |
| **D2** | **`.coordination/status.md` is stale.** Says FIX #2 (PR #93) is "OPEN, NOT applied to live yet" and C2.4/#86 "DO-NOT-APPLIED". | PR #93 merged (`e1af539`) **and applied**: live `funder_commission_structures` holds exactly 4 rows, all `is_contracted = true` funders (Business Partners 1%, Flow48 2.5%, Merchant Capital 3.5%, Pollen 10% of finance charge) — Lula + RM Capital rows gone. C2.4 applied: `bonus_records` live, `BONUS_PAID` in both enums, 0 rows. Fixed by the status.md update accompanying this audit. |
| **D3** | **G7 commission-engine reconciliation (carried forward — real money-math, owner decision).** (a) live `commission_tier_pct` gives **flat 40% to ALL PO deals**; SPEC S7C locks flat-40% to **Sourcefin** PO deals only. (b) live gives **25% for R500,001+ with no upper split**; S7C says R1,000,001+ is **TBD — owner to confirm**. No live trigger consumes this yet (0 commission rows), but it must be reconciled **before the first non-Sourcefin PO deal and before the first R1M+ gross deal**. Small migration + SPEC PR once the owner rules. |
| **D4** | **SPEC S4 event enum vs live**: SPEC's S4 list omits the C1/C2.4 additions `FUNDER_INVOICE_ISSUED`, `INVOICE_OVERDUE`, `INVOICE_MARKED_PAID`, `BONUS_PAID` (documented in S7 prose but not in the S4 master list). Fold into the D1 docs PR. |
| **D5** | **`.coordination/full-system-audit-2026-08-01.md` referenced by status.md does not exist in the repo.** The FIX-lane header cites it as its source; only `status.md` is committed. Either commit that audit file or re-point the FIX lane at this `AUDIT.md`. |

### 1.4 Cosmetic (noted, not touched)
- `pdflibtest` + `ops-storage-remove` Edge Functions: already decommissioned in-place (both return HTTP 410 stubs) but still listed ACTIVE — delete from the dashboard when convenient (owner action; MCP has no delete).
- `DEAL-003` reference gap in the deals sequence (test-data cleanup residue, harmless).
- `deals_without_lead = 1` (DEAL-001 predates the leads table — expected).
- `stub_settle_from_partner_invoice` / `stub_unsettle_from_partner_invoice` / `settle_bonus_from_partner_invoice` / `unsettle_bonus_from_partner_invoice` are P0002 raise-stubs by design (C4 wires them).
- Extensions `pg_net` + `btree_gist` in `public` schema (advisor WARN, `extension_in_public`) — moving them is disruptive for marginal benefit; defer to Phase F hardening.
- Legacy document storage paths + delete-vs-immutability trigger interaction — already tracked in ROADMAP "Deferred Polish"; confirmed still present, nothing new.
- Owner `notification_preferences` rows exist for 26 event/user combos; events without rows fall back to email-ON default (per A12 design). Backfill folds into F4 if desired.

---

## 2. TABLE INVENTORY (public schema — 29 tables, all RLS-enabled)

Notation: `NN` = NOT NULL, `GEN` = stored generated. Policies quoted verbatim from `pg_policies`. Row counts = live `n_live_tup` at audit time.

### 2.1 activity_logs — 87 rows
General audit trail (S5); owner-only reads; written by SECURITY DEFINER triggers; immutable through the API (no INSERT/UPDATE/DELETE policy).
- **Columns:** id uuid NN, occurred_at timestamptz NN, user_id uuid, user_email text, user_role text, ip_address text, user_agent text, event_type activity_event_type NN, entity_type text NN, entity_id uuid, description text, changed_fields jsonb, before_values jsonb, after_values jsonb, session_id text, related_entity_ids jsonb, notes text
- **RLS:** `activity_logs_owner_read` SELECT `is_owner()`
- **Triggers:** none on itself. **Known/tracked:** before/after snapshots can contain PII on UPDATEs (ROADMAP F10).

### 2.2 bonus_records — 0 rows
C2.4 discretionary owner bonuses; rides funder-invoice lifecycle in lockstep with commission_records; reuses `commission_state`.
- **Columns:** id uuid NN, deal_id uuid NN, deal_funder_submission_id uuid, referral_partner_id uuid NN, bonus_amount numeric(14,2) NN, bonus_reason text NN, state commission_state NN, earned_at/outstanding_at/payable_at/settled_at timestamptz, funder_invoice_id uuid, partner_invoice_id uuid, created_by uuid, notes text, created_at/updated_at NN
- **RLS:** `bonus_records_owner_all` ALL `is_owner()`; `bonus_records_partner_read_own` SELECT `referral_partner_id = current_partner_id()`
- **Triggers:** `bonus_records_immutable_when_settled` (BEFORE UPDATE), `log_activity_bonus_records`, `notify_bonus_paid` (AFTER UPDATE), `set_updated_at`

### 2.3 call_log_followup_alerts — 1 row
FOLLOW_UP_DUE once-per-follow-up dedup ledger (claim-then-act).
- **Columns:** id uuid NN, call_log_id uuid NN, sent_at timestamptz NN
- **RLS:** `call_log_followup_alerts_owner_read` SELECT `is_owner()` (writes only via DEFINER sweep)

### 2.4 call_logs — 1 row
B4 client call history; `call_logs_followup_needs_date` CHECK (follow_up_date required when follow_up_needed).
- **Columns:** id uuid NN, client_id uuid NN, call_date date NN, call_time time, medium call_medium NN, duration_minutes int, discussed_topics text, client_promises text, thapelo_promises text, follow_up_needed bool NN, follow_up_date date, next_action text, created_by uuid, created_at/updated_at NN
- **RLS:** `call_logs_owner_all` ALL `is_owner()`
- **Triggers:** `log_activity_call_logs`, `set_updated_at`

### 2.5 client_contacts — 2 rows
- **Columns:** id uuid NN, client_id uuid NN, full_name text NN, email text, phone text, position text, is_primary_director bool NN, created_at/updated_at NN, id_number text
- **RLS:** owner ALL; `client_contacts_partner_read_own` SELECT via parent client's `referral_partner_id = current_partner_id()`
- **Triggers:** `log_activity_client_contacts`, `set_updated_at`

### 2.6 client_stakeholders — 0 rows *(B6 — LIVE, docs say "not started")*
One row per person; roles array; SA-ID/passport branch; FICA beneficial-owner.
- **Columns:** id uuid NN, client_id uuid, lead_id uuid, full_name text NN, id_type stakeholder_id_type NN, id_number text, passport_country text, roles stakeholder_role[] NN, shareholding_percent numeric(5,2), is_beneficial_owner bool NN, cell text, email text, physical_address text, notes text, created_at/updated_at NN, created_by uuid NN, updated_by uuid
- **RLS:** `client_stakeholders_owner_all` ALL `is_owner()`; restrictive-style `client_stakeholders_created_by_is_caller` INSERT CHECK `created_by = auth.uid()`
- **Triggers:** `client_stakeholders_touch` (BEFORE UPDATE), `log_activity_client_stakeholders`
- **Partner surface:** `partner_stakeholders_view` (full_name, roles, shareholding_percent only — no ID/passport/contact PII), per S3a.

### 2.7 client_stories — 0 rows *(B4.1 lead-XOR shape LIVE)*
- **Columns:** id uuid NN, client_id uuid, business_story…opportunities_seen (14 narrative text cols), created_by uuid, created_at/updated_at NN, **lead_id uuid** (B4.1 XOR with client_id)
- **RLS:** `client_stories_owner_all` ALL `is_owner()`
- **Triggers:** `log_activity_client_stories`, `set_updated_at`

### 2.8 client_story_notes — 0 rows
Append-only impressions: SELECT + INSERT policies only, no UPDATE/DELETE path.
- **Columns:** id uuid NN, story_id uuid NN, text text NN, author_id uuid, created_at NN
- **RLS:** `client_story_notes_owner_read` SELECT `is_owner()`; `client_story_notes_owner_insert` INSERT CHECK `is_owner()`

### 2.9 clients — 3 rows (Mama Mabase JV, Fepa Sechaba, NRL Bakwena)
- **Columns:** id uuid NN, business_name text NN, cipc_number text, sector text *(deprecated)*, referral_partner_id uuid, notes text, created_by uuid, created_at/updated_at NN, monthly_turnover numeric(14,2), address text, industry_id uuid, sub_industry_id uuid, sector_notes text, short_code text
- **RLS:** owner ALL; `clients_partner_read_own` SELECT `referral_partner_id = current_partner_id()`
- **Triggers:** `clients_cipc_block` (BEFORE INSERT/UPDATE — B5.2 server-side CIPC dup guard), `log_activity_clients`, `set_updated_at`

### 2.10 commission_records — 0 rows (legitimately: no genuine funding yet)
C2 ledger; real tiered math; 5-state machine `earned | outstanding | payable | settled | void`.
- **Columns:** id uuid NN, deal_id uuid NN, referral_partner_id uuid, gross_commission numeric(14,2) NN, is_purchase_order bool NN, tier_pct numeric(10,4) NN, company_retention numeric(14,2) NN, partner_pool numeric(14,2) NN, partner_share numeric(14,2) NN, owner_share numeric(14,2) NN, status commission_state NN, computed_at NN, created_at/updated_at NN, deal_funder_submission_id uuid NN, funder_invoice_id uuid, partner_invoice_id uuid, earned_at/outstanding_at/payable_at/settled_at timestamptz, notes text
- **RLS:** owner ALL; partner SELECT own (`referral_partner_id = current_partner_id()`) — S7C presentation policy is a **frontend** contract; the partner-visible columns here include the full split, but no partner UI reads this table and Phase D must apply the S7C column discipline. *(Flagged under F5/D1 for the Phase D checklist.)*
- **Triggers:** `commission_records_recompute` (BEFORE INSERT/UPDATE — server recompute, client values never trusted), `log_activity_commission_records`, `notify_commission_paid` (AFTER INSERT/UPDATE), `set_updated_at`

### 2.11 communications — 0 rows
- **Columns:** id uuid NN, client_id uuid, deal_id uuid, referral_partner_id uuid, channel text NN, direction text, subject text, body text, occurred_at NN, created_by uuid, created_at NN
- **RLS:** owner ALL; partner SELECT own via `referral_partner_id`

### 2.12 deal_funder_submissions — 3 rows (all DEAL-001: 1 quote_received, 2 approved; none funded, none with amounts)
- **Columns:** id uuid NN, deal_id uuid NN, funder_id uuid NN, status text NN, submitted_at, responded_at, quote_amount numeric(14,2), offered_commission numeric(14,2), notes text, created_at/updated_at NN, decline_reason_category submission_decline_reason, decline_notes_internal text, amount_approved numeric(14,2), amount_funded numeric(14,2), approved_at, funded_at, applied_rate_snapshot jsonb, finance_charge_amount numeric(14,2)
- **RLS:** `deal_funder_submissions_owner_all` ALL `is_owner()` (partner surface = `partner_submission_view` only)
- **Triggers:** `deal_funder_submissions_auto_decline` (AFTER — last-active-submission-declined → deal auto-Declined), `log_activity_submissions`, `notify_deal_approved` (AFTER), `set_updated_at`, `submissions_write_commission_on_funded` (AFTER — C2 companion funded trigger)

### 2.13 deal_stage_history — 11 rows
- **Columns:** id uuid NN, deal_id uuid NN, from_stage deal_stage, to_stage deal_stage NN, changed_by uuid, changed_at NN
- **RLS:** owner ALL; partner SELECT own via parent deal

### 2.14 deals — 3 rows (DEAL-001 funded*, DEAL-002 qualifying, DEAL-004 qualifying; *not genuinely funded — no amount_funded anywhere)
- **Columns:** id uuid NN, reference text, client_id uuid NN, referral_partner_id uuid, stage deal_stage NN, is_purchase_order bool NN, amount_requested numeric(14,2), gross_commission numeric(14,2), awarded_funder_id uuid, declined_reason text, stage_entered_at NN, created_by uuid, created_at/updated_at NN, is_priority bool NN, notes text, funding_purpose jsonb NN, funding_timeline lead_funding_timeline, lead_id uuid, deal_type deal_type (all 3 = non_po)
- **RLS:** owner ALL; partner SELECT own
- **Triggers:** `deals_before_write` (BEFORE), `deals_block_declined_reopen` (BEFORE UPDATE — Declined terminal), `deals_log_stage` (AFTER), `deals_write_commission_on_funded` (AFTER — C2), `log_activity_deals`, `notify_deal_funded` (AFTER), `set_updated_at`

### 2.15 document_expiry_alerts — 0 rows
Once-per-(document,threshold) dedup ledger for the expiry sweep.
- **Columns:** id uuid NN, document_id uuid NN, alert_type notification_event_type NN, sent_at NN
- **RLS:** `document_expiry_alerts_owner_read` SELECT `is_owner()`

### 2.16 documents — 4 rows (Mama Mabase: CIPC + 2 bank-statement months + 1 more)
Governed store (B3.1/B3.2): 52-type taxonomy, provenance immutability, type-aware versioning, packs, verification workflow. XOR ownership verified: 0 violating rows.
- **Columns:** id uuid NN, client_id uuid, deal_id uuid, referral_partner_id uuid, filename text NN, storage_path text NN, file_size_bytes bigint, mime_type text, uploaded_by uuid NN, created_at NN, document_type document_type NN, upload_source document_upload_source NN, lead_id uuid, period_start/period_end date, expiry_date date, version_number int NN, is_current_version bool NN, superseded_by uuid, status document_status NN, received_from text, notes text, tags text[], shared_with text[], updated_at NN, owning_entity_id uuid GEN, is_period_scoped bool GEN, category document_category GEN, verification_status document_verification_status NN, rejection_reason document_rejection_reason, verification_notes text, verified_by uuid, verified_at timestamptz
- **RLS:** `documents_owner_all` ALL `is_owner()`; `documents_partner_insert` INSERT CHECK **false** (Phase D placeholder); `documents_partner_read_own_uploads` SELECT — partner sees only own partner-source uploads AND type NOT IN (bank_statement, mgmt_accounts, debtors_ageing, creditors_ageing, financial_statements, personal_financials, source_of_funds) — the structured-PII exclusion list, verbatim as specced.
- **Triggers:** `documents_immutable_audit` (BEFORE UPDATE — `documents_prevent_audit_rewrite`), `documents_notify_rejected` (AFTER UPDATE), `documents_set_updated_at`, `documents_versioning` (BEFORE INSERT — `documents_apply_versioning`)

### 2.17 funder_commission_structures — 4 rows
Per-funder rates FNC earns (C0.1). Live rows: Business Partners non_po 1% gross-funded (from 2026-07-21) · Flow48 non_po 2.5% gross-funded (2026-07-21) · Merchant Capital non_po 3.5% gross-funded (2026-07-20) · Pollen Finance non_po 10% of finance charge (2026-04-28). All four funders contracted. (FIX #2 removed the Lula/RM Capital rows — **verified applied**.)
- **Columns:** id uuid NN, funder_id uuid NN, deal_type deal_type NN, rate_type funder_rate_type NN, rate_fraction numeric(10,4), flat_amount numeric(14,2), effective_from date NN, effective_to date, contract_clause_ref text, notes text, created_at/updated_at NN, created_by/updated_by uuid, payment_terms_days int NN, contract_reference text
- **RLS:** `fcs_owner_all` ALL `is_owner()`
- **Triggers:** `enforce_rate_funder_contracted` (BEFORE — cross-table contracted gate), `log_activity_funder_commission_structures`, `set_updated_at`

### 2.18 funder_contacts — 0 rows — owner ALL; `set_updated_at`.

### 2.19 funder_industry_preferences — 51 rows (36 high / 12 medium / 3 avoid per S1)
- **RLS:** `fip_owner_all` ALL `is_owner()` (partner path = anonymised view). Trigger: `fip_set_updated_at`.

### 2.20 funder_invoices — 0 rows
C1.1 single-table invoice design; `INV-NNNN` from `funder_invoices_seq` (next = 0032); state `draft→issued→paid|overdue|void`.
- **Columns:** id uuid NN, invoice_number text NN, deal_id uuid NN, deal_funder_submission_id uuid NN, funder_id uuid NN, client_reference text NN, facility_advanced numeric(14,2) NN, finance_charge_amount, commission_amount NN, vat_amount (always null — not VAT-registered), total_amount NN, rate_snapshot jsonb NN, commission_description text NN, contract_reference, payment_reference_expected text NN, issued_date date NN, payment_terms text NN, due_date date NN, state invoice_state NN, paid_at, paid_amount, payment_reference_received, pdf_storage_path, notes, created_at/updated_at NN, created_by/updated_by
- **RLS:** `funder_invoices_owner_all` ALL `is_owner()`
- **Triggers:** `bonus_cascade_on_invoice_state` + `commission_cascade_on_invoice_state` (AFTER UPDATE — drive the two ledgers in lockstep), `funder_invoices_state_guard` (BEFORE UPDATE — legal transitions only), `set_updated_at`

### 2.21 funders — 23 rows (11 contracted; 2 contracted missing short_code → F6)
- **Columns:** id uuid NN, name text NN *(owner-only identity)*, display_name_for_partner text NN, funder_type, agreement_status, is_active bool NN, notes, created_at/updated_at NN, ticket_min/ticket_max numeric(14,2), is_contracted bool NN, short_code, legal_name, billing_address, company_registration, vat_registration, accounts_email, phone
- **RLS:** `funders_owner_all` ALL `is_owner()` — partners never SELECT this table (views expose the fictional name only). Trigger: `set_updated_at`.

### 2.22 industries — 25 rows / **2.23 sub_industries — 225 rows**
Reference data: `*_read_all` SELECT `true` (all authenticated) + `*_owner_all` ALL `is_owner()`. Triggers: `set_updated_at`.

### 2.24 leads — 3 rows (all qualified)
- **Columns:** the full S2 field set as specced (41 cols) incl. `entered_by` (default auth.uid), `qualification_stage` NN, `not_qualified_reason/notes`, `qualified_at/by`
- **RLS:** `leads_owner_all` ALL `is_owner()`; `leads_entered_by_is_caller` INSERT CHECK `entered_by = auth.uid()`. **No partner SELECT policy** — partner surface is `partner_leads_view` (see F5).
- **Triggers:** `leads_cipc_block` (BEFORE — CIPC hard-block), `leads_qualification_guard` (BEFORE UPDATE — terminal qualified, reason required; **F2: unpinned search_path**), `leads_set_updated_at`, `log_activity_leads`, `notify_lead_created_for_you` (AFTER INSERT), `notify_lead_events` (AFTER UPDATE)

### 2.25 notification_deliveries — 25 rows
- **RLS:** SELECT own via parent notification. No write policy (DEFINER writes only).

### 2.26 notification_preferences — 26 rows
- **RLS:** `notification_preferences_own` ALL `user_id = auth.uid()`.
- Owner has email ON for 23 event types; **no rows** (⇒ default email ON, not UI-toggleable — F4) for `FUNDER_INVOICE_ISSUED`, `INVOICE_MARKED_PAID`, `INVOICE_OVERDUE`, `BONUS_PAID`, `WEEKLY_SUMMARY`.

### 2.27 notifications — 14 rows (DEAL_APPROVED 6, DEAL_FUNDED 2, LEAD_QUALIFIED 1, WEEKLY_SUMMARY 1, FOLLOW_UP_DUE 1, COMMISSION_PAID 1, LEAD_CREATED_FOR_YOU 1, LEAD_STARTED_QUALIFICATION 1)
- **RLS:** `notifications_select_own` SELECT `user_id = auth.uid()`; writes only via `emit_in_app_notification`; in `supabase_realtime` publication (the only table published).

### 2.28 profiles — 2 rows (owner business.lekgoro@gmail.com; partner queenasdice@gmail.com → referral_partners 9f48c460…)
- **Columns:** id uuid NN, email, full_name, role user_role NN, referral_partner_id, is_active NN, created_at/updated_at NN, phone_number, phone_number_verified NN, whatsapp_opted_in NN, sms_opted_in NN
- **RLS:** `profiles_owner_all` ALL `is_owner()`; `profiles_select_own` SELECT `id = auth.uid()`. Trigger: `set_updated_at`. Populated by `handle_new_user` (auth trigger).

### 2.29 referral_partners — 1 row (Bright Destiny placeholder)
- **RLS:** owner ALL; `referral_partners_partner_read_own` SELECT `id = current_partner_id()`. Trigger: `set_updated_at`.

### Views (4 — all SECURITY DEFINER, see F5)
| View | Exposes | Scoping WHERE |
|---|---|---|
| `partner_leads_view` | id, business_name, industry/sub, sector_notes, funding_amount/purpose/timeline, qualification_stage, referred_by, referral_partner_id, original_referrer_id, created/updated, not_qualified_reason — **no contact PII, no notes** | `is_owner() OR referral_partner_id = current_partner_id() OR original_referrer_id = current_partner_id()` |
| `partner_submission_view` | id, deal_id, **fictional funder name**, status, decline_reason_category | `is_owner() OR` deal's partner |
| `partner_funder_industry_appetite` | industry, **fictional funder name**, appetite_level | `is_owner() OR current_partner_id() IS NOT NULL` |
| `partner_stakeholders_view` | id, client_id, lead_id, full_name, roles, shareholding_percent — **no ID/passport/contact PII** | `is_owner() OR` client/lead partner |

### Storage
- **Buckets:** `documents` (private), `invoices` (private).
- **storage.objects policies:** documents — owner SELECT/INSERT/UPDATE/DELETE via `is_owner()`; partner SELECT `owner = auth.uid()` (own uploads); partner INSERT CHECK false (Phase D). invoices — `invoices_owner_all` ALL `is_owner()`. Mirrors the table matrix; path-permissive by design until Phase D (S6).

---

## 3. SECURITY DEFINER RPC MATRIX

All DEFINER functions pin `SET search_path = ''`. "Lock" = `pg_advisory_xact_lock` present in source (verified live). Grants per `information_schema.routine_privileges` (API roles only).

### 3.1 Callable RPC surface

| RPC (signature) | Grants | Lock | Idempotency guard | State guard | Notes |
|---|---|---|---|---|---|
| `qualify_lead(p_lead_id, p_override bool)` | authenticated | — (row `FOR UPDATE` + one-deal-per-lead unique index) | ✔ re-qualify returns existing deal | ✔ `leads_qualification_guard` trigger + doc gate (`lead_required_docs_missing`), typed-OVERRIDE escape logged via `log_qualification_override` | `is_owner()` at entry |
| `generate_funder_invoice(p_submission_id, p_finance_charge, p_contract_ref, p_notes)` | authenticated | ✔ | ✔ one non-void invoice per submission; no sequence gaps on re-call | ✔ funded-submission precondition | rate via `funder_rate_at` (approval-pinned), snapshots `rate_snapshot` |
| `issue_funder_invoice(p_invoice_id)` | authenticated | ✔ | ✔ (state check) | ✔ draft→issued only | fires PDF + FUNDER_INVOICE_ISSUED + deal Funded→Invoiced |
| `mark_funder_invoice_paid(p_invoice_id, p_paid_amount, p_payment_reference)` | authenticated | ✔ | ✔ | ✔ issued/overdue→paid | does not touch commission settle (C4) |
| `void_funder_invoice(p_invoice_id, p_override, p_reason)` | authenticated | ✔ | ✔ | ✔ draft free / issued needs typed OVERRIDE | |
| `update_draft_invoice(p_invoice_id, p_description, p_notes)` | authenticated | ✔ | n/a | ✔ draft-only | |
| `write_commission_record(p_deal_id)` | authenticated | ✔ | ✔ | ✔ requires Funded + amount_funded | also invoked by the two funded triggers |
| `transition_commission_record(p_id, p_to, p_funder_invoice_id)` | authenticated | ✔ | ✔ | ✔ legal-transition matrix | |
| `add_bonus(p_deal_id, p_submission_id, p_referral_partner_id, p_bonus_amount, p_bonus_reason)` | authenticated | ✔ | ✔ (Decision-C guard) | ✔ | |
| `void_bonus(p_bonus_id, p_override, p_reason)` | authenticated | ✔ | ✔ | ✔ typed OVERRIDE | |
| `transition_bonus_record(p_id, p_to, p_funder_invoice_id)` | authenticated | ✔ | ✔ | ✔ | |
| `settle_bonus_from_partner_invoice` / `unsettle_bonus_from_partner_invoice` / `stub_settle_from_partner_invoice` / `stub_unsettle_from_partner_invoice` | authenticated | n/a | n/a | n/a | **P0002 raise-stubs** until C4 |
| `set_document_verification(p_document_id, p_status, p_reason, p_notes)` | authenticated | — | single-row UPDATE, RETURNING-checked | ✔ reason-iff-rejected; stamps only on real status change | owner-only at entry; writes its own activity row |
| `mark_notification_read(p_id)` / `mark_notifications_read(p_ids)` / `mark_all_notifications_read()` | authenticated **+ anon + PUBLIC (F1)** | — | scoped `auth.uid()`; returns affected rows | n/a | anon ⇒ no-op |
| `emit_in_app_notification(...)` | *(no API grant — internal)* | — | — | — | called by notify_* triggers; chains email invoke |
| `invoke_send_notification_email(p_notification_id)` / `invoke_generate_invoice_pdf(p_invoice_id)` | *(no API grant)* | — | — | — | async pg_net POST w/ Vault URL + secret |
| `log_qualification_override` / `log_invoice_activity` / `log_activity` (trigger) | *(no API grant)* | — | — | — | EXECUTE revoked from API roles — correct |
| `funder_rate_at(p_funder_id, p_deal_type, p_as_of)` | authenticated | — | read-only (STABLE) | — | effective-dated rate lookup |
| `funder_display_name(p_funder_id, p_recipient)` / `notify_owner()` / `notify_recipient(p)` / `partner_profile_id(p)` / `current_partner_id()` / `is_owner()` | helpers; `is_owner`/`current_partner_id` granted wide (incl. anon — F1) | — | — | — | STABLE role helpers |
| `client_shortcode(p_client_id)` / `funder_shortcode(p_funder_id)` | authenticated | — | — | — | invoice reference parts |
| `check_document_expiries()` / `check_followups_due()` / `check_overdue_invoices()` / `mark_expired_documents()` / `document_expiry_due(p)` / `followups_due(p)` | *(no API grant — cron/postgres only)* | — (single scheduled runner) | ✔ dedup ledgers (`document_expiry_alerts`, `call_log_followup_alerts`, once-per-invoice overdue) | ✔ | SAST-native via `current_sast_date()` |
| `handle_new_user()` | auth trigger | — | — | — | profile bootstrap |
| `rls_auto_enable()` | event trigger (granted wide — F1) | — | — | — | enables RLS on new tables |
| DEFINER trigger bodies: `leads_cipc_block`, `clients_cipc_block`, `deals_log_stage`, `deals_write_commission_on_funded`, `submissions_write_commission_on_funded`, `commission_cascade_on_invoice_state`, `bonus_cascade_on_invoice_state`, `documents_apply_versioning`, `documents_prevent_audit_rewrite`, `notify_*` | flagged for anon/authenticated EXECUTE (F1) — PostgREST cannot invoke trigger-returning fns; revoke anyway | | | | |

### 3.2 SECURITY INVOKER functions of note
`calculate_commission(gross, is_po)` + `commission_tier_pct` (IMMUTABLE — the engine; granted wide incl. anon: harmless pure math, tidy under F1), `fnc_gross_commission` (IMMUTABLE per-rate-type gross; `percent_of_mdr` raises deliberately), `find_lead_duplicates` / `find_client_duplicates` (STABLE, RLS-scoped; anon gets empty sets — tidy under F1), `lead_required_docs_missing` (STABLE, the single doc-gate rule), `reopen_deal(p_deal_id, p_stage)` (INVOKER — deliberate revival, RLS-protected; granted to anon — tidy under F1), `deals_auto_decline_on_last_submission`, `deals_before_write`, `deals_block_declined_reopen`, `leads_qualification_guard` (**F2**), `commission_records_recompute`, `funder_invoices_state_guard`, `bonus_records_immutable_when_settled`, `enforce_rate_funder_contracted`, `client_stakeholders_touch`, `set_updated_at`, `current_sast_date`, `document_*` taxonomy helpers, `suggest_client_short_code`.

---

## 4. EDGE FUNCTIONS (5 deployed)

| Function | Ver | Status | Auth model | Purpose |
|---|---|---|---|---|
| `send-notification-email` | **v12** | ACTIVE | `verify_jwt=false` + `X-Webhook-Secret` (Vault-paired) | A12 Resend email pipeline; S16 four-variant template; 73 Marshall St footer verified in v12; handles skip (prefs/quiet-hours/digest) + delivery rows |
| `generate-invoice-pdf` | v6 | ACTIVE | `verify_jwt=false` + `X-Webhook-Secret` | C1 branded INV-#### PDF → private `invoices` bucket |
| `sign-invoice-url` | v2 | ACTIVE | `verify_jwt=false` + `X-Webhook-Secret` (verified in source) | service-role sign/remove for `invoices` bucket objects — **server-side only**; the UI download button mints signed URLs with the owner's own session instead (no secret in browser — verified) |
| `pdflibtest` | v6 | ACTIVE (inert) | verify_jwt=true | decommissioned diagnostic — returns HTTP 410; delete from dashboard when convenient |
| `ops-storage-remove` | v2 | ACTIVE (inert) | verify_jwt=true | decommissioned ops helper — returns HTTP 410; delete from dashboard when convenient |

## 5. PG_CRON JOBS (3 — all green)

| Job | Schedule (UTC/SAST) | Command | Last 3 runs |
|---|---|---|---|
| `document-expiry-sweep` (id 1) | 0 4 * * * (06:00) | `select public.check_document_expiries()` | succeeded 07-29/30/31 |
| `call-followup-sweep` (id 2) | 15 4 * * * (06:15) | `select public.check_followups_due()` | succeeded 07-29/30/31 |
| `invoice-overdue-sweep` (id 4) | 30 4 * * * (06:30) | `select public.check_overdue_invoices()` | succeeded 07-29/30/31 |

## 6. FRONTEND ROUTES (26 — all owner-gated)

Guard: `/` renders AuthPage (unauthenticated) or redirects to `/dashboard`; the entire authenticated block sits inside `<OwnerGate>` (role must be `owner` via `useProfileRole`; a signed-in partner gets an "Owner access only" card + sign-out — no partner routes exist yet, Phase D). `*` → `/`.

| Path | Purpose |
|---|---|
| `/dashboard` | KPIs, pipeline snapshot, actions needed |
| `/pipeline` | Kanban (15 stages, dnd-kit, PriorityGlow) |
| `/deals/:id` | Deal detail: stage, submissions, calculators, documents (read-only client docs), invoices, activity |
| `/invoices`, `/invoices/:id` | C1.2 invoice list + detail (lifecycle actions, PDF download) |
| `/partner-earnings` | C3 owner-side partner-earnings reconciliation view (PR #91) |
| `/leads`, `/leads/new`, `/leads/:id`, `/leads/:id/edit` | B2 lead entry (dup detection), detail (documents + qualify + stakeholders), edit |
| `/clients`, `/clients/new`, `/clients/:id`, `/clients/:id/edit` | Client DB; detail tabs incl. Story, Call Log, Documents, Stakeholders |
| `/documents` | Global owner document view (filters, category chips) |
| `/funders`, `/funders/new`, `/funders/:id`, `/funders/:id/edit` | Funder panel (owner-only identity) |
| `/calculator` | Owner commission calculator (full transparency, RPC-backed) |
| `/activity` | A10 timeline (filters + CSV export) |
| `/notifications`, `/settings/notifications` | A11 list + prefs matrix (**F4: 13 events missing from matrix**) |
| `/settings/industries` | B1 industries tree + appetite matrix |
| `/settings/funders` | C0 per-funder rate structures |

## 7. STATE-CHANGING ACTION BUTTONS (inventory)

DB idempotency = server-side guard exists regardless of UI; UI idempotency = button disabled while pending / confirm step.

| Action (location) | Backend call | DB guard | UI guard | Risk |
|---|---|---|---|---|
| Qualify lead (lead detail) | `qualify_lead` RPC | unique index + FOR UPDATE + doc gate | typed `OVERRIDE` when docs missing | Low |
| Save lead w/ duplicates (lead form) | `find_lead_duplicates` + insert | `leads_cipc_block` trigger (hard block) | CIPC block + typed `SAVE` on soft warns | Low |
| Save client (client form) | `find_client_duplicates` + insert/update | `clients_cipc_block` + unique index | dup warn UX | Low |
| Drag deal stage (pipeline) / stage change (deal detail) | `deals.update({stage}).select("id")` | Declined-terminal trigger; stage-history trigger; funded triggers | row-count check (silent-RLS rule honoured) | Low |
| Revive declined deal (deal detail dropdown) | `reopen_deal` RPC | INVOKER + RLS + explicit stage arg | confirm dialog | Low |
| Submission add/status/decline (deal detail) | `deal_funder_submissions` insert/update | decline-category CHECK; auto-decline trigger; approved/funded notify triggers | forms w/ pending states | Low |
| Generate invoice (deal detail → `DealInvoices`) | `generate_funder_invoice` RPC | advisory lock + one-per-submission + funded precondition | preview modal, isPending | Low |
| Issue / Mark paid / Void invoice (`InvoiceActions`) | `issue_funder_invoice` / `mark_funder_invoice_paid` / `void_funder_invoice` | advisory locks + state guards + typed OVERRIDE (void issued) | all buttons `disabled={isPending}`; confirm steps | Low |
| Download invoice PDF | owner-session signed URL | storage owner-only RLS | disabled while loading | Low |
| Upload document (client/lead Documents) | storage upload + `documents` insert | versioning trigger + XOR CHECK + provenance immutability | pending states | Low |
| Accept/Reject/Reset verification (Documents) | `set_document_verification` RPC | owner-only, reason-iff-rejected, RETURNING-checked | reason picker | Low |
| Story save / impression append / call log (client detail) | table writes | owner-only RLS; append-only notes | forms | Low |
| Stakeholder add/edit (client/lead detail) | `client_stakeholders` writes | CHECKs (XOR, roles, shareholding); created_by policy | modal validation | Low |
| Mark notifications read (bell/list) | mark-read RPCs | auth.uid-scoped, returns rows | — | Low |
| Industry/appetite/funder/rate edits (settings) | table writes | owner-only RLS; contracted-gate trigger on rates | forms | Low |

**No unguarded destructive buttons found.** Every money-side transition goes through a locked, state-guarded DEFINER RPC; every kanban/stage mutation checks returned row counts.

## 8. NOTIFICATION EVENT TYPES (30 live enum values)

| Enum value | Emitter (live) | Email template variant (S16.4) | Frontend label/icon (`src/lib/notifications.ts`) |
|---|---|---|---|
| LEAD_CREATED_FOR_YOU | `notify_lead_created_for_you` (leads INSERT, loaded-on-behalf) | `welcome` | ✔ label + UserPlus |
| LEAD_SUBMITTED_BY_PARTNER | — (Phase D) | — | ✔ label |
| LEAD_QUALIFICATION_UPDATED | — (superseded placeholder, retained) | — | ✔ label |
| LEAD_STARTED_QUALIFICATION | `notify_lead_events` (leads UPDATE) | email off by default | **✘ missing (F4)** |
| LEAD_QUALIFIED | `notify_lead_events` | `deal_approved` | **✘ missing (F4)** |
| LEAD_NOT_QUALIFIED | `notify_lead_events` (partner body: reason category only) | `deal_approved` layout w/ lead copy | **✘ missing (F4)** |
| LEAD_UPDATED | `notify_lead_events` | off by default | **✘ missing (F4)** |
| LEAD_DOCUMENT_REJECTED | `documents_notify_rejected` (partner-safe body) | `weekly_summary` | **✘ missing (F4)** |
| DEAL_SUBMITTED_TO_FUNDER | — (no trigger yet) | — | ✔ label + Send |
| DEAL_APPROVED | `notify_deal_approved` (submission → approved) | `deal_approved` | ✔ CheckCircle2/teal |
| DEAL_DECLINED | — (no trigger; deal auto-decline logs stage history instead) | — | ✔ XCircle/red |
| DEAL_FUNDED | `notify_deal_funded` (deal → funded) | `deal_funded` (reuses deal_approved layout) | ✔ PartyPopper/green |
| COMMISSION_PAID | `notify_commission_paid` (payment_received_date set) | `commission_paid` | ✔ Banknote/green |
| FUNDER_RESPONSE_RECEIVED / CLIENT_MESSAGE_RECEIVED / BADGE_EARNED / MONTHLY_TARGET_MILESTONE / TIER_REVIEW_UPCOMING / FUNDER_RATE_CONFIRMED / SYSTEM_MAINTENANCE | — (future phases) | — | ✔ labels |
| FOLLOW_UP_DUE | `check_followups_due` cron sweep | `weekly_summary` | ✔ Clock |
| DOCUMENT_UPLOADED | — (enum exists, no emitter — as documented in S4) | — | ✔ FileText |
| DOCUMENT_EXPIRING_30D / _7D / DOCUMENT_EXPIRED | `check_document_expiries` cron sweep | `weekly_summary` | **✘ missing (F4)** |
| WEEKLY_SUMMARY | (digest layout carrier) | `weekly_summary` | **✘ missing (F4)** |
| FUNDER_INVOICE_ISSUED | `issue_funder_invoice` | `deal_approved` tone | **✘ missing (F4)** |
| INVOICE_OVERDUE | `check_overdue_invoices` cron sweep | `weekly_summary` | **✘ missing (F4)** |
| INVOICE_MARKED_PAID | `mark_funder_invoice_paid` | `commission_paid` | **✘ missing (F4)** |
| BONUS_PAID | `notify_bonus_paid` (bonus → settled) | money tone | **✘ missing (F4)** |

## 9. COMMISSION CALCULATION LOGIC — every computation site

1. **`public.commission_tier_pct(gross, is_po)`** (IMMUTABLE SQL — live source verified): `is_po → 0.40`; `≤80,000 → 0.29`; `≤150,000 → 0.30`; `≤500,000 → 0.33`; `else 0.25`. **Hard-coded tiers — locked by design (CLAUDE.md engine); D3 flags the S7C deltas (Sourcefin-only PO scope, R1M+ TBD).**
2. **`public.calculate_commission(gross, is_po)`** (IMMUTABLE): retention = `round(gross × 0.40, 2)`; pool = gross − retention; partner = `round(pool × tier, 2)`; owner = pool − partner. Three outputs sum to gross. **The single engine — called via RPC by the calculator UI (`useDealDetail.ts:279`), and by `write_commission_record` / `commission_records_recompute` server-side.**
3. **`public.fnc_gross_commission(rate_type, fraction, flat, funded, finance_charge)`** (IMMUTABLE): per-rate-type FNC gross (percent_of_gross_funded × funded; percent_of_finance_charge × charge; flat; **percent_of_mdr raises** — deferred to first MCA deal).
4. **`funder_rate_at(funder, deal_type, as_of)`**: effective-dated rate row lookup (approval-pinned date per S7A).
5. **`generate_funder_invoice`**: computes invoice commission via `funder_rate_at` + snapshots to `rate_snapshot` (prefers C2's `applied_rate_snapshot` when present).
6. **`write_commission_record` + funded triggers** (`deals_write_commission_on_funded`, `submissions_write_commission_on_funded`): auto-write the ledger row when Funded + `amount_funded` — currently never fired (correctly; no genuine funding).
7. **`commission_records_recompute`** BEFORE-trigger: server recompute on any insert/update — client values never trusted.
8. **Frontend:** no client-side commission math found; the calculator calls the RPC. ✔ CLAUDE.md rule 5 holds.

## 10. HARD-CODED BUSINESS LOGIC THAT COULD BE DATA-DRIVEN

| Logic | Where | Verdict |
|---|---|---|
| 40/60 split + tier bands | `calculate_commission` / `commission_tier_pct` | **Locked by design** (CLAUDE.md). Only the D3 S7C deltas need owner ruling. |
| Doc type → category map + default expiry + period-scoped set | `document_type_category` / `document_default_expiry` / `document_type_is_period_scoped` (IMMUTABLE) | Documented B3.1 decision; configurable table deferred to Phase F. OK. |
| Required-docs qualification gate (CIPC+tax / bank stmt / ID+POA) | `lead_required_docs_missing` | Single-rule function — acceptable; revisit if per-funder requirements arrive (E3 has `funder_submission_templates` planned). |
| Email event→variant map + email allow-list | `send-notification-email` `resolveVariant()` / `eventCategory()` | Per S16.5 process. OK. |
| Overdue thresholds, expiry thresholds (30/7/0), sweep times | sweep functions / cron schedules | Fine at current scale. |
| Fictional-name pool | `funders.display_name_for_partner` data | Already data-driven. ✔ |

## 11. ORPHANED / RESIDUAL DATA CHECKS

- `documents` XOR ownership: **0 violations**. `document_expiry_alerts`: 0 (correct — no thresholds crossed). `commission_records`/`bonus_records`/`funder_invoices`: 0 rows each (**legitimately** — see CLAUDE.md "No deal is GENUINELY funded yet"). DEAL-001 remains at kanban `Funded` without `amount_funded` — **owner-judgment item carried forward** (triage #6): move back vs progress properly; money layer correctly ignores it.
- Test residue: none found in clients/leads/deals (3/3/3, all real). `pdflibtest`/`ops-storage-remove` inert stubs (cosmetic).
- Migration parity: repo `supabase/migrations` (through `20260731120000_fix2…`) matches live state — FIX #2, C2.4, C0–C2 all present and applied.

---

## 12. PROPOSED FIX SEQUENCE (awaiting owner approval — nothing started)

1. **FIX-A (F1+F2, one migration PR):** revoke anon/PUBLIC EXECUTE across the RPC + trigger-function surface; pin `leads_qualification_guard` search_path. Zero behaviour change; clears ~15 advisor WARNs.
2. **FIX-B (F4, one frontend PR):** add the 13 missing event types to `NOTIFICATION_EVENT_TYPES` + icon/colour maps; optionally backfill owner pref rows for the 5 events with no row.
3. **FIX-C (D1+D2+D4+D5, one docs PR):** bring CLAUDE.md build-state, ROADMAP checkmarks, SPEC S4 list, and status.md to live truth.
4. **Owner actions (no PR):** enable leaked-password protection (F3); set deliberate `short_code`s for Business Partners + Better Banc (F6 — invoicing works via the name-derived fallback meanwhile); optionally delete the two inert Edge Functions; rule on D3 (PO scope + R1M+ tier) and the DEAL-001 stage question.
5. **Deferred to Phase D scope:** F5 (definer-view pattern re-affirmation or security_invoker conversion) + S7C column discipline on `commission_records` partner reads.

*Standing rules honoured: this audit was read-only; every fix above ships as its own small PR from fresh main; owner merges after Macroscope review.*
