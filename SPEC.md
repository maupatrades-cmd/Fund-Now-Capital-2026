# FUND NOW CAPITAL CRM — SPEC.md

Build-ready distillation of master spec Parts 2–6. Build ORDER lives in `ROADMAP.md`. Core rules live in `CLAUDE.md`. **Where this file and CLAUDE.md conflict, CLAUDE.md wins.**

---

## S1. INDUSTRY CLASSIFICATION (Part 2 — Roadmap B1)

Tables:
- `industries`: id, name, description, active bool, sort_order
- `sub_industries`: id, industry_id FK, name, active bool, sort_order
- `funder_industry_preferences`: id, funder_id FK, industry_id FK, appetite_level enum(high/medium/low/avoid), notes. Editable by owner.

Clients + leads get `industry_id` + `sub_industry_id` FKs (multi-select sub allowed via join table if simpler: `entity_sub_industries`). Migrate `clients.sector` free text → keep as `sector_notes`.

Seed — 25 industries (sub-industries in parentheses):
1. Agriculture, Forestry & Farming (Crop farming; Livestock; Poultry; Dairy; Game farming; Aquaculture; Forestry; Horticulture/floriculture; Agri-processing; Farm equipment)
2. Mining & Quarrying (Gold; Platinum; Chrome; Coal; Diamond; Manganese; Iron ore; Copper; Quarrying; Mining services/contract mining; Mining supply; Mining logistics; Tailings/waste)
3. Manufacturing (Food & beverage; Textile & clothing; Furniture; Metal fabrication; Plastic; Chemical; Pharmaceutical; Automotive parts; Building materials; Packaging; Electrical/electronic)
4. Construction & Built Environment (General building; Civil/infrastructure; Roads; Plumbing & electrical; HVAC; Painting & finishing; Roofing; Landscaping; Property development; Interior; Architectural; Quantity surveying; Construction supplies)
5. Retail & Wholesale (General FMCG; Clothing & footwear; Electronics; Furniture & appliance; Automotive retail; Building supplies; Pharmacy; Convenience/spaza; Wholesale distribution; E-commerce; Franchise; Specialty)
6. Food & Beverage / Hospitality (Restaurants; QSR/takeaway; Bakeries; Butcheries; Catering; Coffee shops; Bars & taverns; Hotels; Guest houses/B&Bs; Lodges; Event venues; Food trucks)
7. Transport & Logistics (Road freight/trucking; Courier; Passenger transport; Taxi/e-hailing; Bus; Vehicle rental/fleet leasing; Warehousing; Cold storage; Container logistics; Import/export; 3PL)
8. Professional Services (Legal; Accounting/tax; Financial advisory; Management consulting; HR consulting; Recruitment; Auditing; Business coaching; Compliance; Insurance broking; Real estate services)
9. Technology & IT (Software dev; IT services; Cybersecurity; Web dev; Digital agencies; Cloud; Telecoms; Fintech; E-learning; SaaS)
10. Marketing & Media (Advertising; Marketing consultancies; Digital marketing; Media production; Photography/videography; Graphic design; Publishing; Printing; Signage & branding)
11. Health & Medical (GPs; Specialists; Dental; Physio/rehab; Chiropractic; Optometry; Veterinary; Medical labs; Pharmacies; Hospitals/clinics; Medical supplies; Mental health; Traditional medicine)
12. Education & Training (Private schools; Preschools; Private tertiary; Vocational; Corporate training; Tutoring; Online education; Language schools; Skills development; SETA-accredited)
13. Personal Services (Hair salons; Barbers; Beauty spas; Nail bars; Gyms; Personal training; Massage; Cleaning services; Laundry; Domestic services; Pet grooming; Wellness)
14. Auto & Motoring (New dealerships; Used dealerships; Repair/mechanics; Panel beating; Auto electrical; Tyres & wheels; Detailing/car wash; Auto parts; Vehicle finance intermediaries; Trucking/commercial vehicles)
15. Real Estate (Estate agencies; Property management; Rental agencies; Developers; Commercial; Residential; Valuations; Body corporate)
16. Security & Safety (Guarding; Armed response; CCTV & alarms; Cybersecurity services; Health & safety consulting; Emergency response)
17. Waste & Environmental (Waste collection; Recycling; Waste-to-energy; Environmental consulting; Cleaning contractors)
18. Energy & Utilities (Solar installation; Solar supply; Electrical contracting; Energy consulting; Water/boreholes; Backup power)
19. Sport, Recreation & Entertainment (Gyms/studios; Sports clubs; Recreation centres; Nightclubs/venues; Event management; Music/performing arts; Regulated gambling)
20. Non-Profit & Community (NGOs; Faith-based; Community development; Social enterprise; Co-ops; Foundations)
21. Fashion & Design (Fashion design/boutique; Tailoring; Custom clothing; Accessories/jewellery; Beauty & cosmetics; Traditional wear)
22. Financial Services (Micro-lenders; Insurance underwriting; Investment management; Brokers; Debt collection; Fintech; Payments)
23. Agriculture Value Chain (Fresh produce distribution; Meat processing; Dairy processing; Beverage bottling; Grain milling; Feed manufacturing)
24. Import/Export & Trading (General trading; Import distributors; Export merchants; Freight forwarding; Customs clearing)
25. Other / Emerging (Legal medicinal cannabis; Renewable energy tech; E-commerce marketplaces; Gig platforms; Subscription services; Other — mandatory free-text)

Baseline funder appetite matrix (owner-editable; seed as `funder_industry_preferences`):
- Mining (all subs): HIGH PrefCap, Sourcefin, Business Partners, Paragon · MED RM Capital · AVOID Merchant Capital
- Hospitality/QSR/Restaurants: HIGH Merchant Capital, Pollen, Bridgement · MED Growise, Better Banc, Lula · AVOID PrefCap, Paragon
- Manufacturing: HIGH Business Partners, Bridgement, RM Capital · MED PrefCap, Sourcefin
- Retail: HIGH Merchant Capital, Growise, Better Banc · MED Pollen, Bridgement
- Transport/Logistics: HIGH Sourcefin, Bridgement, PrefCap · MED Business Partners
- Property/Construction: HIGH Paragon, Business Partners, PrefCap · MED Bridgement
- Professional Services: HIGH Bridgement, Better Banc, Lula · MED Growise
- Agriculture: HIGH Business Partners, PrefCap, Growise · MED Sourcefin
- Technology/IT: HIGH Bridgement, Better Banc, Business Partners
- Health/Medical: HIGH Business Partners, Bridgement, Better Banc
- Auto & Motoring: HIGH Centrafin, Sourcefin, PrefCap
- Education/Training: HIGH Business Partners, Bridgement

---

## S2. LEAD ENTRY & QUALIFICATION (Part 2 — Roadmap B2)

Two entry paths: (A) partner submits via portal (Phase D); (B) owner manual entry (build now). Owner-only extra fields: `referred_by` dropdown (self/bright_destiny/other+name), `entered_by` (auto), `loaded_on_behalf` bool, `original_referrer_id`, `referral_date` (auto, editable), "notify partner now" toggle (default YES → fires LEAD_CREATED_FOR_YOU when notifications live).

`leads` table: id, business_name*, entity_type enum(pty_ltd/cc/sole_prop/trust/partnership/ngo/other), cipc_number (format-validated), industry_id FK*, sub_industry_id FK, sector_notes, website, trading_history_months, employee_range enum(1-5/6-20/21-50/51-200/200+), monthly_turnover_range enum(<50k/50-100k/100-250k/250-500k/500k-1m/1-2.5m/2.5-5m/5m+), annual_turnover, primary contact fields (name*, role, cell* SA-validated, email*, id_number), physical_address, registered_address, region, funding_amount, funding_purpose jsonb multi (stock/equipment/working_capital/expansion/bridging/debt_consolidation/property/vehicles/other), funding_timeline enum(urgent_7d/30d/90d/flexible), has_existing_debt bool + existing_debt_details jsonb, security_available jsonb multi (property_res/property_comm/property_agri/vehicles/equipment/livestock/stock/invoices_receivables/contract_cession/suretyship/none), referred_by, referral_partner_id FK, entered_by FK, loaded_on_behalf, original_referrer_id, initial_notes, qualification_stage enum(new_lead/under_qualification/qualified/not_qualified), not_qualified_reason enum (list below), not_qualified_notes (required if reason=other), follow_up_date, created_at, updated_at, qualified_at, qualified_by.

On `qualification_stage → qualified`: auto-create linked `deals` row at stage 'Qualifying', copy/attach client (create client if new, duplicate-check first per S6-lite).

Not-qualified standard reasons (enum, exact list): no_cipc · trading_history_too_short · turnover_too_low · sector_not_serviced · over_leveraged · bank_statement_issues · client_unresponsive · unrealistic_expectations · already_declined_by_likely_funders · no_security_for_asset_needs · timing_not_right · sector_risk_too_high · documentation_impossible · compliance_concern · other

Partner view (Phase D): sees his own not-qualified leads + reason (educational); auto-archive unqualified after 6 months.

---

## S3. CLIENT STORY & CALL LOGS (Part 2 — Roadmap B4)

`client_stories`: id, client_id FK, business_story, founder_background, business_origin, competitive_edge, aspirations, contact_story, family_context, personal_interests, language_preference, communication_style, assets_narrative, initial_assessment, ongoing_impressions (append-only: store as jsonb array of {text, author, at} or child table), concerns_flagged, opportunities_seen, created_at, updated_at. Story is never overwritten — updates append. Rich text = markdown in text columns for now.

`call_logs`: id, client_id FK, date, time, medium enum(call/whatsapp/meeting/email/message), duration_minutes, discussed_topics, client_promises, thapelo_promises, follow_up_needed bool, follow_up_date, next_action, created_at, created_by. Follow_up_date due → FOLLOW_UP_DUE notification (once A11 live).

Client detail gains tabs: Overview / Story / Deals / Documents / Communications / Call Log. First real capture: Fepa Sechaba Milling and Mining (contact Tumi) — mining (chrome+gold) + farming, R20M trust, R1bn Reserve Bank deal (nature TBD), assets: trucks/property/livestock/equipment/mining rights. Suggested funders per matrix: PrefCap, Paragon, Business Partners, Sourcefin. Qualifying questions to log: CIPC; mining rights S27 MPRDA vs S16 prospecting; Reserve Bank deal nature+stage; trust structure/trustees; specific funding need.

---

## S4. NOTIFICATIONS (Part 4 — Roadmap A11/A12, D6)

Tables:
- `notifications`: id, user_id FK, event_type, title, body_text, body_html, link_url, data jsonb, read_status bool, created_at, read_at
- `notification_deliveries`: id, notification_id FK, channel enum(email/whatsapp/sms/in_app), delivery_status enum(pending/sent/delivered/failed), sent_at, delivered_at, error_message, external_id
- `notification_preferences`: id, user_id, event_type, email_enabled, whatsapp_enabled, sms_enabled, in_app_enabled, quiet_hours_start, quiet_hours_end, digest_mode, updated_at

`profiles` gains: phone_number, phone_number_verified, whatsapp_opted_in, sms_opted_in.

Event types (enum): LEAD_CREATED_FOR_YOU, LEAD_SUBMITTED_BY_PARTNER, LEAD_QUALIFICATION_UPDATED, DEAL_SUBMITTED_TO_FUNDER, DEAL_APPROVED, DEAL_DECLINED, DEAL_FUNDED, COMMISSION_PAID, FUNDER_RESPONSE_RECEIVED, CLIENT_MESSAGE_RECEIVED, FOLLOW_UP_DUE, BADGE_EARNED, MONTHLY_TARGET_MILESTONE, TIER_REVIEW_UPCOMING, FUNDER_RATE_CONFIRMED, DOCUMENT_UPLOADED, SYSTEM_MAINTENANCE.

Phase A scope: in-app bell (badge count, dropdown last 10, mark read/all, Realtime updates) + Notification Center page (filter/search/bulk) + Resend email for LEAD_CREATED_FOR_YOU, DEAL_APPROVED, DEAL_FUNDED, COMMISSION_PAID only. Branded HTML template (navy header, teal CTA button, unsubscribe/prefs link). From hello@fundnowcapital.africa via Cloudflare routing; Google Workspace MX untouched; SPF already includes resend.

Phase D scope: Twilio WhatsApp (pre-approved templates, emoji style per Part 4, always ends with CRM link + "— Fund Now Capital"), SMS fallback after 60s failure, retry 3x exp backoff, quiet hours, digest mode, prefs page with per-event channel matrix.

**CRITICAL: partner-facing notification bodies use fictional funder names only.**

**A11 implementation notes (as built):**
- Only the **in-app** channel is emitted in Phase A. Each in-app notification writes one `notification_deliveries` row with `channel='in_app', delivery_status='delivered'`. Email/WhatsApp/SMS delivery is A12/D6.
- Emitted by SECURITY DEFINER triggers: **DEAL_APPROVED** (a `deal_funder_submissions` row → `approved`), **DEAL_FUNDED** (a deal → `funded` stage), **COMMISSION_PAID** (a `commission_records` row gets `payment_received_date` set). **LEAD_CREATED_FOR_YOU** is a documented placeholder in the migration — its trigger activates in **B2** when the `leads` table exists.
- **Recipient resolution**: the A11 hardening PR retargeted the three active triggers to the **owner** explicitly via `notify_owner()` (owner-only phase — the owner needs to know every event). `notify_recipient(referral_partner_id)` is retained for Phase D, when the referring partner is *also* notified. Funder names in bodies are role-aware via `funder_display_name(funder_id, recipient)`: the **real** `funders.name` for an owner (funder identity is owner-only), `display_name_for_partner` for a partner.
- **Mark-read RPCs return their affected rows** (the updated id / row count) so a silent RLS/ownership no-op surfaces as an error in the client instead of a false success.
- **`commission_records.payment_received_date`** (date, nullable) is added by the A11 migration so COMMISSION_PAID has a trigger condition; it's fully wired in C2/C3.
- RLS: a user sees only their own `notifications` / `notification_deliveries` (own via parent) / `notification_preferences`. Direct table writes are blocked; marking-read goes through `mark_notification_read` / `mark_notifications_read` / `mark_all_notifications_read` RPCs (SECURITY DEFINER, scoped to `auth.uid()`), so bodies can't be tampered with.
- The bell badge updates live via **Supabase Realtime** (`notifications` added to the `supabase_realtime` publication; the client subscribes filtered by `user_id`).
- `notification_preferences` matrix: only `in_app_enabled` is toggleable now (default on); the other channels render "coming soon".

**A12 implementation notes (as built — email via Resend):**
- **Delivery flow:** after `emit_in_app_notification()` writes the in-app rows, it calls `invoke_send_notification_email(notification_id)`, which fires an **async** `pg_net` POST to the **`send-notification-email`** Edge Function. Async by design — email never blocks the writing transaction. All four A-phase events flow through this single path.
- **Edge Function** (Deno) loads the notification, the recipient's `profiles.email`, and their `notification_preferences` row, then decides:
  - **skip** (write a `notification_deliveries` row `channel='email', delivery_status='skipped'`, `error_message` = reason) when `email_enabled=false`, `digest_mode=true` (queued for the future daily-digest sender), or the current time is **within quiet hours** (evaluated in `Africa/Johannesburg`). No preference row ⇒ email **on** by default.
  - otherwise **send** via Resend and write `delivery_status='sent'` (`external_id` = Resend id) or `'failed'` (`error_message`).
- New enum value **`skipped`** added to `notification_delivery_status`.
- **Template:** **bulletproof, table-based HTML** (inline styles only — no `<style>` block, no CSS classes, no flexbox/grid; tested against Outlook, Gmail web, Gmail iOS/Android, Apple Mail) **plus a plain-text fallback** for every variant (deliverability). One shared shell — navy→teal gradient header with the **hosted white FN mark** + "Many funders. More approvals." tagline + cyan accent line, a white content card (H1 title, greeting, body, teal→green gradient "View in CRM" CTA to `APP_BASE_URL + link_url`), and a deep-navy 3-column footer (Offices / Contact / Connect with hosted white LinkedIn + TikTok PNG icons) over a legal row (© + CIPC + per-event-category subscription + prefs link). Wraps **four variants** — `welcome`, `deal_approved`, `weekly_summary`, `commission_paid`; only DEAL_APPROVED / DEAL_FUNDED (reuses `deal_approved`) / COMMISSION_PAID fire today, `welcome` + `weekly_summary` lie dormant until B2 / C6. Logo + social icons are hosted PNGs in `/public/email-assets` (Outlook has no SVG support), referenced by absolute HTTPS URL under `APP_BASE_URL`. From **"Fund Now Capital" <hello@fundnowcapital.africa>**, reply-to the same. Because there is no `<style>` block there are no `@media` queries, so the footer does not stack on narrow screens; sizes are chosen to stay legible when a mobile client scales the 600px shell. Template variables + how to add an event type: **`docs/email-templates.md`**.
- **Preferences:** the owner is backfilled with `email_enabled=true` for every event type; the prefs page **email column is now live** and toggleable per event (in-app + email).
- **Auth / secrets:** the function is deployed `verify_jwt=false` and validates a shared **`X-Webhook-Secret`** header; the function URL + secret live in **Vault** (never in the repo). `RESEND_API_KEY` is a function env var. No service-role key is stored in the DB.
- **`APP_BASE_URL`** currently points to the Vercel URL (`https://fund-now-capital-2026.vercel.app`) for the email's "View in CRM" / preferences links. Migrate to `https://crm.fundnowcapital.africa` in **Phase C/D** via a custom domain in Vercel + a CNAME in Cloudflare, then update the `APP_BASE_URL` Edge Function secret.

---

## S5. ACTIVITY LOGGING (Part 4 — Roadmap A10)

`activity_logs`: id uuid, timestamp timestamptz(ms, UTC), user_id (nullable=system), user_email (denormalised), user_role, ip_address, user_agent, event_type enum(CREATE/UPDATE/DELETE/READ/LOGIN/LOGOUT/LOGIN_FAILED/STAGE_CHANGE/QUALIFICATION/COMMISSION_CALC/SUBMISSION/INVOICE/PAYMENT/NOTIFICATION_SENT/PERMISSION_CHANGE/EXPORT), entity_type, entity_id (nullable), description, changed_fields jsonb, before_values jsonb, after_values jsonb, session_id, related_entity_ids jsonb, notes.

Indexes: (timestamp DESC), (user_id, timestamp DESC), (entity_type, entity_id, timestamp DESC), (event_type, timestamp DESC). Partition by month when volume warrants (defer). Write async (DB triggers for data events; app layer for auth/READ events). READ logged ONLY for sensitive docs (bank statements, IDs, financials) — not navigation.

Views: owner chronological timeline (filter user/event/entity/date, export CSV); per-entity Activity tab on deal/client/lead; security log owner-only. Retention: never auto-delete (7yr+ policy handled operationally). Existing `deal_stage_history` remains; `activity_logs` is the general layer.

**A10 implementation notes (as built — deviations from the outline above):**
- The timestamp column is named **`occurred_at`** (not `timestamp`): `timestamp` is a reserved type keyword and a bare column of that name would need quoting everywhere. Same semantics (timestamptz, UTC). Indexes use `occurred_at`.
- **"Async"** is realised as lightweight **AFTER-row triggers** (one small insert, sub-millisecond, effectively non-blocking) rather than a message queue. A true fire-and-forget queue (pg_net / pgmq) is deferred.
- Triggers are attached to **deals, deal_funder_submissions, clients, client_contacts, commission_records**. The **`leads`** trigger is deferred to **B2** (the table doesn't exist yet).
- Event-type mapping: INSERT→`CREATE`, UPDATE→`UPDATE`, DELETE→`DELETE`; a deal update that changes `stage`→`STAGE_CHANGE`; **all** `deal_funder_submissions` writes→`SUBMISSION` (the description carries the added/updated/status-change detail). `changed_fields`/`before_values`/`after_values` are captured on UPDATE (excluding `updated_at`).
- `entity_type` values are singular strings: `deal`, `deal_funder_submission`, `client`, `client_contact`, `commission_record`. `related_entity_ids` links children to parents (submissions/commission → deal; contacts/deals → client) so a deal's Activity tab picks up its submissions and a client's picks up its deals + contacts.
- RLS: **owner-only SELECT**; no insert/update/delete policy exists, so the trail is written only by the SECURITY DEFINER trigger and is immutable through the API. `ip_address`/`user_agent`/`session_id` are left for the app layer (auth/READ events, Phase E/F). READ logging is **not** enabled at this stage.
- Frontend: Activity **section** on the deal detail page (which uses stacked sections, not a tab bar) and an Activity **tab** on the client detail page; owner `/activity` timeline with date/user/event/entity filters, description search, and CSV export (client-side; latest 500 per page).

---

## S6. DOCUMENT MANAGEMENT UPGRADE (Part 6 M1 — Roadmap B3 core, E/F extras)

B3 core slice — extend `documents` table: `document_type` becomes full taxonomy enum —
- Business: cipc_cert, company_profile, business_plan, shareholders_cert, moi, tax_clearance, bee_cert, trading_license.
- Financial: bank_statement (+period_start/period_end), financial_statements, mgmt_accounts, debtors_ageing, creditors_ageing, balance_sheet, cashflow_projection, mgmt_report.
- Personal: id_copy, proof_of_address, marriage_cert, anc_contract, personal_financials, personal_bank_statement.
- Deal: application_form, credit_consent, purchase_order, invoice_doc, buyer_contract, cession, suretyship, personal_guarantee.
- Asset: natis, title_deed, property_valuation, equipment_invoice, stock_take.
- Compliance: fica_pack, popia_consent, aml_screening, sanctions_screening.
- Funder comms: submission_email, approval_letter, decline_letter, offer_doc, rate_confirmation.
- FNC business: funder_agreement, partner_agreement, commission_invoice, payment_confirmation.
- Other: other.

Add columns: version_number int default 1, is_current_version bool default true, status enum(active/archived/expired/rejected), expiry_date, tags jsonb, received_from, shared_with jsonb, notes. New upload of same type+entity → new version, old marked is_current_version=false, never deleted. Expiry defaults: bank_statement/proof_of_address 3 months from period end; tax_clearance/bee_cert 12 months; fica_pack 12 months. Alerts at 30d/7d/expiry (via notifications). Expired docs blocked from new submission packages.

Deferred to E3/F: OCR text extraction, external share links w/ expiry+tracking, watermarks, e-signature integration, document request links (E4), bundled PDF (E3).

---

## S7. INVOICING (Part 5 M2 — Roadmap C1)

`invoices`: id, invoice_number (INV-XXXX, sequential from INV-0032, never gaps — void don't delete), deal_id FK nullable, funder_id FK, funder_contact_id, invoice_date, due_date (net 30 default), subtotal, total_amount, status enum(draft/pending_approval/sent/paid/partial_paid/overdue/voided), pdf_url, notes, created_by/at, sent_at, paid_at, payment_received_amount, payment_shortfall_amount, payment_shortfall_reason.
`invoice_line_items`: id, invoice_id, deal_id, description, amount, sort_order.
`invoice_payments`: id, invoice_id, payment_date, payment_amount, bank_reference, notes, recorded_by.

Flow: deal → Funded stage ⇒ auto-draft invoice (pending_approval) ⇒ owner reviews/adjusts ⇒ approve ⇒ PDF generated (branded: logo, TAX INVOICE, FNC details CIPC 2026/066284/07 + Bryanston address + 010 102 0534 + thapelol@, funder details, line item "Referrer commission on funding facility of R[amount] to [Client] — Deal REF: DEAL-XXX", Absa Universal 632005 acct 4125798855, footer "Fund Now Capital (Pty) Ltd is not VAT registered" + tagline) ⇒ Resend email to funder accounts contact ⇒ status sent. Payment recorded manually ⇒ paid. Overdue flags 30/45/60d with drafted reminder emails (owner reviews before send). Bundled monthly invoices + credit notes (CN-XXXX): defer to Phase E. PDF gen: Supabase Edge Function (or server util) — pick pragmatic library, store in Storage. **No VAT charged anywhere (not VAT registered).**

---

## S8. DOCTOR'S PAYROLL (Part 5 M3 — Roadmap C3–C5, portal screens D2)

`doctor_earnings`: id, deal_id, deal_funder_submission_id, doctor_id FK referral_partners, commission_amount, tier_applied, status enum(earned/ready_to_invoice/invoiced/paid), earned_at (deal funded), ready_to_invoice_at (FNC received funder payment), invoiced_at, paid_at. Computed server-side from `calculate_commission` — never client-supplied.
`doctor_invoices`: id, invoice_number (BD-XXXX sequential), doctor_id, invoice_date, due_date, total_amount, status enum(draft/sent/paid/overdue), pdf_url, notes.
`doctor_invoice_line_items`: id, invoice_id, earning_id FK, deal_reference, description (client + FICTIONAL funder name + date), amount.
`doctor_payments`: id, doctor_invoice_id, payment_date, amount, bank_reference, notes, paid_by.
`doctor_monthly_statements`: id, doctor_id, month, year, opening_balance, deals_funded_count, deals_funded_value, total_commission_earned, total_invoiced, total_paid, closing_balance, pdf_url, generated_at. Auto-generate month-end, email + store in portal.

Payment terms: within 7 days of FNC receiving funder commission. Banking details in `referral_partners` (jsonb, already exists) — partner-editable in portal, change triggers security notification to owner. Owner payroll view: total earned all-time, owed balance (liability, feeds cash flow report), paid this month/year, avg per deal, 12-month trend.

---

## S9. REPORTS (Part 5 M1 — Roadmap C6 v1, E7 v2)

C6 v1:
- R1 Business Performance Overview (period selector; cards: commission earned/received/pending/projected, deals funded, avg deal size, avg commission per deal, avg lead→funded days; charts: 12-mo commission trend line, commission by funder bar, by sector donut, pipeline funnel; vs-previous-period comparison).
- R2 Funder League Table (submitted/approved/funded/approval rate/avg days to decision/total commission/avg per deal, sortable, filters, auto-insight callouts, "wasting time" + "emerging opportunities" views).

E7 v2:
- R3 Sector Analysis (concentration donut, 40% warning threshold, trending sectors).
- R4 Velocity & Conversion (funnel with drop-off %, time-in-stage vs average, stuck flags, cohort analysis).
- R5 Cash Flow Projection (90-day, four probability tiers, Doctor liability + tax provisions as commitments, base/optimistic/pessimistic lines, low-cash alerts).

Tables: `report_snapshots` (id, report_type, snapshot_date, data_json, created_by/at); `scheduled_reports` (id, report_type, user_id, frequency, next/last_run_at, delivery_email, active). Exports PDF/CSV. Scheduled email delivery in E7. Recharts for charts. **Every figure must trace to real DB records — no fabricated numbers.**

---

## S10. OWNER HOME / INSPIRATION (Part 2 — Roadmap C7 v1, E8 v2)

C7 v1: Owner Home becomes `/` landing (old dashboard → "Business Overview" nav item). Hero: personal photo upload (Storage) OR gradient fallback; scripture/affirmation of the week (editable text, faith-respecting); time-of-day greeting; date. Vision Horizons: 4 editable cards (This Month / 3 Months / 6 Months / 12 Months) with commission target, deals target, partner earnings target (auto-calc), free-text goals incl. personal/family/faith. Table: `vision_horizons` (id, user_id, horizon enum, targets jsonb, goals jsonb, updated_at).

E8 v2: KPI Projection Engine (sliders: monthly commission R0–500k, deals/mo 1–20, avg deal size, team size; real-time recalc with conversion baselines from historical actuals) + Vision Board (`vision_items`: id, user_id, image_url, title, description, category enum (business/family/personal/faith), target_date, progress_pct, prayer_intention, achieved_at, sort_order; add/edit/achieve-with-celebration/drag-reorder).

---

## S11. DOCTOR'S PORTAL + ENGAGEMENT SUITE (Parts 1+3 — Roadmap Phase D)

Partner role routing: partner login → `/portal` (own layout, NOT owner AppLayout). **Absolute rule: fictional funder names, never gross FNC commission, never 40/60 math, never internal notes, never client bank statements.**

Screens (Part 1 spec): Dashboard (KPI cards: leads this month, deals in progress, funded, earnings; pipeline value; quick actions; activity feed; funder reference table with fictional names + his tier share; tier progress). Submit Lead (S2 form, partner variant). My Deals (table: ref, client, date, stage, fictional funder, projected commission, payment status; filters). Deal Detail (Part 3 F3 timeline: 11 milestone icons, submitted→qualification→docs→submitted-to-funder→in-credit→approved/declined→client-deciding→signed→funded(celebration)→commission-processing→paid(confetti); click stages for detail; limited comms log). Earnings & Statements (totals, monthly breakdown, per-deal, PDF statements). Invoicing (ready-to-invoice queue → generate BD invoice → awaiting payment → history). Profile (contact, banking — edit triggers owner alert, password, notification prefs, signed agreement download). Help & Resources.

**Deal Success Timeline — visual reference (Part 3 F3):** use the horizontal step-progression pattern with arrow/chevron shapes, brand colours (navy → teal → light teal for completed / current / upcoming), icon circles per step, and step label + timestamp below. Reference mockup saved by owner.

**Submission decline (data model live from Roadmap A9.5; partner surface built here in Phase D):** each funder submission carries a partner-safe `decline_reason_category` (affordability / documentation_gaps / sector_appetite / credit_profile / security_insufficient / funder_criteria_not_met / other) and an owner-only `decline_notes_internal`. On the partner deal timeline a declined submission reads **"Declined by [fictional name] — [generic reason category]"**, sourced from `partner_submission_view` (fictional funder name + status + reason category only — never the real funder name, the internal notes, or any commission figures). When the last active submission on a deal is declined, the deal auto-moves to the terminal Declined stage.

Part 3 F1 Client Estimator: inputs (deal size slider R50k–10M, industry+sub dropdown, turnover range, trading history slider 0–60mo, security multi-select, timeline, existing debt toggle) → outputs: fundability gauge (green 80-100/amber 50-79/red 0-49 + natural-language explanation), suggested funder cards (fictional name, fit, product icon, turnaround, ticket range, why-line), estimated client cost (APR range, term, total cost bar), timeline prediction, document checklist + "Download Client Prep Sheet" PDF, HIS estimated commission (tight range). Save Scenario → `calculator_scenarios` (id, doctor_id, scenario_name, calculator_type, inputs jsonb, outputs_snapshot jsonb, created/updated_at).

Part 3 F2 Commission Estimator: inputs (facility slider, deal type toggle, funder dropdown fictional, repeat status) → big animated number (range), deal comparison bars (500k/1m/current/5m), monthly projection slider vs R50k target (green/amber/grey), "path to R50k" card, career trajectory. **BUSINESS VIEW SECTION: ⚠ OPEN DECISION — do not build until owner decides transparency level (full ranged breakdown vs his-number-only).**

Part 3 F5/F6 (Phase F): `learning_content`, `doctor_badges`, `doctor_activity_feed` tables; badges (first deal funded, 4-week streak, 10 quality leads, R100k earnings, repeat client); notification celebrations. Estimator outputs use ranges, never exact internal rates. Real-time recalc, no submit buttons. Mobile-first layouts.

---

## S12. ACTIVITY MONITORING (Part 5 M4 — Roadmap F4)

`user_engagement_metrics`: id, user_id, period_start/end, login_count, session_count, total_time_minutes, leads_submitted, calculator_uses, notifications_received/opened/actioned, engagement_score 0-100, calculated_at. Nightly recalc.
`engagement_alerts`: id, user_id, alert_type, alert_data jsonb, severity(positive/concern/critical), action_recommended, created_at, acknowledged_at.

Owner view: Team → partner profile: engagement overview (last login, frequency, streak, score colour-coded), activity timeline (from activity_logs), lead performance + sector analysis, calculator engagement, notification response rates by channel, auto-generated growth recommendations. Alerts: 7d inactive, submission rate -50%, 5+ ignored notifications, degrading approval rate; positive: score +15, 3 leads/day, first funded in new sector, milestone crossed.

**TRANSPARENCY RULE: partner sees his own full metrics + score + explanation. Nothing hidden. Disclosed at partnership signing. He can export his own activity.**

---

## S13. PRODUCTION HARDENING (Part 6 — Roadmap E/F, condensed)

- **E3 Deal packaging:** `funder_submission_templates` (id, funder_id, cover_letter_template, required_document_types jsonb, optional jsonb, submission_email, cc_emails, subject_line_format, notes); `submission_packages` (id, deal_id, funder_id, generated_at, sent_at, cover_letter_final, bundled_document_url, documents_included jsonb, email fields, external_email_id). Pre-submit validation: docs present, not expired, funder min criteria, no compliance flags — block with explanation if failing. Multi-funder parallel submit. Post-submit follow-up drafts at 5/10/15d.
- **E4 Onboarding:** `client_onboarding` (id, client_id, current_step 1-10, per-step timestamps, completed_at). 10 steps: contact logged → qualified → welcome comms → consent capture → document collection → FICA verification → story enriched → funder routing → packaged & submitted → client confirmed. Visual progress tracker on client detail.
- **E5 Productivity:** `tasks` (id, user_id, title, description, priority, due_date, status, entity link, recurring_pattern jsonb); auto-tasks from CRM events; Today/Week/Overdue views. Calendar sync + time tracking: defer to F.
- **F1 Search:** Postgres tsvector across deals/clients/funders/documents/notes/comms; global top-bar search, grouped results, advanced filters, `saved_searches` + `search_history` tables. Semantic AI search later.
- **F2 Security:** 2FA (TOTP via Supabase MFA — already enabled in dashboard), session management (active sessions view, force logout, new-device alerts), `security_events` table, password policy (12+ chars; NO forced 90-day rotation pending owner decision), sensitive-field encryption review.
- **F3 Continuity:** `backup_logs` table; secondary offsite backup (S3/Backblaze); weekly restore verification; full data export (JSON/CSV/ZIP); DR playbook doc.
- **F5 PWA:** manifest + service worker, installable, offline cache of recent data, camera document capture, push notifications, bottom nav mobile layout.
- **F7 Integrations:** CIPC validation on client create; Gmail two-way (E1); Absa statement upload + payment matching; Chrome extension; Zapier webhooks (`webhook_endpoints` table).
- **F8 BI:** `predictions`, `anomaly_alerts`, `scheduled_insights` tables; Monday 08:00 AI weekly intelligence email; custom dashboards. Wiki: `wiki_pages`/`wiki_versions`; Q&A over wiki via AI.
- **F9 Data quality:** `data_quality_scores`, `merged_records` tables; completeness scoring; monthly hygiene prompts; safe merge with audit trail.

---

## S14. CELEBRATIONS & REWARDS SYSTEM (Part 3 F5–F6 — Roadmap F6)

Two coordinated systems that make wins feel earned: **rank badges** (a persistent achievement library) and **confetti** (the moment-of-win animation). **Build order unchanged — this ships in F6**, after the portal, engagement suite, and real earnings data exist. Not surfaced earlier.

### Rank badges
Figma-derived asset library (exported SVG/PNG, stored in Supabase Storage). Five-tier progression per badge family: **Bronze → Silver → Gold → Platinum → Elite**.

`badge_designs` (the catalogue — owner-curated, seeded from Figma):
- id, code (unique slug, e.g. `first_deal_funded`), name, description
- tier enum(bronze/silver/gold/platinum/elite)
- category enum(milestone/streak/volume/earnings/quality)
- criteria jsonb (machine-readable unlock rule, e.g. `{"metric":"deals_funded","gte":1}`)
- asset_url (Figma export in Storage), sort_order, active bool, created_at

Earned badges live in **`doctor_badges`** (S11 / F6): id, doctor_id, badge_design_id FK, earned_at, deal_id (nullable, the triggering deal), seen_at (for the "new badge" indicator). A badge is awarded once its `criteria` is met; awarding fires **exactly one BADGE_EARNED notification** (S4) and **exactly one** confetti celebration — `big` for a standard unlock, or **`massive` when that same unlock also crosses a tier** (Bronze→Silver→Gold→Platinum→Elite). A tier-crossing badge is a **single `massive` event — never `big` + `massive` combined**. Seed families (per S11): first deal funded, 4-week streak, 10 quality leads, R100k earnings, repeat client — each with tier thresholds.

### Confetti
Library: **canvas-confetti** (single dependency, no external assets). Particles use brand colours only — Navy `#1a3a52`, Teal `#2da8b8`, Green `#5dba5d`. Four intensities:

| Size | Feel | Trigger events |
|---|---|---|
| **small** | quick pop | lead **qualified** · new client added |
| **medium** | short burst | deal approved · contract signed |
| **big** | full burst + PriorityGlow pulse | deal funded · **standard** badge unlock (no tier change) |
| **massive** | sustained multi-burst, screen-filling | R100k+ commission month · **tier-crossing** badge unlock (Bronze→Silver→…→Elite) |

**Implementation note:** Celebration size is chosen at emit time by the most significant matching rule, and each event fires exactly one notification and one animation — no stacking. (So a single funded deal that also unlocks a tier-crossing badge resolves to one `massive` celebration, not a `big` and a `massive`.)

`big` and `massive` compose with **PriorityGlow** (the single sanctioned glow effect, per CLAUDE.md) — no other glow. Honour `prefers-reduced-motion`: fall back to a static celebratory toast for users who opt out.

### What NOT to celebrate (deliberate restraint)
- **No confetti on login** — a celebration marks an achievement, not a routine action.
- **No per-lead confetti** — a raw new lead is not a win; only a **qualified** lead earns the `small` tier. Per-lead animation trains users to ignore it.
- No celebration for owner-internal edits, or for stage moves that aren't approval / signing / funding.

Celebrations must stay rare enough to stay meaningful; overuse is the failure mode.

---

## S15. LEAD NURTURE & PARTNER FOCUS (Part 7 — Roadmap Phase E, items E9–E11)

Solves the real business pattern: leads stalling between introduction and document collection; the partner (Doctor) opening new leads before closing existing ones. Sits **on top of** lead entry (B2), notifications (A11/A12/D6), the Doctor portal (D1–D2), and invoicing (C1). **Do not surface before those exist.**

**Locked configuration (owner decisions):**
- Nurture timeline: **14 days (fixed)**.
- Friction threshold: partner sees a warning modal at **3+ leads in `awaiting_documents`** status. Soft warning, **not a hard block**.
- Template language: **English only**.
- Template editability: **owner only** (partner sees read-only).

Every S15 automation writes to `activity_logs` (S5). Every partner-facing message uses **fictional funder names** (S11 anonymisation is absolute). Seeded templates use **Part 7's exact copy — do not paraphrase**.

### S15.M1 — 14-Day Client Nurture Automation

`lead_nurture_sequences`: id, lead_id FK, deal_id FK (nullable — created on qualify), sequence_start_date, current_day int, status enum(active/paused/completed/abandoned/stalled_pending_decision), client_engagement_score int (0–100, computed), next_action_scheduled_at, created_at, updated_at.

`nurture_events`: id, sequence_id FK, event_type enum(email_sent/whatsapp_sent/sms_sent/partner_notified/owner_escalated/client_opened_email/client_clicked_link/client_responded/documents_partial/documents_complete/call_scheduled/paused/resumed/abandoned), event_data jsonb, channel enum(email/whatsapp/sms/in_app), external_message_id (Resend/Twilio), triggered_at, outcome text.

**Day-by-day schedule** (all times owner-configurable in Settings later; defaults below):
- **Day 0:** welcome email + Trust Pack PDF attached + WhatsApp warm follow-up from owner (Twilio template) + simple doc checklist (CIPC + director ID only — keep the first ask small).
- **Day 1:** partner notification "reach out to [client] today" + dashboard highlight "48-hour rule: contact [client] today".
- **Day 2:** if no client response → partner gets a pre-written WhatsApp template with a one-click "copy + open WhatsApp" button.
- **Day 3:** partner dashboard shows "3 days — time for a nudge call"; auto-draft second follow-up email; escalation notification to owner.
- **Day 5:** check documents received; if not, notify owner with options (extend nurture / personal call / mark stalled / abandon).
- **Day 7 (CRITICAL):** `status → at_risk` if no docs; partner dashboard row turns amber; auto-suggested action "try a video call"; pre-drafted message ready.
- **Day 10:** partner notification "personal call time — email/WhatsApp not working"; escalation to owner with clear options.
- **Day 14:** `status → stalled_pending_decision`; owner **MUST** decide revive/archive/abandon (blocks in the pending-actions list until resolved).

**Behaviour-driven triggers (adapt the sequence):**
- Client opens welcome email (Resend tracking) → shorter nurture path.
- Client clicks the upload link → pause automated nudges 24h; notify owner "client engaged with upload page — likely coming soon".
- Client sends partial docs → tone shifts to "just X more"; progress bar surfaces in owner + partner views ("60% ready to submit").
- Client responds via WhatsApp/email → auto-pause automated nudges; notify owner+partner "client engaged — take over manually".
- Client asks a question → route to owner with auto-draft response templates (see M3 objection library).

**Implementation notes:**
- Schedule via a Supabase Edge Function (pg_cron trigger) evaluating due sequences daily, **owner-timezone-aware**.
- Every automated action writes to `activity_logs` (S5) and fires an appropriate notification (S4).
- The nurture sequence **auto-creates when a lead is qualified** (S2 workflow) — it starts at the introduction/pitch moment, not at lead entry.

### S15.M2 — Partner Focus Dashboard (redesigns the D1 partner dashboard)

Sections, top to bottom:
1. **THIS WEEK'S FOCUS** card (unmissable, top of page): header "N leads waiting for documents — chase these before adding new leads"; per-lead row (client name, day-in-nurture, colour-coded urgency green &lt;3d / amber 3–6d / red 7d+, quick-action button: copy WhatsApp template / book 15-min call / escalate to owner); bottom line "M deals ready to invoice — R X available".
2. **LEAD HEALTH OVERVIEW** (bar chart, current period vs goal): rows leads submitted → documents received → submitted to funder → approved → funded; conversion % vs goal (25%) — green ≥25%, amber 15–24%, red &lt;15%; insight card "Your leads take avg N days to send documents. Top performers hit 3 days. Consider a 48-hour follow-up rule."
3. **STALLED LEADS REQUIRING ACTION:** every lead in at_risk/stalled state, always visible until resolved; columns client, days since intro, last action taken, suggested next action, one-click actions.
4. **ADD NEW LEAD** button — with the friction check below.
5. **WEEKLY STREAK** card (positive reinforcement): consecutive weeks with follow-up completed; days since last stalled lead; rolling average lead-to-documents time.

**Friction check (S15.M2.friction) — locked at 3 leads:** when the partner clicks "Add New Lead" AND has ≥3 leads in `awaiting_documents`, show a **soft warning modal**: lists the 3 stalled clients with days stalled; copy "Adding new leads before closing existing ones drops our conversion rate — and your earnings. Please chase these 3 first. Adding new leads should be the exception, not the norm." Buttons **[Chase these first — I'll close them]** / **[Add new lead anyway]**. **Not a block — override allowed.** Every override logs to `activity_logs` with `event_type=NEW_LEAD_ADDED_WITH_STALLED` (owner visibility).

`lead_health_metrics`: id, user_id FK, calculation_date, leads_submitted_30d, leads_submitted_90d, leads_submitted_all_time, documents_received_rate, funder_submission_rate, approval_rate, funding_rate, average_time_to_documents_days, current_stalled_lead_count, last_calculated_at. Recalc nightly.

`partner_streaks`: id, user_id FK, streak_type enum(follow_up_consistency/weekly_lead_submissions/documents_received_within_48h), current_streak_days, longest_streak_days, last_broken_at.

### S15.M3 — Nudge Toolkit (partner WhatsApp/email templates)

`nudge_templates`: id, template_name, template_category enum(day_0_thank_you/day_0_expectations/day_2_check_in/day_2_value_reminder/day_2_direct_ask/day_4_objection/day_4_reassurance/day_4_urgency/day_7_call_offer/day_7_stakes/day_7_video/day_10_call/day_10_scheduling/day_10_honest/day_14_final/day_14_close_out/day_14_goodbye/objection_bank_statements/objection_rates/objection_thinking/objection_previously_declined), template_channel enum(whatsapp/email/sms), subject text (email only), body_text (with `{variables}` — `{ClientName}`, `{FunderCount}`, `{DealAmount}`, etc.), usage_count int, effectiveness_score numeric (computed from response rates), active bool, created_at, updated_at, edited_by, version_number.

`template_versions`: id, template_id FK, version_number, body_text snapshot, subject snapshot, edited_by FK, edited_at, change_notes, is_current_version bool. Enables rollback.

`nudge_usage`: id, template_id FK, lead_id FK, sent_by_user_id FK, sent_at, client_responded_within_24h bool, response_content text (nullable).

**Owner template management UI** (Settings → Templates & Communications): list all templates grouped by category; edit any body/subject with a variable-insertion helper; preview panel renders with sample data (Mama Mabase JV etc.); enable/disable individual templates; add custom templates; **Save = new `template_versions` row, `is_current_version` flipped**; per-template effectiveness metrics (once data accumulates); one-click rollback to a previous version.

**Partner UI** (per-lead in dashboard): "Nudge Client" button on every lead card; modal shows 3–5 templates appropriate to the current nurture day; partner selects → optional inline edit → "Send via WhatsApp" pre-fills a WhatsApp deep link with the rendered message; every send logged to `nudge_usage`. **Partner CANNOT edit templates**; owner changes propagate immediately. An admin note field is visible to the partner (e.g. "Use after 4pm for best response").

Seed the **objection library** (initial four templates: bank-statements privacy, rates concerns, "need to think", "previously declined"; owner can add more) using **Part 7's exact wording — do not paraphrase**.

### S15.M4 — Client Motivation & Trust Building

`client_trust_packs`: id, client_id FK, pdf_url (Supabase Storage, generated via Edge Function), sent_at, opened_at (Resend tracking), version_number.

**Trust Pack PDF** (Fund Now Capital branded): FNC overview (who/what/tagline); credentials block (CIPC 2026/066284/07, Bryanston + Polokwane addresses, Absa banking, 010 102 0534, thapelol@fundnowcapital.africa); case study (one funded client, anonymised or by permission — starts with **Chickanos**, the R400k Pollen deal, R14k commission funded); testimonials (from `client_testimonials` as they accumulate); **funder panel with REAL funder names — this is client-facing** (clients engage funders directly, so real names are fine here; the anonymisation rule is partner-facing only); process explanation with timeline; POPIA + data-security assurances; owner contact card. **Auto-sent with the Day 0 welcome email; regenerated if testimonials update.**

**Client progress indicator** (on any client-facing link/portal page) — "Journey to Funding" checklist: ✓ Introduction call (Day 0) · ✓ Welcome email received · ◯ Documents submitted **[You're here]** · ◯ Reviewed by our team · ◯ Submitted to funder · ◯ Approval received · ◯ Contract signed · ◯ Funds in your account. Shows % complete: "You're X% of the way there. Send [next item] to move forward."

**Progress indicator — visual reference:** use the horizontal step-progression pattern with arrow/chevron shapes, brand colours (navy → teal → light teal for completed / current / upcoming), icon circles per step, and step label + timestamp below. Reference mockup saved by owner. (Shared visual language with the S11 Deal Success Timeline and the E4 onboarding tracker.)

`client_testimonials`: id, client_id FK, deal_id FK, testimonial_text, rating int (1–5), permission_to_use bool, requested_at, submitted_at, approved_by_owner_at. **Auto-requested when a deal reaches Funded** (WhatsApp + email prompt with guiding questions: "How did FNC help you? What was different?").

### S15.M5 — Partner Motivation & Accountability

**Weekly Reflection email** (Sunday evening / Monday morning, partner-timezone aware): subject "Doctor's Weekly Reflection — Week of [Date]"; sections — this week's wins (X leads submitted, Y approved, Z funded), stuck points (Y leads with no docs 5+ days), earnings (R X), tier progress (X% to next tier), challenges (personal coaching line from patterns), suggested focus for next week. Delivered via Resend from hello@fundnowcapital.africa; one email per active partner.

**Positive reinforcement:**
- Partner closes a stalled lead (at_risk/stalled → any active stage) → celebration notification + **"Closer" badge (S14)** + optional owner-suggested DM ("Great work on [client name], Doctor. Thank you.").
- Weekly conversion improvement detected → dashboard comparison card "+5% vs last week" + optional owner-suggested DM.

`owner_partner_messages`: id, from_user_id FK, to_user_id FK (partner), body text, sent_at, read_at, thread_id (nullable — threaded replies), attachment_url. Renders as a "Message from [Owner Name]" card in the partner dashboard; preserved in `activity_logs` (S5) per audit requirements.

**Partner AI Coach (Phase F — deferred within Part 7):** chat via Anthropic Claude API, context = the partner's own conversion patterns + historical CRM data + best practices + FNC business context; sample queries "Client isn't responding — what should I try?" / "How do I handle 'rates are too high'?" / "Should I follow up with X again?". Data is the partner's alone; owner opt-in to **summaries only, never raw chats**.

### S15.M6 — Owner View of Partner Performance

**Partner Performance Dashboard** (Owner sidebar → Team → [Partner Name]):
- **Engagement metrics** (from `user_engagement_metrics`, S12): CRM logins/week, avg session length, templates used, nudges sent, follow-ups completed.
- **Effectiveness metrics** (from `lead_health_metrics`): documents-received rate, per-stage conversion, avg time-to-close a lead, current stalled lead count.
- **Behaviour patterns:** most active days, sectors bringing most leads, sectors with highest conversion.

**Coaching opportunities** (auto-generated weekly), e.g. "Doctor's follow-up rate at day 4 is 30% below average — coaching moment on Day 4 templates might help." / "Doctor added 8 new leads this week but only closed 1 — consider a weekly sync focused on closing." Stored in `coaching_prompts`: id, user_id FK (about whom), for_user_id FK (the owner), prompt_text, generated_at, acknowledged_at, action_taken text.

**Partnership Health Score** (single 0–100): 40% conversion-rate weight + 20% communication-frequency weight (both directions) + 20% follow-through weight (commitments kept, from M7) + 20% recent-trend weight (30-day delta). **Score &lt;60 triggers a proactive coaching prompt for the owner.** `partnership_health_scores`: id, partner_id FK, score int, computed_at, components jsonb (each weight's contribution).

### S15.M7 — Sunday Setup (weekly commitment ritual)

Weekly guided flow (Sunday evening / Monday morning, partner-timezone aware):
- **Step 1 — Review last week:** auto-shows leads worked, wins, misses. Partner clicks "Reviewed".
- **Step 2 — Identify this week's focus:** partner picks the top 3 leads to close (from active leads ranked by nurture day) + free-text personal goals.
- **Step 3 — Commit to specific actions:** partner types commitments ("I will send follow-up messages to X, Y, Z by Wednesday" / "I will do 1 video call this week with a stalled lead" / "I will only add 2 new leads maximum this week").
- **Step 4 — Confirmation:** confetti (**small — S14**) + notification to owner "Doctor completed Sunday Setup — his focus this week: [top 3 leads]. Commitments: [list]."

`weekly_commitments`: id, user_id FK, week_start_date, top_priorities jsonb (3 items with lead_ids), committed_actions jsonb, committed_at, completed_action_count int (updated Friday), reflection_completed bool, completion_percentage numeric. **Friday afternoon:** automated check "Did you complete your commitments?" → partner marks each done/partial/missed; feeds the `partnership_health_score` follow-through component.

### S15 build order within Phase E
- **E9** = M1 (Nurture Automation) + M3 (Nudge Toolkit + owner management UI). Together they unlock the partner's ability to close leads warmly. Highest impact.
- **E10** = M2 (Partner Focus Dashboard redesign) + M4 (Trust Pack + Progress Indicator). The behavioural-change layer.
- **E11** = M5 (Motivation & Accountability) + M6 (Owner view of partner) + M7 (Sunday Setup). Long-term partnership infrastructure.
- **Partner AI Coach** (last part of M5) moves to **Phase F** alongside the other AI features.

### Event orchestration and firing order

When a single business event fires multiple side effects (notification, celebration, template, workflow), the order is **deterministic and non-blocking**:

1. **Notification write (S4)** — synchronous, inside the DB trigger. Guaranteed atomic with the source change: if the deal update rolls back, so does the notification.
2. **Activity log write (S5)** — synchronous, **same transaction**. Same atomicity guarantee.
3. **Celebration render (S14)** — **client-side only**. Fires after the frontend receives the Realtime notification event. Never blocks anything server-side; a missed or late celebration never affects the primary event.
4. **Downstream automations (S15)** — e.g. `client_testimonial` request, nurture-sequence adjustments, doctor-payroll/earnings updates. **Asynchronous**, queued by pg_cron or an Edge Function invocation. **NEVER fired from the same DB trigger as the notification** — this keeps the primary transaction fast, and a downstream failure can never roll back the primary event.

Steps 1–2 are one atomic DB transaction; step 3 is a client reaction to Realtime; step 4 is out-of-band. A failure in a later step never undoes an earlier one.

**Current multi-effect events** (side effects listed in firing order):

| Event | 1. Notification (S4) | 2. Activity log (S5) | 3. Celebration (S14, client-side) | 4. Downstream automations (async) |
|---|---|---|---|---|
| **DEAL_APPROVED** | ✓ DEAL_APPROVED | ✓ | medium | — |
| **DEAL_FUNDED** | ✓ DEAL_FUNDED | ✓ | big | testimonial request (S15.M4); commission-record wiring (C2) |
| **COMMISSION_PAID** | ✓ COMMISSION_PAID | ✓ | — (not a celebration trigger) | doctor earnings/payroll update (C3); streak/health metrics |
| **LEAD_QUALIFIED** | ✓ LEAD_CREATED_FOR_YOU | ✓ | small | nurture sequence auto-create + pg_cron scheduling (S15.M1) |

(Steps 1–2 are the DB-trigger layer built in A10/A11; step 3 is S14; step 4 lands with the referenced Phase C/E items. LEAD_QUALIFIED's notification + downstream activate in B2 when the `leads` table exists.)

---

## S16. EMAIL TEMPLATES & DESIGN SYSTEM (Roadmap A12 — canonical for all future emails)

Every automated email FNC sends is built from **one shared, bulletproof template** with swappable content variants. Established in A12 (PR #24). **Future email work — Phase C invoicing/statements, Phase D portal notifications, Phase E welcome/nurture flows — extends one of these four variants; nothing is designed from scratch.** Implementation: `supabase/functions/send-notification-email/email-template.ts`; contributor guide: `docs/email-templates.md`.

### S16.1 The four canonical layouts (PR #24)
A shared shell (header + content card + footer) wraps four body variants, each emitting **HTML + a matching plain-text body**:
- **`welcome`** — greeting + intro paragraph + CTA. Onboarding / first-touch.
- **`deal_approved`** — greeting + lead-in + green success band (holds the message) + CTA. Deal-state good news.
- **`weekly_summary`** — greeting + intro + stat tiles (a table row of cells) + status rows + CTA. Digests.
- **`commission_paid`** — greeting + lead-in + green success band + CTA. Money events.

**Structural blocks (all table-based, inline styles only):**
- **Gradient header block** — navy→teal linear-gradient (solid navy `bgcolor` fallback for Outlook), centered hosted **white FN mark**, "Many funders. More approvals." tagline (green-tint + cyan-tint spans), a 40×2px cyan accent bar, 3px cyan bottom border.
- **Content card** — white card, H1 title, "Hi {first_name}," greeting, body, bulletproof CTA button (role=presentation table + padded `<a>`).
- **Three-column footer block** — deep-navy; brand row (white mark + wordmark); three `<td>` columns **Offices / Contact / Connect** (Connect holds hosted white LinkedIn + TikTok PNGs); divider; legal row (© + CIPC + per-category subscription line + prefs link).
- **Plain-text fallback pattern** — wordmark + tagline, title, variant body (success line, or stat/status lines for digests), CTA URL, subscription + prefs URL, full contact block, © + CIPC.

### S16.2 Design tokens (shared with the CRM UI)
Navy `#1a3a52` (header / headings) · Teal `#2da8b8` + Cyan `#00C9D4` (accents) · Green `#5dba5d`→Teal gradient CTA · Deep-navy `#0d2438` (footer) · white `#ffffff` content card on `#e5e7eb`/`#f8f9fb` page · body ink `#334155` · muted `#8B95A5`. Typography: **Inter** (matching the app), declared `'Inter', Arial, Helvetica, sans-serif` — most email clients lack the web font and fall back to Arial/Helvetica, so never rely on Inter-only styling. 600px shell.

### S16.3 Locked contact block (Phase A closure — use exactly)
Fund Now Capital (Pty) Ltd · CIPC 2026/066284/07 · 010 102 0534 · hello@fundnowcapital.africa · www.fundnowcapital.africa · Cedarwood House, 128 Ballyclare Drive, Bryanston 2191 (Sandton) · 75 Marshall Street, Polokwane 0699 · LinkedIn (Fund Now Capital) + TikTok @fundnowcapital · tagline "Many funders. More approvals." **Never** put a personal email (e.g. `thapelol@…`) on an automated footer — `hello@` is the shared reply inbox.

### S16.4 Which variant each future email extends
- **Deal-state notifications** (`DEAL_APPROVED`, `DEAL_FUNDED`, `LEAD_CREATED_FOR_YOU`) → **`deal_approved`** layout.
- **Money notifications** (`COMMISSION_PAID`, invoice paid, payment received) → **`commission_paid`** layout.
- **Digests / summaries** (weekly summary, Doctor's monthly statements) → **`weekly_summary`** layout.
- **Onboarding / first-touch** (welcome, `LEAD_QUALIFIED`, client Trust Pack cover) → **`welcome`** layout.

(`deal_approved` + `commission_paid` share the green-success-band renderer; `welcome` + `weekly_summary` are live-dormant until B2 / C6.)

### S16.5 Adding a new event type
1. Add the value to the `notification_event_type` enum.
2. Pick one of the four canonical layout variants (S16.4). Every **production** email event must map to one of the four. `generic` is an internal safety-net fallback only — the same shared shell (header / footer / tokens) with a plain title + body + CTA and no variant-specific block; it exists so an unmapped event still renders on-brand rather than breaking, and is not a fifth brand template to design against.
3. Emit it via `emit_in_app_notification(...)` with a good `title`, `body_text`, optional `link_url` (keep funder names role-aware — fictional `display_name_for_partner` for partners).
4. Map it in `resolveVariant()` if it needs a specific layout; add its category to `eventCategory()` for the footer line.
5. If it should send email, confirm it's in the S4 email allow-list and that `notification_preferences` are backfilled.

### S16.6 Logo assets
`/public/logo-white.png` (white mark — dark backgrounds: header + footer) and `/public/logo-full.png` (colour lockup — light backgrounds: future PDFs / signatures). Social icons are hosted white PNGs (Outlook has no SVG). **Always reference logos/icons by absolute HTTPS URL** built from `APP_BASE_URL` — never inline-embed or use `data:` URIs.

### S16.7 Deliverability & compatibility rules (non-negotiable)
- **Plain-text fallback for every variant** (spam score + text-only clients).
- **Tables + inline styles only** — no CSS classes, no `<style>` block, no flexbox, no grid. (Consequence: no `@media` queries, so the layout does not stack on narrow screens; sizes are chosen to stay legible when the 600px shell is scaled down.)
- **Hosted PNG images**, absolute HTTPS, with `alt` text (SVG unsupported in Outlook/Gmail).
- Outlook fallbacks for gradient (`bgcolor`); don't rely on `border-radius`/`box-shadow` for legibility.
- Tested against Outlook, Gmail web, Gmail iOS/Android, Apple Mail.

---

## SA VALIDATION RULES (used everywhere)

- **SA ID:** 13 digits, Luhn checksum, valid DOB + citizenship digit.
- **CIPC:** YYYY/NNNNNN/NN.
- **VAT:** 10 digits starting 4.
- **Cell:** +27/0 then 6/7/8, normalised storage.
- **Postal code:** 4 digits.
