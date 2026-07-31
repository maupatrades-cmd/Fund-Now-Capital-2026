# Fund Now Capital CRM — Full System Audit (Read-Only Inventory)

**Date:** 2026-07-31 (Fri) · **Live Supabase project:** `hvxruwkgmhjoypepffgv`
**Scope:** Read-only map of production state. No code changes, no proposals, no recommendations, no next steps. Facts only.
**Method:** Live SQL introspection of the production database + `list_edge_functions` + frontend source read (`src/`, `supabase/functions/`). Cross-referenced against SPEC.md / CLAUDE.md / ROADMAP.md; drift flagged in §9.

> All row counts, schema, RLS, triggers, indexes, functions, cron and edge-function facts below were read from the LIVE project on 2026-07-31, not from migration files.

---

## 0. TOP-LINE COUNTS (live)

| Object | Count |
|---|---|
| Tables (public) | 29 (all RLS-enabled) |
| Views (public) | 4 (all partner-facing, all SECURITY DEFINER) |
| SECURITY DEFINER functions | 58 |
| Non-DEFINER app functions (excl. btree_gist internals) | 23 |
| Edge Functions deployed | 5 (all ACTIVE) |
| pg_cron jobs | 3 (all active, all last-run succeeded) |
| Enums (public) | 30 |
| Storage buckets | 2 (`documents`, `invoices`; both private) |
| Real production rows in money tables | commission_records 0 · bonus_records 0 · funder_invoices 0 |

---

## 1. LIVE DATABASE TABLES

29 tables, every one with `rowsecurity = true`. Row counts are exact `count(*)` as of 2026-07-31.

### 1.1 Row-count summary

| Table | Rows | One-line purpose |
|---|---:|---|
| activity_logs | 84 | General audit trail (S5); owner-only reads; written by DEFINER triggers |
| bonus_records | 0 | C2.4 discretionary owner→partner bonuses, riding the funder-invoice lifecycle |
| call_log_followup_alerts | 1 | Dedup ledger for FOLLOW_UP_DUE sweep (claim-then-act) |
| call_logs | 1 | Client call/interaction log (B4) with follow-up dates |
| client_contacts | 2 | Contacts/directors per client |
| client_stakeholders | 0 | B6 directors/shareholders/beneficial owners (schema live, no rows) |
| client_stories | 0 | B4 1:1 narrative record per client/lead |
| client_story_notes | 0 | Append-only "ongoing impressions" child of client_stories |
| clients | 3 | Client master (Mama Mabase, Fepa Sechaba, NRL Bakwena) |
| commission_records | 0 | Real tiered commission ledger (empty — no genuine funding yet) |
| communications | 0 | Generic comms log (unused so far) |
| deal_funder_submissions | 3 | Per-funder submission rows on deals (S7A substrate) |
| deal_stage_history | 11 | Stage-transition history (pre-A10 mechanism, still live) |
| deals | 3 | Deal master (DEAL-001/002/004) |
| document_expiry_alerts | 0 | Dedup ledger for document-expiry sweep |
| documents | 4 | Governed document store (B3.1/B3.2) |
| funder_commission_structures | 6 | Per-funder FNC rate structures (C0.1) |
| funder_contacts | 0 | Funder contact people (unused) |
| funder_industry_preferences | 51 | Appetite matrix (owner-only; partners reach via view) |
| funder_invoices | 0 | FNC→funder commission invoices (C1.1; none issued) |
| funders | 23 | Funder panel (real name + display_name_for_partner) |
| industries | 25 | Industry taxonomy (B1) |
| leads | 3 | Lead master (B2) |
| notification_deliveries | 25 | Per-channel delivery rows for notifications |
| notification_preferences | 26 | Per-user per-event channel matrix |
| notifications | 14 | In-app notification records |
| profiles | 2 | App users (owner + test partner), mirrors auth.users |
| referral_partners | 1 | Referral partner master (Bright Destiny) |
| sub_industries | 225 | Sub-industry taxonomy (B1) |

### 1.2 Per-table detail (columns · RLS · triggers · indexes)

Column types: `numeric(14,2)` for money; `USER-DEFINED` = a Postgres enum (enum values listed in §7 and the enum table below). `set_updated_at` is a shared BEFORE-UPDATE touch trigger; `log_activity` is the shared A10 audit trigger.

---

#### activity_logs — 84 rows
**Columns:** id uuid PK · occurred_at timestamptz NOT NULL · user_id uuid · user_email text · user_role text · ip_address text · user_agent text · event_type `activity_event_type` NOT NULL · entity_type text NOT NULL · entity_id uuid · description text · changed_fields jsonb · before_values jsonb · after_values jsonb · session_id text · related_entity_ids jsonb · notes text
**RLS:** `activity_logs_owner_read` — SELECT, `is_owner()`. (No INSERT/UPDATE/DELETE policy → immutable through API; written only by DEFINER trigger.)
**Triggers:** none (this is the audit sink).
**Indexes:** pkey · idx_activity_entity (entity_type, entity_id, occurred_at DESC) · idx_activity_event (event_type, occurred_at DESC) · idx_activity_occurred (occurred_at DESC) · idx_activity_user (user_id, occurred_at DESC)

#### bonus_records — 0 rows
**Columns:** id PK · deal_id NOT NULL · deal_funder_submission_id · referral_partner_id NOT NULL · bonus_amount numeric(14,2) NOT NULL · bonus_reason text NOT NULL · state `commission_state` NOT NULL · earned_at · outstanding_at · payable_at · settled_at · funder_invoice_id · partner_invoice_id · created_by · notes · created_at · updated_at
**RLS:** `bonus_records_owner_all` — ALL, `is_owner()`; `bonus_records_partner_read_own` — SELECT, `referral_partner_id = current_partner_id()`.
**Triggers:** bonus_records_immutable_when_settled (BEFORE UPDATE) · log_activity_bonus_records (AFTER I/U/D) · notify_bonus_paid (AFTER UPDATE OF state) · set_updated_at
**Indexes:** pkey · bonus_records_dedup_uq (deal_id, referral_partner_id, coalesce(submission_id), bonus_reason) WHERE state<>'void' · idx on deal / funder_invoice / partner / state / submission
**CHECK:** bonus_amount > 0

#### call_log_followup_alerts — 1 row
**Columns:** id PK · call_log_id NOT NULL · sent_at timestamptz NOT NULL
**RLS:** `call_log_followup_alerts_owner_read` — SELECT, `is_owner()`.
**Triggers:** none.
**Indexes:** pkey · unique(call_log_id)

#### call_logs — 1 row
**Columns:** id PK · client_id NOT NULL · call_date date NOT NULL · call_time time · medium `call_medium` NOT NULL · duration_minutes int · discussed_topics text · client_promises text · thapelo_promises text · follow_up_needed bool NOT NULL · follow_up_date date · next_action text · created_by · created_at · updated_at
**RLS:** `call_logs_owner_all` — ALL, `is_owner()`.
**Triggers:** log_activity_call_logs (AFTER I/U/D) · set_updated_at
**Indexes:** pkey · call_logs_client_idx (client_id, call_date DESC) · call_logs_followup_idx (follow_up_date) WHERE follow_up_needed
**CHECK:** follow_up_needed ⇒ follow_up_date NOT NULL

#### client_contacts — 2 rows
**Columns:** id PK · client_id NOT NULL · full_name text NOT NULL · email · phone · position · is_primary_director bool NOT NULL · id_number text · created_at · updated_at
**RLS:** `client_contacts_owner_all` — ALL, `is_owner()`; `client_contacts_partner_read_own` — SELECT via EXISTS(clients.referral_partner_id = current_partner_id()).
**Triggers:** log_activity_client_contacts · set_updated_at
**Indexes:** pkey · idx_client_contacts_client

#### client_stakeholders — 0 rows
**Columns:** id PK · client_id · lead_id · full_name NOT NULL · id_type `stakeholder_id_type` NOT NULL · id_number · passport_country · roles `stakeholder_role[]` NOT NULL · shareholding_percent numeric(5,2) · is_beneficial_owner bool NOT NULL · cell · email · physical_address · notes · created_at · updated_at · created_by NOT NULL · updated_by
**RLS:** `client_stakeholders_owner_all` — ALL, `is_owner()`; `client_stakeholders_created_by_is_caller` — RESTRICTIVE INSERT, `created_by = auth.uid()`. (No partner SELECT policy live yet — the `partner_stakeholders_view` exists for that path.)
**Triggers:** client_stakeholders_touch (BEFORE UPDATE) · log_activity_client_stakeholders (AFTER I/U/D)
**Indexes:** pkey · client_stakeholders_client_idx (partial) · client_stakeholders_lead_idx (partial)
**CHECKs:** owner_xor num_nonnulls(lead_id,client_id)=1 · passport_country (sa_id⇒null / passport⇒`^[A-Z]{2}$`) · roles non-empty · shareholder⇒shareholding_percent NOT NULL · shareholding 0–100

#### client_stories — 0 rows
**Columns:** id PK · client_id · lead_id · business_story · founder_background · business_origin · competitive_edge · aspirations · contact_story · family_context · personal_interests · language_preference · communication_style · assets_narrative · initial_assessment · concerns_flagged · opportunities_seen · created_by · created_at · updated_at
**RLS:** `client_stories_owner_all` — ALL, `is_owner()`.
**Triggers:** log_activity_client_stories · set_updated_at
**Indexes:** pkey · unique(client_id) · unique(lead_id)
**CHECK:** owner_xor num_nonnulls(lead_id,client_id)=1

#### client_story_notes — 0 rows
**Columns:** id PK · story_id NOT NULL · text NOT NULL · author_id · created_at
**RLS:** `client_story_notes_owner_read` — SELECT, `is_owner()`; `client_story_notes_owner_insert` — INSERT, `is_owner()`. (No UPDATE/DELETE → append-only by design.)
**Triggers:** none.
**Indexes:** pkey · client_story_notes_story_idx (story_id, created_at)

#### clients — 3 rows
**Columns:** id PK · business_name NOT NULL · cipc_number · sector (legacy, deprecated) · referral_partner_id · notes · created_by · created_at · updated_at · monthly_turnover numeric(14,2) · address · industry_id · sub_industry_id · sector_notes · short_code
**RLS:** `clients_owner_all` — ALL, `is_owner()`; `clients_partner_read_own` — SELECT, `referral_partner_id = current_partner_id()`.
**Triggers:** clients_cipc_block (BEFORE INSERT/UPDATE OF cipc_number) · log_activity_clients · set_updated_at
**Indexes:** pkey · business_name gin-trgm · cipc unique (partial, trimmed) · industry_id · sub_industry_id · short_code unique(upper) partial · idx_clients_referral_partner
**CHECK:** monthly_turnover ≥ 0 or null

#### commission_records — 0 rows
**Columns:** id PK · deal_id NOT NULL · referral_partner_id · gross_commission numeric(14,2) NOT NULL · is_purchase_order bool NOT NULL · tier_pct numeric(10,4) NOT NULL · company_retention numeric(14,2) NOT NULL · partner_pool numeric(14,2) NOT NULL · partner_share numeric(14,2) NOT NULL · owner_share numeric(14,2) NOT NULL · status `commission_state` NOT NULL · computed_at · created_at · updated_at · deal_funder_submission_id NOT NULL · funder_invoice_id · partner_invoice_id · earned_at · outstanding_at · payable_at · settled_at · notes
**RLS:** `commission_records_owner_all` — ALL, `is_owner()`; `commission_records_partner_read_own` — SELECT, `referral_partner_id = current_partner_id()`.
**Triggers:** commission_records_recompute (BEFORE I/U — server-side money recompute) · log_activity_commission_records · notify_commission_paid (AFTER I/U OF status) · set_updated_at
**Indexes:** pkey · commission_records_submission_unique (deal_funder_submission_id) WHERE status<>'void' · idx deal / funder_invoice / partner_invoice / referral_partner
**CHECKs:** gross ≥ 0 · company_retention + partner_share + owner_share = gross_commission

#### communications — 0 rows
**Columns:** id PK · client_id · deal_id · referral_partner_id · channel text NOT NULL · direction · subject · body · occurred_at NOT NULL · created_by · created_at
**RLS:** `communications_owner_all` — ALL, `is_owner()`; `communications_partner_read_own` — SELECT, `referral_partner_id = current_partner_id()`.
**Triggers:** none.
**Indexes:** pkey · idx client / deal / referral_partner

#### deal_funder_submissions — 3 rows
**Columns:** id PK · deal_id NOT NULL · funder_id NOT NULL · status text NOT NULL (⚠ text, not enum) · submitted_at · responded_at · quote_amount numeric(14,2) · offered_commission numeric(14,2) · notes · created_at · updated_at · decline_reason_category `submission_decline_reason` · decline_notes_internal · amount_approved numeric(14,2) · amount_funded numeric(14,2) · approved_at · funded_at · applied_rate_snapshot jsonb · finance_charge_amount numeric(14,2)
**RLS:** `deal_funder_submissions_owner_all` — ALL, `is_owner()`. (No partner policy on the base table; partners use `partner_submission_view`.)
**Triggers:** deal_funder_submissions_auto_decline (AFTER I/U OF status → deals_auto_decline_on_last_submission) · log_activity_submissions · notify_deal_approved (AFTER I/U OF status) · submissions_write_commission_on_funded (AFTER I/U OF amount_funded) · set_updated_at
**Indexes:** pkey · deal_funder_submissions_unique (deal_id, funder_id) · idx_dfs_deal · idx_dfs_funder
**CHECKs:** status='declined' ⇒ decline_reason_category NOT NULL · finance-charge required when applied rate_type = percent_of_finance_charge

#### deal_stage_history — 11 rows
**Columns:** id PK · deal_id NOT NULL · from_stage `deal_stage` · to_stage `deal_stage` NOT NULL · changed_by · changed_at
**RLS:** `deal_stage_history_owner_all` — ALL, `is_owner()`; `deal_stage_history_partner_read_own` — SELECT via EXISTS(deals.referral_partner_id = current_partner_id()).
**Triggers:** none (written by deals_log_stage on the deals table).
**Indexes:** pkey · idx_dsh_deal

#### deals — 3 rows
**Columns:** id PK · reference text · client_id NOT NULL · referral_partner_id · stage `deal_stage` NOT NULL · is_purchase_order bool NOT NULL · amount_requested numeric(14,2) · gross_commission numeric(14,2) · awarded_funder_id · declined_reason · stage_entered_at NOT NULL · created_by · created_at · updated_at · is_priority bool NOT NULL · notes · funding_purpose jsonb NOT NULL · funding_timeline `lead_funding_timeline` · lead_id · deal_type `deal_type`
**RLS:** `deals_owner_all` — ALL, `is_owner()`; `deals_partner_read_own` — SELECT, `referral_partner_id = current_partner_id()`.
**Triggers:** deals_before_write (BEFORE I/U) · deals_block_declined_reopen (BEFORE UPDATE — terminal Declined guard) · deals_log_stage (AFTER I/U → deal_stage_history) · deals_write_commission_on_funded (AFTER I/U OF stage) · notify_deal_funded (AFTER I/U OF stage) · log_activity_deals · set_updated_at
**Indexes:** pkey · deals_lead_id_unique_idx (partial — one deal per lead) · idx awarded_funder / client / referral_partner / stage
**CHECKs:** amount_requested ≥ 0 or null · gross_commission ≥ 0 or null

#### document_expiry_alerts — 0 rows
**Columns:** id PK · document_id NOT NULL · alert_type `notification_event_type` NOT NULL · sent_at NOT NULL
**RLS:** `document_expiry_alerts_owner_read` — SELECT, `is_owner()`.
**Triggers:** none.
**Indexes:** pkey · unique(document_id, alert_type)

#### documents — 4 rows
**Columns:** id PK · client_id · deal_id · referral_partner_id · filename NOT NULL · storage_path NOT NULL · file_size_bytes bigint · mime_type · uploaded_by NOT NULL · created_at · document_type `document_type` NOT NULL · upload_source `document_upload_source` NOT NULL · lead_id · period_start · period_end · expiry_date · version_number int NOT NULL · is_current_version bool NOT NULL · superseded_by · status `document_status` NOT NULL · received_from · notes · tags text[] · shared_with text[] · updated_at · owning_entity_id (generated) · is_period_scoped (generated) · category `document_category` (generated) · verification_status `document_verification_status` NOT NULL · rejection_reason `document_rejection_reason` · verification_notes · verified_by · verified_at
**RLS:** `documents_owner_all` — ALL, `is_owner()`; `documents_partner_read_own_uploads` — SELECT, partner + `uploaded_by=auth.uid()` + `upload_source='partner'` + document_type NOT IN (bank_statement, mgmt_accounts, debtors_ageing, creditors_ageing, financial_statements, personal_financials, source_of_funds); `documents_partner_insert` — INSERT, `WITH CHECK (false)` (Phase-D stub).
**Triggers:** documents_versioning (BEFORE INSERT → apply_versioning) · documents_immutable_audit (BEFORE UPDATE → prevent_audit_rewrite) · documents_notify_rejected (AFTER UPDATE WHEN verification_status changed) · documents_set_updated_at
**Indexes:** pkey · category · current_nonperiod_uq (partial) · current_period_uq (partial) · document_type · expiry_date (partial) · lead_id · owning_entity_id · status · superseded_by · uploaded_by · verified_by · idx client / deal / referral_partner
**CHECKs:** lead_deal_orthogonal (lead_id null OR deal_id null) · owner_entity num_nonnulls(lead_id,client_id)=1 · period_scope (period cols present iff period-scoped type) · rejection_reason present iff status=rejected

#### funder_commission_structures — 6 rows
**Columns:** id PK · funder_id NOT NULL · deal_type `deal_type` NOT NULL · rate_type `funder_rate_type` NOT NULL · rate_fraction numeric(10,4) · flat_amount numeric(14,2) · effective_from date NOT NULL · effective_to date · contract_clause_ref · notes · created_at · updated_at · created_by · updated_by · payment_terms_days int NOT NULL · contract_reference
**RLS:** `fcs_owner_all` — ALL, `is_owner()`.
**Triggers:** enforce_rate_funder_contracted (BEFORE I/U) · log_activity_funder_commission_structures · set_updated_at
**Indexes:** pkey · fcs_no_overlap GiST(funder_id, deal_type, daterange)
**CHECKs:** effective_to > effective_from or null · payment_terms_days ≥ 0 · rate bounds (flat⇒flat_amount set, else⇒rate_fraction 0–1)

#### funder_contacts — 0 rows
**Columns:** id PK · funder_id NOT NULL · full_name NOT NULL · email · phone · position · created_at · updated_at
**RLS:** `funder_contacts_owner_all` — ALL, `is_owner()`.
**Triggers:** set_updated_at
**Indexes:** pkey · idx_funder_contacts_funder

#### funder_industry_preferences — 51 rows
**Columns:** id PK · funder_id NOT NULL · industry_id NOT NULL · appetite_level `appetite_level` NOT NULL · notes · created_at · updated_at
**RLS:** `fip_owner_all` — ALL, `is_owner()`. (Partners reach via `partner_funder_industry_appetite` view.)
**Triggers:** fip_set_updated_at
**Indexes:** pkey · unique(funder_id, industry_id) · fip_funder_id_idx · fip_industry_id_idx

#### funder_invoices — 0 rows
**Columns:** id PK · invoice_number NOT NULL · deal_id NOT NULL · deal_funder_submission_id NOT NULL · funder_id NOT NULL · client_reference NOT NULL · facility_advanced numeric(14,2) NOT NULL · finance_charge_amount numeric(14,2) · commission_amount numeric(14,2) NOT NULL · vat_amount numeric(14,2) · total_amount numeric(14,2) NOT NULL · rate_snapshot jsonb NOT NULL · commission_description NOT NULL · contract_reference · payment_reference_expected NOT NULL · issued_date NOT NULL · payment_terms text NOT NULL · due_date NOT NULL · state `invoice_state` NOT NULL · paid_at · paid_amount · payment_reference_received · pdf_storage_path · notes · created_at · updated_at · created_by · updated_by
**RLS:** `funder_invoices_owner_all` — ALL, `is_owner()`.
**Triggers:** funder_invoices_state_guard (BEFORE UPDATE WHEN state changed) · commission_cascade_on_invoice_state (AFTER UPDATE OF state) · bonus_cascade_on_invoice_state (AFTER UPDATE OF state) · set_updated_at
**Indexes:** pkey · unique(invoice_number) · funder_invoices_one_active_uq (deal_funder_submission_id) WHERE state<>'void' · deal / funder / state idx
**CHECK:** amounts non-negative

#### funders — 23 rows
**Columns:** id PK · name NOT NULL (owner-only real name) · display_name_for_partner NOT NULL · funder_type · agreement_status · is_active bool NOT NULL · notes · created_at · updated_at · ticket_min numeric(14,2) · ticket_max numeric(14,2) · is_contracted bool NOT NULL · short_code · legal_name · billing_address · company_registration · vat_registration · accounts_email · phone
**RLS:** `funders_owner_all` — ALL, `is_owner()`. (No partner policy — partners never see the funders table; anonymised name via views only.)
**Triggers:** set_updated_at
**Indexes:** pkey · unique(name) · unique(display_name_for_partner) · short_code unique(upper) partial
**CHECKs:** agreement_status ∈ {signed,verbal,pending,estimated} · ticket_min/max ≥ 0 · ticket_max ≥ ticket_min

#### industries — 25 rows
**Columns:** id PK · name NOT NULL · description · active bool NOT NULL · sort_order int NOT NULL · created_at · updated_at
**RLS:** `industries_owner_all` — ALL, `is_owner()`; `industries_read_all` — SELECT, `true` (reference data, all authenticated read).
**Triggers:** industries_set_updated_at
**Indexes:** pkey · unique(name)

#### leads — 3 rows
**Columns:** id PK · business_name NOT NULL · entity_type `lead_entity_type` · cipc_number · industry_id · sub_industry_id · sector_notes · website · trading_history_months · employee_range `lead_employee_range` · monthly_turnover_range `lead_turnover_range` · annual_turnover numeric(14,2) · contact_name NOT NULL · contact_role · contact_cell · contact_email · contact_id_number · physical_address · registered_address · region · funding_amount numeric(14,2) · funding_purpose jsonb NOT NULL · funding_timeline `lead_funding_timeline` · has_existing_debt bool NOT NULL · existing_debt_details jsonb · security_available jsonb NOT NULL · referred_by `lead_referred_by` NOT NULL · referred_by_other · referral_partner_id · entered_by · loaded_on_behalf bool NOT NULL · original_referrer_id · initial_notes · qualification_stage `lead_qualification_stage` NOT NULL · not_qualified_reason `lead_not_qualified_reason` · not_qualified_notes · follow_up_date · created_at · updated_at · qualified_at · qualified_by
**RLS:** `leads_owner_all` — ALL, `is_owner()`; `leads_entered_by_is_caller` — RESTRICTIVE INSERT, `entered_by = auth.uid()`. (Partners use `partner_leads_view`.)
**Triggers:** leads_cipc_block (BEFORE INSERT/UPDATE OF cipc_number) · leads_qualification_guard (BEFORE UPDATE) · notify_lead_created_for_you (AFTER INSERT) · notify_lead_events (AFTER UPDATE) · log_activity_leads · leads_set_updated_at
**Indexes:** pkey · business_name gin-trgm · cipc unique (partial) · created_at DESC · entered_by · industry_id · sub_industry_id · original_referrer_id · qualification_stage · qualified_by · referral_partner_id
**CHECK:** referred_by_other set only when referred_by='other'

#### notification_deliveries — 25 rows
**Columns:** id PK · notification_id NOT NULL · channel `notification_channel` NOT NULL · delivery_status `notification_delivery_status` NOT NULL · sent_at · delivered_at · error_message · external_id · created_at
**RLS:** `notification_deliveries_select_own` — SELECT via EXISTS(notifications.user_id = auth.uid()).
**Triggers:** none.
**Indexes:** pkey · idx_notification_deliveries_notification · notification_deliveries_one_email (notification_id) WHERE channel='email'

#### notification_preferences — 26 rows
**Columns:** id PK · user_id NOT NULL · event_type `notification_event_type` NOT NULL · email_enabled bool NOT NULL · whatsapp_enabled bool NOT NULL · sms_enabled bool NOT NULL · in_app_enabled bool NOT NULL · quiet_hours_start time · quiet_hours_end time · digest_mode bool NOT NULL · updated_at
**RLS:** `notification_preferences_own` — ALL, `user_id = auth.uid()`.
**Triggers:** none.
**Indexes:** pkey · idx_notification_preferences_user · unique(user_id, event_type)

#### notifications — 14 rows
**Columns:** id PK · user_id NOT NULL · event_type `notification_event_type` NOT NULL · title NOT NULL · body_text · body_html · link_url · data jsonb · read_status bool NOT NULL · created_at · read_at
**RLS:** `notifications_select_own` — SELECT, `user_id = auth.uid()`. (No direct write policy → writes via DEFINER emit; mark-read via RPCs.)
**Triggers:** none.
**Indexes:** pkey · idx_notifications_user (user_id, created_at DESC) · idx_notifications_user_unread (user_id) WHERE read_status=false
**Realtime:** added to `supabase_realtime` publication (per A11).

#### profiles — 2 rows
**Columns:** id uuid PK (=auth.users.id) · email · full_name · role `user_role` NOT NULL · referral_partner_id · is_active bool NOT NULL · created_at · updated_at · phone_number · phone_number_verified bool NOT NULL · whatsapp_opted_in bool NOT NULL · sms_opted_in bool NOT NULL
**RLS:** `profiles_owner_all` — ALL, `is_owner()`; `profiles_select_own` — SELECT, `id = auth.uid()`.
**Triggers:** set_updated_at (plus `handle_new_user` on auth.users mirrors new signups here).
**Indexes:** pkey · idx_profiles_referral_partner
**CHECK:** owner role ⇒ referral_partner_id NULL

#### referral_partners — 1 row
**Columns:** id PK · name NOT NULL · contact_email · contact_phone · is_active bool NOT NULL · notes · created_at · updated_at · slug
**RLS:** `referral_partners_owner_all` — ALL, `is_owner()`; `referral_partners_partner_read_own` — SELECT, `id = current_partner_id()`.
**Triggers:** set_updated_at
**Indexes:** pkey · unique(name) · slug unique (partial)

#### sub_industries — 225 rows
**Columns:** id PK · industry_id NOT NULL · name NOT NULL · active bool NOT NULL · sort_order int NOT NULL · created_at · updated_at
**RLS:** `sub_industries_owner_all` — ALL, `is_owner()`; `sub_industries_read_all` — SELECT, `true`.
**Triggers:** sub_industries_set_updated_at
**Indexes:** pkey · unique(industry_id, name) · sub_industries_industry_id_idx

### 1.3 Views (4 — all SECURITY DEFINER, partner-facing anonymisation surfaces)

| View | Columns exposed | Purpose |
|---|---|---|
| partner_funder_industry_appetite | industry_id, industry_name, funder_display_name, appetite_level | Anonymised appetite matrix (no funder_id / real name / notes) |
| partner_leads_view | id, business_name, industry_id, sub_industry_id, sector_notes, funding_amount, funding_purpose, funding_timeline, qualification_stage, referred_by, referral_partner_id, original_referrer_id, created_at, updated_at, not_qualified_reason | Partner's own leads, PII-excluded |
| partner_stakeholders_view | id, client_id, lead_id, full_name, roles, shareholding_percent | FICA transparency, PII-excluded |
| partner_submission_view | id, deal_id, funder_display_name, status, decline_reason_category | Partner deal timeline (fictional funder name only) |

> All 4 flagged ERROR-level `security_definer_view` by Supabase advisors (see §9).

---

## 2. LIVE RPCs / FUNCTIONS (SECURITY DEFINER)

58 SECURITY DEFINER functions live. Below, the **caller-facing RPCs** (granted to `authenticated`) are separated from **trigger/internal DEFINER functions** (not directly callable meaningfully, or granted only to `postgres`/`service_role`). Guard columns read from function bodies via live introspection.

Legend: **Adv** = holds `pg_advisory_xact_lock`. **Idem** = idempotency guard present (ON CONFLICT / existing-row short-circuit / dedup). **State** = raises on illegal state / guards transitions. **Owner** = `is_owner()` gate at entry.

### 2.1 Owner/caller-facing RPCs (EXECUTE granted to `authenticated`)

| RPC | Signature → returns | Adv | Idem | State | Owner | One-line |
|---|---|:--:|:--:|:--:|:--:|---|
| qualify_lead | (p_lead_id uuid, p_override bool) → jsonb | No | Yes | Yes | Yes | Atomic lead→client+deal qualify with doc gate + override |
| write_commission_record | (p_deal_id uuid) → jsonb | Yes | Yes | Yes | Yes | Writes commission ledger row on genuine funding |
| generate_funder_invoice | (p_submission_id, p_finance_charge, p_contract_ref, p_notes) → jsonb | Yes | Yes | Yes | Yes | Creates draft funder invoice, snapshots rate |
| issue_funder_invoice | (p_invoice_id) → jsonb | Yes | No | Yes | Yes | draft→issued, fires PDF + notification, advances deal |
| mark_funder_invoice_paid | (p_invoice_id, p_paid_amount, p_payment_reference) → jsonb | Yes | No | Yes | Yes | issued/overdue→paid |
| void_funder_invoice | (p_invoice_id, p_override text, p_reason) → jsonb | Yes | No | Yes | Yes | Void invoice (issued→void needs OVERRIDE) |
| update_draft_invoice | (p_invoice_id, p_description, p_notes) → jsonb | Yes | No | Yes | Yes | Edit draft invoice text |
| set_document_verification | (p_document_id, p_status, p_reason, p_notes) → uuid | No | No | Yes | Yes | Accept/reject/reset a document + audit log |
| add_bonus | (p_deal_id, p_submission_id, p_referral_partner_id, p_bonus_amount, p_bonus_reason) → jsonb | Yes | Yes | Yes | Yes | Add discretionary partner bonus |
| void_bonus | (p_bonus_id, p_override text, p_reason) → jsonb | Yes | No | Yes | Yes | Void a bonus (OVERRIDE past settled) |
| transition_commission_record | (p_commission_record_id, p_to commission_state, p_funder_invoice_id) → jsonb | Yes | Yes | Yes | Yes | Move commission lifecycle state |
| transition_bonus_record | (p_bonus_id, p_to commission_state, p_funder_invoice_id) → jsonb | Yes | Yes | Yes | Yes | Move bonus lifecycle state |
| settle_bonus_from_partner_invoice | (p_bonus_id, p_partner_invoice_id) → jsonb | No | No | Yes | No | C4 stub — settle bonus on partner invoice |
| unsettle_bonus_from_partner_invoice | (p_bonus_id, p_partner_invoice_id) → jsonb | No | No | Yes | No | C4 stub — reverse settle |
| stub_settle_from_partner_invoice | (p_commission_record_id, p_partner_invoice_id) → jsonb | No | No | Yes | No | C4 P0002 settle stub |
| stub_unsettle_from_partner_invoice | (p_commission_record_id, p_partner_invoice_id) → jsonb | No | No | Yes | No | C4 P0002 unsettle stub |
| funder_rate_at | (p_funder_id, p_deal_type, p_as_of date) → funder_commission_structures | No | n/a | Yes | Yes | Effective-dated rate lookup |
| funder_shortcode | (p_funder_id) → text | No | n/a | No | No | Funder short code for invoice ref |
| client_shortcode | (p_client_id) → text | No | n/a | No | No | Client short code for invoice ref |
| mark_notification_read | (p_id uuid) → uuid | No | Yes | No | No | Mark one own notification read (returns id) |
| mark_notifications_read | (p_ids uuid[]) → int | No | No | No | No | Mark listed own notifications read (returns count) |
| mark_all_notifications_read | () → int | No | No | No | No | Mark all own read (returns count) |
| is_owner | () → bool | No | n/a | n/a | — | Role check helper (owner gate everywhere) |
| current_partner_id | () → uuid | No | n/a | n/a | No | Caller's referral_partner_id (partner scoping) |

> Non-owner-gated RPCs above (funder_shortcode / client_shortcode / mark_* / settle stubs / current_partner_id) either scope to `auth.uid()` internally, are pure lookups, or are C4-lifecycle stubs not yet wired to a UI. `set_document_verification` and `funder_rate_at` are owner-gated.

### 2.2 Trigger & internal DEFINER functions (not directly caller-invoked)

`bonus_cascade_on_invoice_state`, `commission_cascade_on_invoice_state`, `deals_write_commission_on_funded`, `submissions_write_commission_on_funded`, `documents_apply_versioning` (Adv: yes), `documents_prevent_audit_rewrite`, `clients_cipc_block`, `leads_cipc_block`, `notify_deal_approved`, `notify_deal_funded`, `notify_commission_paid`, `notify_bonus_paid`, `notify_lead_created_for_you`, `notify_lead_events`, `notify_lead_document_rejected`, `deals_log_stage`, `log_activity`, `handle_new_user`, `rls_auto_enable` (event trigger auto-enabling RLS on new tables).

**Sweep / helper DEFINER functions (granted `postgres`/`service_role` only):** `check_document_expiries` (ON CONFLICT dedup), `check_followups_due` (ON CONFLICT dedup), `check_overdue_invoices`, `mark_expired_documents`, `document_expiry_due`, `followups_due`, `emit_in_app_notification`, `invoke_send_notification_email`, `invoke_generate_invoice_pdf`, `log_invoice_activity`, `log_qualification_override`, `funder_display_name`, `notify_owner`, `notify_recipient`, `partner_profile_id`.

### 2.3 Notable NON-DEFINER functions (SECURITY INVOKER)

- `calculate_commission(numeric, boolean) → commission_breakdown` — **IMMUTABLE**, `SET search_path=''`. The locked commission engine (see §8). Not DEFINER (pure math, no table access).
- `commission_tier_pct(numeric, boolean) → numeric` — IMMUTABLE tier band selector (§8).
- `fnc_gross_commission(rate_type, rate_fraction, flat_amount, amount_funded, finance_charge) → numeric` — IMMUTABLE C0 rate→gross.
- `find_lead_duplicates(...)`, `find_client_duplicates(...)` — STABLE duplicate-detection (server-side similarity; threshold not in client).
- `lead_required_docs_missing(p_lead_id) → text[]` — STABLE qualification-gate rule.
- `reopen_deal(p_deal_id, p_stage)` — deliberate Declined revival.
- `current_sast_date() → date` — SAST-native date for sweeps.
- `document_default_expiry`, `document_type_category`, `document_type_is_period_scoped`, `document_type_label` — IMMUTABLE taxonomy helpers.
- `suggest_client_short_code`, `commission_records_recompute` (trigger), plus `set_updated_at`, `client_stakeholders_touch`, `deals_before_write`, `deals_block_declined_reopen`, `deals_auto_decline_on_last_submission`, `funder_invoices_state_guard`, `enforce_rate_funder_contracted`, `bonus_records_immutable_when_settled`, `leads_qualification_guard` (all triggers).
- (~140 `gbt_*` / `gbtreekey*` / `*_dist` functions belong to the `btree_gist` extension — infrastructure, not app code.)

---

## 3. LIVE EDGE FUNCTIONS

| Name | Version | Status | verify_jwt | Auth model | What it does |
|---|---:|---|:--:|---|---|
| send-notification-email | 12 | ACTIVE | false | `X-Webhook-Secret` header (Vault-stored); `RESEND_API_KEY` env | Sends branded Resend email for allow-listed events; writes notification_deliveries email rows |
| generate-invoice-pdf | 6 | ACTIVE | false | webhook-secret style (invoked via pg_net) | Renders branded funder-invoice PDF (jsPDF) into `invoices` bucket |
| sign-invoice-url | 2 | ACTIVE | false | (invoked server-side) | Produces a signed URL for a stored invoice PDF |
| pdflibtest | 6 | ACTIVE | true | JWT | Test/scratch PDF function (not a production path) |
| ops-storage-remove | 2 | ACTIVE | true | JWT | Ops utility to remove storage objects |

Notes: `send-notification-email` was redeployed v11→v12 from `main`; its footer address reads **73 Marshall Street** in the deployed source (verified in-repo). `sign-invoice-url`, `pdflibtest`, `ops-storage-remove` are not documented as feature paths in ROADMAP/SPEC (see §9).

---

## 4. LIVE pg_cron JOBS

All schedules UTC (SAST = UTC+2). All three active; every run to date succeeded.

| Job | Schedule (UTC / SAST) | Command | Last successful run | Runs (ok/total) | What it does |
|---|---|---|---|:--:|---|
| document-expiry-sweep | `0 4 * * *` / 06:00 | `select public.check_document_expiries();` | 2026-07-31 04:00 UTC | 13/13 | Emits DOCUMENT_EXPIRING_30D/_7D/EXPIRED, auto-marks expired |
| call-followup-sweep | `15 4 * * *` / 06:15 | `select public.check_followups_due();` | 2026-07-31 04:15 UTC | 12/12 | Emits FOLLOW_UP_DUE from call_logs follow-ups |
| invoice-overdue-sweep | `30 4 * * *` / 06:30 | `select public.check_overdue_invoices();` | 2026-07-31 04:30 UTC | 10/10 | Flags issued invoices overdue → INVOICE_OVERDUE |

> Sweeps compare using `current_sast_date()` internally (SAST-native) even though pg_cron fires in UTC.

---

## 5. FRONTEND ROUTES (src/App.tsx)

All routes in a single router (`src/App.tsx`, `AppRoutes`). No nested routers, no route-config files, **no partner/* routes yet**. 26 `<Route>` entries: 1 public index, 24 owner-gated pages, 1 catch-all.

| Path | Component | Guard | Purpose |
|---|---|---|---|
| `/` | AuthPage (→ /dashboard if signed in) | None (public) | Login / auth landing |
| `/dashboard` | DashboardPage | OwnerGate | Owner dashboard / overview |
| `/pipeline` | PipelinePage | OwnerGate | Deal pipeline kanban |
| `/deals/:id` | DealDetailPage | OwnerGate | Single deal detail |
| `/invoices` | InvoicesPage | OwnerGate | Funder-invoice list |
| `/invoices/:id` | InvoiceDetailPage | OwnerGate | Single invoice detail |
| `/leads` | LeadsPage | OwnerGate | Lead list |
| `/leads/new` | LeadFormPage | OwnerGate | Create lead |
| `/leads/:id` | LeadDetailPage | OwnerGate | Lead detail |
| `/leads/:id/edit` | LeadFormPage | OwnerGate | Edit lead |
| `/clients` | ClientsPage | OwnerGate | Client list |
| `/clients/new` | ClientFormPage | OwnerGate | Create client |
| `/clients/:id` | ClientDetailPage | OwnerGate | Client detail |
| `/clients/:id/edit` | ClientFormPage | OwnerGate | Edit client |
| `/documents` | DocumentsPage | OwnerGate | Global documents view |
| `/funders` | FundersPage | OwnerGate | Funder list |
| `/funders/new` | FunderFormPage | OwnerGate | Create funder |
| `/funders/:id` | FunderDetailPage | OwnerGate | Funder detail |
| `/funders/:id/edit` | FunderFormPage | OwnerGate | Edit funder |
| `/calculator` | CalculatorPage | OwnerGate | Commission calculator |
| `/activity` | ActivityPage | OwnerGate | Activity timeline / audit |
| `/notifications` | NotificationsPage | OwnerGate | Notification center |
| `/settings/notifications` | NotificationPreferencesPage | OwnerGate | Notification prefs |
| `/settings/industries` | IndustriesPage | OwnerGate | Industry taxonomy + appetite matrix |
| `/settings/funders` | FundersSettingsPage | OwnerGate | Funder rate/billing settings |
| `*` | `<Navigate to="/" replace/>` | None | 404 → redirect to `/` |

**Guard mechanics:** Two-tier. (1) Session check in `App.tsx` via `useSession()` — no session → `<Navigate to="/">`. (2) Role check in `OwnerGate` (`src/components/layout/OwnerGate.tsx`) via `useProfileRole()` querying `profiles.role`; only `role === 'owner'` renders `<AppLayout/>` (whose `<Outlet/>` hosts the 24 child pages); any other authenticated user gets an "Owner access only" card. **No PartnerGate / RequireOwner / ProtectedRoute component exists** — the partner portal is a documented future phase; RLS is the real backstop.

---

## 6. USER-FACING STATE-CHANGING BUTTONS

Every control that CREATES or TRANSITIONS state (a DB insert/update/delete or a mutating RPC). "UI disable" = the trigger control is disabled while its mutation is in flight. "DB advisory lock" from §2 (only mutating RPCs can hold one; plain table writes rely on RLS + uniqueness indexes + optimistic row-count checks). Risk = likelihood of an accidental duplicate/double-fire (HIGH = destructive + no UI guard + no confirm; MEDIUM = un-guarded but idempotent/optimistic or non-destructive; LOW = guarded).

### 6.1 Leads
| Button | File:line | RPC / DB op | UI disable | DB adv-lock | Risk |
|---|---|---|:--:|:--:|:--:|
| Add lead / Save changes | LeadFormPage.tsx:602 | insert/update `leads` | Yes (`submitting\|\|checking`) | n/a (CIPC unique + trigger block) | LOW |
| Save anyway (dup gate) | LeadFormPage.tsx:584 | insert/update `leads` | Yes (`submitting` + type SAVE) | n/a | LOW |
| Start Qualifying | LeadDetailPage.tsx:257 | update `leads.qualification_stage` | Yes (`isPending`) | n/a | LOW |
| Qualify & create deal / Override | LeadDetailPage.tsx:385 | RPC `qualify_lead` | Yes (`pending\|\|!canProceed`) | No (one-deal-per-lead unique + short-circuit) | LOW |
| Confirm not qualified | LeadDetailPage.tsx:455 | update `leads` | Yes (`isPending`) | n/a | LOW |

### 6.2 Clients
| Button | File:line | RPC / DB op | UI disable | Risk |
|---|---|---|:--:|:--:|
| Add / Save client | ClientFormPage.tsx:415 | insert/update `clients` | Yes (`submitting\|\|checking`) | LOW |
| Save anyway (dup gate) | ClientFormPage.tsx:397 | insert/update `clients` | Yes (`submitting` + type SAVE) | LOW |
| Save/Add contact | ContactsManager.tsx:237 | insert/update `client_contacts` | Yes (`save.isPending`) | LOW |
| **Delete contact (trash)** | ContactsManager.tsx:123 | delete `client_contacts` | **No** (no confirm) | **HIGH** |

### 6.3 Client story & call logs
| Button | File:line | RPC / DB op | UI disable | Risk |
|---|---|---|:--:|:--:|
| Save story | StoryPanel.tsx:125 | upsert `client_stories` | Yes (`save.isPending`) | LOW |
| Add impression | StoryPanel.tsx:179 | insert `client_story_notes` | Yes (`add.isPending\|\|!text`) | LOW |
| Log call | CallLogPanel.tsx:140 | insert `call_logs` | Yes (`!canSave`) | LOW |

### 6.4 Stakeholders
| Button | File:line | RPC / DB op | UI disable | Risk |
|---|---|---|:--:|:--:|
| Add / Save stakeholder | StakeholdersPanel.tsx:432 | insert/update `client_stakeholders` | Yes (`save.isPending`) | LOW |
| Remove stakeholder (trash) | StakeholdersPanel.tsx:214 | delete `client_stakeholders` | Yes (`del.isPending`) + confirm | LOW |

### 6.5 Documents
| Button | File:line | RPC / DB op | UI disable | DB adv-lock | Risk |
|---|---|---|:--:|:--:|:--:|
| Upload document | DocumentsPanel.tsx:190 | storage upload + insert `documents` | Yes (`!canUpload`) | versioning trigger holds adv-lock | LOW |
| **Delete document (trash)** | DocumentList.tsx:99 | delete `documents` + storage remove | **No** | No | **HIGH** |
| Accept | DocumentList.tsx:180 | RPC `set_document_verification` | Yes (`busy`) | No | LOW |
| Confirm reject | DocumentList.tsx:162 | RPC `set_document_verification` | Yes (`busy`) | No | LOW |
| Reset | DocumentList.tsx:200 | RPC `set_document_verification` | Yes (`busy`) | No | LOW |

### 6.6 Pipeline & deal detail
| Button | File:line | RPC / DB op | UI disable | Risk |
|---|---|---|:--:|:--:|
| Create deal | NewDealDialog.tsx:112 | insert `deals` | Yes (`isSubmitting`) | LOW |
| Kanban stage change (drag) | PipelinePage.tsx:91 | update `deals.stage` | **No** (optimistic + row-count) | MEDIUM |
| Stage `<select>` dropdown | DealDetailPage.tsx:155 | update `deals.stage` | **No** (optimistic + row-count) | MEDIUM |
| Mark priority toggle | DealDetailPage.tsx:125 | update `deals.is_priority` | **No** | MEDIUM |
| Save notes | DealDetailPage.tsx:182 | update `deals.notes` | Yes (`isPending`) | LOW |
| Yes, reopen (declined) | DealDetailPage.tsx:238 | RPC `reopen_deal` | Yes (`reopen.isPending`) | LOW |

### 6.7 Funder submissions & communications
| Button | File:line | RPC / DB op | UI disable | Risk |
|---|---|---|:--:|:--:|
| Add / Save submission | FunderSubmissions.tsx:300 | insert/update `deal_funder_submissions` | Yes (`isSubmitting`) | LOW |
| **Delete submission (trash)** | FunderSubmissions.tsx:120 | delete `deal_funder_submissions` | **No** (no confirm) | **HIGH** |
| Save communication | CommunicationsLog.tsx:90 | insert `communications` | Yes (`isSubmitting`) | LOW |

### 6.8 Invoices (all RPC-backed, all advisory-locked in DB)
| Button | File:line | RPC | UI disable | DB adv-lock | Risk |
|---|---|---|:--:|:--:|:--:|
| Generate draft invoice | DealInvoices.tsx:369 | `generate_funder_invoice` (+update submission finance_charge) | Yes (`!canGenerate\|\|isPending`) | **Yes** | LOW |
| Save changes (draft) | InvoiceActions.tsx:115 | `update_draft_invoice` | Yes (`isPending`) | **Yes** | LOW |
| Yes, issue | InvoiceActions.tsx:147 | `issue_funder_invoice` | Yes (`isPending`) | **Yes** | LOW |
| Confirm payment | InvoiceActions.tsx:196 | `mark_funder_invoice_paid` | Yes (`isPending`) | **Yes** | LOW |
| Void invoice | InvoiceActions.tsx:254 | `void_funder_invoice` | Yes (`isPending`) | **Yes** | LOW |

### 6.9 Funders & rates
| Button | File:line | RPC / DB op | UI disable | Risk |
|---|---|---|:--:|:--:|
| Add / Save funder | FunderFormPage.tsx:242 | insert/update `funders` | Yes (`submitting`) | LOW |
| Save partner display name | FunderDetailPage.tsx:189 | update `funders.display_name_for_partner` | Yes (`isPending`) | LOW |
| Add funder contact | FunderDetailPage.tsx:334 | insert `funder_contacts` | Yes (`isPending`) | LOW |
| **Delete funder contact (trash)** | FunderDetailPage.tsx:290 | delete `funder_contacts` | **No** (no confirm) | **HIGH** |
| Contracted toggle | FundersSettingsPage.tsx:179 | update `funders.is_contracted` | Yes (`isPending`) + confirm | LOW |
| Save short code | FundersSettingsPage.tsx:327 | update `funders.short_code` | Yes (`!dirty\|\|isPending`) | LOW |
| Add / Save rate | FundersSettingsPage.tsx:648 | insert/update `funder_commission_structures` | Yes (`save.isPending`) | LOW |
| Delete rate | FundersSettingsPage.tsx:636 | delete `funder_commission_structures` | Yes (`del.isPending`) + confirm | LOW |

### 6.10 Industries
| Button | File:line | RPC / DB op | UI disable | Risk |
|---|---|---|:--:|:--:|
| Add industry | IndustriesPage.tsx:100 | insert `industries` | Yes (`isPending\|\|!name`) | LOW |
| Add sub-industry | IndustriesPage.tsx:201 | insert `sub_industries` | Yes (`isPending\|\|!name`) | LOW |
| Industry Active toggle | IndustriesPage.tsx:153 | update `industries.active` | **No** | MEDIUM |
| Sub-industry chip toggle | IndustriesPage.tsx:167 | update `sub_industries.active` | **No** | MEDIUM |
| Save appetite | IndustriesPage.tsx:433 | upsert `funder_industry_preferences` | Yes (`upsert.isPending`) | LOW |
| Clear appetite | IndustriesPage.tsx:417 | delete `funder_industry_preferences` | Yes (`!current\|\|isPending`) | LOW |

### 6.11 Notifications
| Button | File:line | RPC | UI disable | Risk |
|---|---|---|:--:|:--:|
| Item click (mark read) | NotificationBell.tsx:90 | `mark_notification_read` | **No** (idempotent, gated `!read_status`) | LOW |
| Mark all read (bell) | NotificationBell.tsx:70 | `mark_all_notifications_read` | **No** (idempotent) | LOW |
| Mark selected read | NotificationsPage.tsx:52 | `mark_notifications_read` | **No** in-flight (only selection-size guard) | LOW |
| Mark all read (page) | NotificationsPage.tsx:60 | `mark_all_notifications_read` | **No** (idempotent) | LOW |
| Channel pref toggle | NotificationPreferencesPage.tsx:62 | upsert `notification_preferences` | Yes (per-cell `isPending`) | LOW |

**Summary:** every form-submit and modal-confirm write in the app is `isPending`/`isSubmitting`-guarded. All five money-mutating invoice RPCs also hold a DB advisory lock (belt-and-braces). The **un-guarded controls** are the four destructive **delete-by-trash** buttons (§6.2/6.5/6.7/6.9 — three with no confirm dialog), the deal stage/priority controls (optimistic, non-destructive), the two industry active toggles, and the mark-read RPCs (idempotent). See §9.1.

---

## 7. NOTIFICATION EVENT TYPES

### 7.1 `notification_event_type` enum — 30 values (live)

`LEAD_CREATED_FOR_YOU, LEAD_SUBMITTED_BY_PARTNER, LEAD_QUALIFICATION_UPDATED, DEAL_SUBMITTED_TO_FUNDER, DEAL_APPROVED, DEAL_DECLINED, DEAL_FUNDED, COMMISSION_PAID, FUNDER_RESPONSE_RECEIVED, CLIENT_MESSAGE_RECEIVED, FOLLOW_UP_DUE, BADGE_EARNED, MONTHLY_TARGET_MILESTONE, TIER_REVIEW_UPCOMING, FUNDER_RATE_CONFIRMED, DOCUMENT_UPLOADED, SYSTEM_MAINTENANCE, WEEKLY_SUMMARY, LEAD_QUALIFIED, LEAD_NOT_QUALIFIED, LEAD_STARTED_QUALIFICATION, LEAD_UPDATED, DOCUMENT_EXPIRING_30D, DOCUMENT_EXPIRING_7D, DOCUMENT_EXPIRED, LEAD_DOCUMENT_REJECTED, FUNDER_INVOICE_ISSUED, INVOICE_OVERDUE, INVOICE_MARKED_PAID, BONUS_PAID`

### 7.2 Event → trigger → email template → in-app mapping

Email template variant per `send-notification-email` S16 tone map. In-app label/icon from `src/lib/notifications.ts` (only 17 events mapped there; the rest fall back to the raw enum string as label + `Bell` icon — see §9).

| Event | Fired by | Email variant | In-app label · icon |
|---|---|---|---|
| DEAL_APPROVED | `notify_deal_approved` (submission→approved) | deal_approved | "Deal approved" · CheckCircle2 |
| DEAL_FUNDED | `notify_deal_funded` (deal stage→funded) | deal_funded (reuses deal_approved) | "Deal funded" · PartyPopper |
| COMMISSION_PAID | `notify_commission_paid` (commission status) | commission_paid | "Commission paid" · Banknote |
| BONUS_PAID | `notify_bonus_paid` (bonus state→settled) | commission_paid (money tone) | **unmapped → raw string · Bell** |
| LEAD_CREATED_FOR_YOU | `notify_lead_created_for_you` (lead INSERT loaded-on-behalf) | welcome | "Lead created for you" · UserPlus |
| LEAD_STARTED_QUALIFICATION | `notify_lead_events` (UPDATE) | (owner-only, email off) | **unmapped → raw string · Bell** |
| LEAD_QUALIFIED | `notify_lead_events` | deal_approved | **unmapped → raw string · Bell** |
| LEAD_NOT_QUALIFIED | `notify_lead_events` | deal_approved/welcome | **unmapped → raw string · Bell** |
| LEAD_UPDATED | `notify_lead_events` (owner only) | (email off) | **unmapped → raw string · Bell** |
| LEAD_DOCUMENT_REJECTED | `notify_lead_document_rejected` (doc→rejected) | weekly_summary | **unmapped → raw string · Bell** |
| DOCUMENT_EXPIRING_30D / _7D / EXPIRED | `check_document_expiries()` cron | weekly_summary | **unmapped → raw string · Bell** |
| FOLLOW_UP_DUE | `check_followups_due()` cron | weekly_summary | "Follow-up due" · Clock |
| FUNDER_INVOICE_ISSUED | `issue_funder_invoice` RPC | deal_approved | **unmapped → raw string · Bell** |
| INVOICE_MARKED_PAID | `mark_funder_invoice_paid` RPC | commission_paid | **unmapped → raw string · Bell** |
| INVOICE_OVERDUE | `check_overdue_invoices()` cron | weekly_summary | **unmapped → raw string · Bell** |
| DEAL_SUBMITTED_TO_FUNDER | (no live trigger) | — | "Deal submitted to funder" · Send |
| DEAL_DECLINED | (no live trigger emitting it) | — | "Deal declined" · XCircle |
| DOCUMENT_UPLOADED | (enum exists, **no trigger emits it**) | — | "Document uploaded" · FileText |
| BADGE_EARNED | (Phase F, not wired) | — | "Badge earned" · Award |
| LEAD_SUBMITTED_BY_PARTNER, LEAD_QUALIFICATION_UPDATED, FUNDER_RESPONSE_RECEIVED, CLIENT_MESSAGE_RECEIVED, MONTHLY_TARGET_MILESTONE, TIER_REVIEW_UPCOMING, FUNDER_RATE_CONFIRMED, SYSTEM_MAINTENANCE, WEEKLY_SUMMARY | (no live trigger) | — | mixed: some mapped label+Bell, most raw+Bell |

**In-app mapping source (`src/lib/notifications.ts`):** 17 events carry an explicit label; `EVENT_ICON` maps 9 to lucide icons (UserPlus, Send, CheckCircle2, XCircle, PartyPopper, Banknote, Clock, Award, FileText); all others → `Bell`. Icon color: DEAL_FUNDED/COMMISSION_PAID→green, DEAL_APPROVED→teal, DEAL_DECLINED→red, else navy. Any event absent from the label map renders its raw enum string.

---

## 8. COMMISSION CALCULATION LOGIC (current live state)

### 8.1 Single source of truth — DB `calculate_commission()`

`public.calculate_commission(gross_commission numeric, is_purchase_order boolean)` — IMMUTABLE, `SET search_path=''`, returns `commission_breakdown` (tier_pct, company_retention, partner_pool, partner_share, owner_share). Live body:
- `company_retention = round(gross * 0.40, 2)`
- `partner_pool = gross − company_retention` (i.e. 60%)
- `tier_pct = commission_tier_pct(gross, is_purchase_order)`
- `partner_share = round(pool * tier_pct, 2)`
- `owner_share = pool − partner_share`
- Guard: raises if gross null or < 0. (Three outputs always sum to gross — enforced additionally by `commission_records_sums_ck`.)

**Tier bands — live `commission_tier_pct()`** (the ONLY place tier % + band thresholds are computed):
```
is_purchase_order            → 0.40   (flat, ALL PO deals)
gross <=  80000              → 0.29
gross <= 150000              → 0.30
gross <= 500000              → 0.33
else (gross > 500000)        → 0.25
```

**FNC gross from funder rate — live `fnc_gross_commission()`** (C0):
- `percent_of_gross_funded` → rate_fraction × amount_funded
- `percent_of_finance_charge` → rate_fraction × finance_charge
- `flat_rand_per_deal` → flat_amount
- `percent_of_mdr` → **raises "not supported yet"** (deferred to first MCA deal)

### 8.2 Where FNC gross / partner share is computed

- **DB (authoritative):** `calculate_commission` (partner split) + `fnc_gross_commission` (gross from rate) + `commission_records_recompute` trigger (server-side recompute on save) + `write_commission_record` / `submissions_write_commission_on_funded` / `deals_write_commission_on_funded` (ledger write on genuine funding) + `generate_funder_invoice` (funder-invoice commission, snapshots rate).
- **Frontend (display only, no math re-implemented):** `useCalculateCommission()` (`src/hooks/useDealDetail.ts:279`) calls the `calculate_commission` RPC; consumed by `CommissionBreakdownView.tsx`, `CommissionSplitChart.tsx`, `CalculatorPage.tsx`, `FunderSubmissions.tsx`. `src/lib/invoices.ts:259-288` computes an invoice-preview commission **client-side as a documented mirror** of `generate_funder_invoice`, but pulls `rate_fraction`/`flat_amount` from `funder_commission_structures` rows — no hard-coded rates.

### 8.3 `funder_rate_type` enum + which funders use each (live `funder_commission_structures`, 6 rows)

Enum values: `percent_of_gross_funded`, `percent_of_mdr`, `flat_rand_per_deal`, `percent_of_finance_charge`. (`percent_of_revenue` for Merchant Capital is **not** in the enum — S7B future work.)

| Funder | is_contracted | deal_type | rate_type | rate | effective_from | terms |
|---|:--:|---|---|---|---|---|
| Pollen Finance | true | non_po | percent_of_finance_charge | 10.00% | 2026-04-28 | 0 (on receipt) |
| Merchant Capital | true | non_po | percent_of_gross_funded | 3.50% | 2026-07-20 | 14 days |
| Flow48 | true | non_po | percent_of_gross_funded | 2.50% | 2026-07-21 | 0 |
| Business Partners | true | non_po | percent_of_gross_funded | 1.00% | 2026-07-21 | 0 |
| Lula | **false** | non_po | percent_of_gross_funded | 1.00% | 2026-07-21 | 0 |
| RM Capital | **false** | non_po (row) / po | flat_rand_per_deal | R5,000 | 2026-07-20 | 0 |

Rate-type usage: `percent_of_gross_funded` → Merchant Capital, Flow48, Business Partners, Lula. `percent_of_finance_charge` → Pollen Finance. `flat_rand_per_deal` → RM Capital. `percent_of_mdr` → **used by none** (raises if invoked).

### 8.4 Hard-coded percentages/thresholds in code

- **DB (authoritative, intended):** `0.40` retention + `0.29/0.30/0.33/0.25/0.40` tiers + band thresholds `80000/150000/500000` — all inside `calculate_commission` / `commission_tier_pct`.
- **Frontend duplicate (display-only, drift risk):** `src/lib/funders.ts:60-70` `COMMISSION_STRUCTURE` — hard-codes `companyRetention 0.4`, `partnerPool 0.6`, tier pcts `0.4/0.29/0.3/0.33/0.25`, and band amounts (80,000/150,000/500,000) inside label strings. Reference display on FunderDetailPage; drives no math but is an un-synced mirror of the DB engine.
- **Frontend regulatory constant:** `src/lib/stakeholders.ts:37` `BENEFICIAL_OWNER_THRESHOLD = 25` (FICA ≥25%).
- **Not hard-coded client-side (confirmed):** the 0.75 duplicate-similarity threshold (server-side in `find_lead_duplicates`/`find_client_duplicates`), per-funder rates (read from `funder_commission_structures`).

---

## 9. REAL GAPS / DRIFT FOUND DURING INVENTORY

Facts only — deviations between live state and SPEC/CLAUDE/ROADMAP, and structural exposure points. No recommendations.

### 9.1 Idempotency / double-action exposure
- **Buttons that CAN be double-fired (no in-flight UI disable), by exposure:**
  - **HIGH — destructive, un-guarded, no confirm dialog:** Delete client contact (`ContactsManager.tsx:123`), Delete funder submission (`FunderSubmissions.tsx:120`), Delete funder contact (`FunderDetailPage.tsx:290`).
  - **HIGH — destructive, un-guarded (has cascade to storage):** Delete document (`DocumentList.tsx:99`) — deletes `documents` row + removes storage object, no `disabled`, no confirm.
  - **MEDIUM — un-guarded but non-destructive / optimistic-with-rollback:** Kanban drag stage change (`PipelinePage.tsx:91`), Stage `<select>` (`DealDetailPage.tsx:155`), Mark-priority toggle (`DealDetailPage.tsx:125`), Industry Active toggle (`IndustriesPage.tsx:153`), Sub-industry chip toggle (`IndustriesPage.tsx:167`).
  - **LOW — un-guarded but idempotent RPCs:** mark_notification_read / mark_notifications_read / mark_all_notifications_read (bell + `/notifications`).
- **DB-side money RPCs are well-guarded:** every commission/bonus/invoice-mutating RPC (`generate_funder_invoice`, `issue_funder_invoice`, `mark_funder_invoice_paid`, `void_funder_invoice`, `update_draft_invoice`, `add_bonus`, `void_bonus`, `transition_commission_record`, `transition_bonus_record`, `write_commission_record`) holds a `pg_advisory_xact_lock`. Uniqueness backstops exist: `funder_invoices_one_active_uq`, `commission_records_submission_unique`, `bonus_records_dedup_uq` (all partial, excluding void).
- **`qualify_lead` has NO advisory lock** but relies on `deals_lead_id_unique_idx` (one-deal-per-lead partial unique) + existing-deal short-circuit for idempotency.
- **`set_document_verification` and `mark_notifications_read`/`mark_all_notifications_read` have no advisory lock** (mark-read RPCs return affected-row counts instead; verification is a single-row owner update).

### 9.2 RLS coverage
- **All 29 tables have RLS enabled** — no table is missing RLS. `rls_auto_enable` event trigger auto-enables RLS on any new table.
- **4 views are SECURITY DEFINER** (`partner_*`) — flagged ERROR by Supabase `security_definer_view` advisor (views run with definer privileges, bypassing the querying user's RLS). They are the intended partner-anonymisation surfaces but carry the advisory.

### 9.3 SECURITY DEFINER / search_path advisories
- **`leads_qualification_guard`** is the one function flagged `function_search_path_mutable` (no `SET search_path`). All other app functions set it.
- **19 DEFINER functions executable by `anon`, 38 by `authenticated`** (Supabase advisors `anon_/authenticated_security_definer_function_executable`). The caller-facing RPCs self-gate with `is_owner()` / `auth.uid()` scoping; the trigger functions granted to anon are not meaningfully directly callable.
- **`auth_leaked_password_protection` disabled** (Auth advisor WARN).
- **Extensions in `public`:** `btree_gist`, `pg_net` (advisor WARN `extension_in_public`).

### 9.4 Data-vs-policy drift
- **Non-contracted funders carry rate structures.** `funder_commission_structures` holds rows for **Lula** and **RM Capital**, both `is_contracted = false`. SPEC S1 C0.3 states only contracted funders may carry rate rows (enforced by `enforce_rate_funder_contracted`). Live data contradicts the locked rule (rows likely predate the flag being set false, or seeded before the gate).
- **Merchant Capital live rate = 3.50% `percent_of_gross_funded`**, but SPEC S7B.1 specifies its real structure is `percent_of_revenue` 10%/5% (first/subsequent). The live rate is a placeholder pending the `percent_of_revenue` enum + first-vs-subsequent logic (S7B future work). No `percent_of_revenue` value exists in the enum yet.
- **`RM Capital` has a `non_po` row with `flat_rand_per_deal`** while SPEC framing put its flat rate under `po`; the live `deal_type` on the joined structure shows `po` — captured verbatim above.

### 9.5 Commission engine vs SPEC S7C (known G7 items)
- **Flat 40% applies to ALL PO deals** in `commission_tier_pct` (`is_purchase_order → 0.40`), but SPEC S7C scopes flat-40% to **Sourcefin PO only**. Live code does not distinguish funder.
- **R1,000,001+ band = 0.25** in code (falls into the `else` branch), but SPEC S7C marks R1M+ as **"TBD — owner to confirm"**. Live function has no separate R1M+ tier.
- Frontend `COMMISSION_STRUCTURE` (funders.ts) is a second hard-coded copy of the tier table (§8.4) that will drift if the DB engine changes.

### 9.6 Notification frontend mapping gap
- **13 of 30 `notification_event_type` values are unmapped in `src/lib/notifications.ts`** — they render the raw enum string as the label and fall back to the `Bell` icon (BONUS_PAID, all LEAD_* qualification-lifecycle events, LEAD_DOCUMENT_REJECTED, all DOCUMENT_EXPIRING_*/EXPIRED, all three INVOICE_* events, etc.). In-app delivery still works; only the label/icon is generic. (Matches the pending status.md finding #3 re BONUS_PAID/MISMATCH.)
- **`DOCUMENT_UPLOADED`** enum value exists but **no trigger emits it** (per SPEC S4). Several other enum values (LEAD_SUBMITTED_BY_PARTNER, FUNDER_RESPONSE_RECEIVED, CLIENT_MESSAGE_RECEIVED, MONTHLY_TARGET_MILESTONE, TIER_REVIEW_UPCOMING, FUNDER_RATE_CONFIRMED, BADGE_EARNED, SYSTEM_MAINTENANCE, WEEKLY_SUMMARY, LEAD_QUALIFICATION_UPDATED) have no live emitter (reserved for future phases).

### 9.7 Documentation drift (docs say X, live says Y)
- **Funder count:** live `funders` = **23**; CLAUDE.md still says "21 funders" / "schema+RLS+engine+21 funders" in several places, while SPEC S1 was updated to 23 (Spartan + AAA Consortium added). Live matches SPEC (23), not the CLAUDE.md headline count.
- **Email footer address:** SPEC S16.3 / S7B.4 note "the live `send-notification-email` footer still reads 75 Marshall Street." **Live deployed source reads `73 Marshall Street`** (both HTML L441 and text L524) — the fix landed (v12) and the SPEC note is now stale.
- **`deal_funder_submissions.status` is `text`, not an enum** — unlike most status/state columns which are enums (`invoice_state`, `commission_state`, `deal_stage`). Values are constrained only by the decline CHECK, not an enum type.
- **Extra edge functions not in ROADMAP/SPEC feature list:** `sign-invoice-url`, `pdflibtest`, `ops-storage-remove` are deployed and ACTIVE but not described as feature paths in the docs (pdflibtest is evidently a test artifact; ops-storage-remove an ops utility).

### 9.8 Business logic that is data-driven vs hard-coded (state of play)
- **Data-driven (correct):** per-funder rates (`funder_commission_structures`), industry taxonomy, appetite matrix, document taxonomy helpers, duplicate-similarity threshold (server-side).
- **Hard-coded in DB (by design, single source):** the 40/60 split + tier bands (`calculate_commission`/`commission_tier_pct`).
- **Hard-coded in frontend (drift risk, display-only):** `COMMISSION_STRUCTURE` tier mirror (funders.ts), `BENEFICIAL_OWNER_THRESHOLD = 25` (stakeholders.ts).

---

_End of inventory. Read-only; no changes made to code or database._
