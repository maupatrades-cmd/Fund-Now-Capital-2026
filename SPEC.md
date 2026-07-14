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

## SA VALIDATION RULES (used everywhere)

- **SA ID:** 13 digits, Luhn checksum, valid DOB + citizenship digit.
- **CIPC:** YYYY/NNNNNN/NN.
- **VAT:** 10 digits starting 4.
- **Cell:** +27/0 then 6/7/8, normalised storage.
- **Postal code:** 4 digits.
