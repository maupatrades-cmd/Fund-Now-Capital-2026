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

**Build status (B1 — shipped):** `industries`, `sub_industries`, and `funder_industry_preferences` tables live with RLS from day one. `industries`/`sub_industries` are reference data (owner read/write; all app users read). `funder_industry_preferences` is **owner-only** at the table level (it carries `funder_id` + owner-only `notes`); partners reach appetite through the anonymised view `public.partner_funder_industry_appetite`, which exposes `display_name_for_partner` + industry + `appetite_level` **only** — never `funder_id`, the real name, or `notes` (funder-anonymisation rule). All 25 industries + sub-industries seeded exactly as above; the baseline appetite matrix seeds only for funders present on the panel (missing funders skipped, count reported via `RAISE NOTICE`). `appetite_level` enum = `high | medium | low | avoid`. Owner management screen at `/settings/industries` (Industries tree + Funder appetite matrix tabs).

**`clients` taxonomy:** `clients` gained nullable `industry_id` + `sub_industry_id` FKs and a free-text `sector_notes`. The legacy `clients.sector` free-text column is **intentionally retained, not auto-migrated** — the owner reconciles it manually. `sector` is **deprecated and slated for removal once B2 lands** (lead entry captures industry structurally from the start). The client form now uses the two-level industry → sub-industry dropdown + `sector_notes`; `sector` is no longer edited in the UI (existing values preserved on save).

**Funder count — two figures by design (LOCKED):** Two funder figures exist by design. The email marketing copy references '43+ funders' — this is the wider panel narrative used in outbound communications (welcome emails, deal notifications, brand messaging). It is a marketing figure only. The CRM database contains 21 funders — the operational ones with signed or verbal contracts. These are the funders that appear in the pipeline, receive submissions, are recommended by the industry appetite matrix, and pay commission. Adding a funder to the CRM database is a deliberate act triggered by a new contract, not a background sync. The two figures should NOT be reconciled. Un-contracted funders exist for outreach but are intentionally invisible to the CRM.

**Appetite matrix — operational reconciliation:** Against the 21 operational CRM funders, the S1 baseline seeds appetite for **12** of them (51 preference rows: 36 high · 12 medium · 3 avoid); the remaining **9** funders are **unscored pending owner input** via the Funder appetite matrix at `/settings/industries`. This 12-scored / 9-unscored split reflects the 21-funder operational reality — it is not measured against the 43+ marketing figure.

---

## S2. LEAD ENTRY & QUALIFICATION (Part 2 — Roadmap B2)

Two entry paths: (A) partner submits via portal (Phase D); (B) owner manual entry (build now). Owner-only extra fields: `referred_by` dropdown (self/bright_destiny/other+name), `entered_by` (auto), `loaded_on_behalf` bool, `original_referrer_id`, `referral_date` (auto, editable), "notify partner now" toggle (default YES → fires LEAD_CREATED_FOR_YOU when notifications live).

`leads` table: id, business_name*, entity_type enum(pty_ltd/cc/sole_prop/trust/partnership/ngo/other), cipc_number (format-validated), industry_id FK*, sub_industry_id FK, sector_notes, website, trading_history_months, employee_range enum(1-5/6-20/21-50/51-200/200+), monthly_turnover_range enum(<50k/50-100k/100-250k/250-500k/500k-1m/1-2.5m/2.5-5m/5m+), annual_turnover, primary contact fields (name*, role, cell* SA-validated, email*, id_number), physical_address, registered_address, region, funding_amount, funding_purpose jsonb multi (stock/equipment/working_capital/expansion/bridging/debt_consolidation/property/vehicles/other), funding_timeline enum(urgent_7d/30d/90d/flexible), has_existing_debt bool + existing_debt_details jsonb, security_available jsonb multi (property_res/property_comm/property_agri/vehicles/equipment/livestock/stock/invoices_receivables/contract_cession/suretyship/none), referred_by, referred_by_other text (nullable), referral_partner_id FK, entered_by FK, loaded_on_behalf, original_referrer_id, initial_notes, qualification_stage enum(new_lead/under_qualification/qualified/not_qualified), not_qualified_reason enum (list below), not_qualified_notes (optional as built in B2.2 — see the B2.2 note below), follow_up_date, created_at, updated_at, qualified_at, qualified_by.

When `referred_by = 'other'`, `referred_by_other` captures the free-text referrer name. When `referred_by ∈ ('self','bright_destiny')`, `referred_by_other` is null — enforced by the `leads_referred_by_other_scope` CHECK (`referred_by_other` may be set only when `referred_by = 'other'`; partial capture still allows 'other' to be blank at entry). B2.1: `entered_by` is authoritative in the DB — column default `auth.uid()` plus a restrictive `leads_entered_by_is_caller` INSERT policy requiring `entered_by = auth.uid()` (not client-supplied). **Required-field note:** B2.1 entry requires only `business_name` + `contact_name`, so leads can be captured partial and completed later; the `*`-marked fields (`industry_id`, `contact_cell`, `contact_email`) are enforced at the qualification gate (B2.2), not as table-level NOT NULLs.

On `qualification_stage → qualified`: auto-create linked `deals` row at stage 'Qualifying', copy/attach client (create client if new, duplicate-check first per S6-lite).

**B2.2 (built):** implemented as the atomic `qualify_lead(lead_id)` RPC — matches an existing client by case-insensitive `business_name` or creates one (+ primary `client_contacts` row) from the lead, then creates the deal at `qualifying` linked via `deals.lead_id` (also carrying `funding_purpose`/`funding_timeline` copied from the lead), and marks the lead qualified. **Idempotent** (one-deal-per-lead unique index; re-qualifying returns the existing deal). The `leads_qualification_guard` trigger makes `qualified` terminal, rejects a null `not_qualified_reason`, and stamps `qualified_at`/`qualified_by` server-side. `not_qualified_notes` is optional (relaxed from the S6 "required if reason=other" note for B2.2 partial capture).

**Document verification gate (B3.2):** `qualify_lead` now takes a second arg — `qualify_lead(lead_id, override boolean default false)` — and enforces the S6 document gate: it **blocks** qualification when required categories lack an accepted current document (Business: CIPC + tax clearance · Financial: bank statement · Personal: ID copy + proof of address), unless the owner passes `override` (UI requires typing `OVERRIDE`), which proceeds and logs the missing categories to `activity_logs`. On successful qualify, the lead's documents re-point to the created/matched client. See S6 (B3.2) for the full workflow.

`qualify_lead` runs **`SECURITY DEFINER`** (with `SET search_path = ''`) because it orchestrates a locked-down internal helper — `log_qualification_override()` — whose EXECUTE is revoked from every API role so it can never be called directly to forge a `QUALIFICATION` audit row. The gate remains **`is_owner()` at function entry**, and `auth.uid()` under DEFINER still returns the caller, so there is no privilege escalation and `created_by` attribution stays honest. (Hotfix: B3.2 first shipped it as `SECURITY INVOKER`, so the override-with-missing-categories path hit a 403 — `42501 insufficient_privilege` on the revoked helper — until this was corrected.)

**Duplicate detection (B2.3, built):** at lead-entry time the Add-Lead form calls the read-only `find_lead_duplicates()` RPC and gates the save on the result. Two tiers:
- **CIPC exact match → HARD BLOCK.** A CIPC number is a unique legal identifier, so a second lead with the same one is the same legal entity — the save is rejected with "A lead already exists for this CIPC number — {business name}. Open the existing lead instead." Enforced **both** client-side (the form blocks) **and** server-side by the `leads_cipc_block` BEFORE-trigger (fires on insert/update of `cipc_number`), so a bypassed client check can never create a CIPC duplicate. (A CIPC match against an existing *client* is surfaced as a warn, not a block — a repeat client may legitimately need a new lead.)
- **Fuzzy business-name similarity ≥ 0.75, or exact `contact_email` / normalised `contact_cell` → SOFT WARN.** The form lists the similar leads/clients and requires the owner to type `SAVE` to proceed. Advisory only — matching is `pg_trgm similarity()` on `lower(business_name)` (GIN-trgm indexed on leads + clients) plus exact email/cell against leads. The current lead is excluded from its own check on edit.

This is entry-time dedup, not deal-level enforcement: two *distinct* leads (no shared CIPC) can still each be qualified into their own deal. Hard prevention of a second deal for a client that already has one remains a separate future guard (a client/deal-level uniqueness check or a qualification-time override gate) — still deferred; see ROADMAP "Deferred Polish" for the interim SQL cleanup path.

**Lead activity + notifications (B2.3, built):** the A10 `log_activity()` trigger is now attached to `leads` (entity_type `lead`): INSERT→`CREATE`, edits→`UPDATE`, and a `qualification_stage` transition→`QUALIFICATION` (linking the created deal when qualified) — visible on the lead-detail Activity section and the `/activity` timeline (S5). Lead events also fire notifications through the A11/A12 in-app + email path (S4): `LEAD_STARTED_QUALIFICATION` (owner), `LEAD_QUALIFIED` / `LEAD_NOT_QUALIFIED` (owner **and** the referring partner when not self-referred — partner body carries the reason category only, **never** `not_qualified_notes`, per `partner_leads_view` PII rules), `LEAD_UPDATED` (owner only), and `LEAD_CREATED_FOR_YOU` (to the loaded-on-behalf referrer). Email is on for the three partner-relevant milestones (reusing the `deal_approved` / `welcome` S16 layouts with lead copy) and off by default for the two owner-only signals; partners have no login yet (Phase D) so their notifications land silently.

**Partner-facing lead identifier (B2.3):** every partner-facing lead notification/email uses the LEAD's `business_name` (the business the partner referred), never the client record created at qualification — they are usually the same string, but the semantics are "the business you referred". Partner bodies carry only `business_name` + (not-qualified) the reason category; they never carry contact PII (name / id / cell / email / role), addresses, `initial_notes`, `not_qualified_notes`, or funder identity beyond `display_name_for_partner` — mirroring `partner_leads_view`.

**Sole-trader `business_name` caveat (partner_leads_view):** for sole-trader businesses where `business_name` IS the individual's name, `business_name` itself carries personal data. An owner-facing UI to flag sole traders and prompt confirmation before qualifying is **deferred** (see ROADMAP "Deferred Polish"). Present handling: rely on owner judgement at qualification time.

Not-qualified standard reasons (enum, exact list): no_cipc · trading_history_too_short · turnover_too_low · sector_not_serviced · over_leveraged · bank_statement_issues · client_unresponsive · unrealistic_expectations · already_declined_by_likely_funders · no_security_for_asset_needs · timing_not_right · sector_risk_too_high · documentation_impossible · compliance_concern · other

Partner view (Phase D): sees his own not-qualified leads + reason (educational); auto-archive unqualified after 6 months.

---

## S3. CLIENT STORY & CALL LOGS (Part 2 — Roadmap B4)

`client_stories`: id, client_id FK, business_story, founder_background, business_origin, competitive_edge, aspirations, contact_story, family_context, personal_interests, language_preference, communication_style, assets_narrative, initial_assessment, ongoing_impressions (append-only: store as jsonb array of {text, author, at} or child table), concerns_flagged, opportunities_seen, created_at, updated_at. Story is never overwritten — updates append. Rich text = markdown in text columns for now.

`call_logs`: id, client_id FK, date, time, medium enum(call/whatsapp/meeting/email/message), duration_minutes, discussed_topics, client_promises, thapelo_promises, follow_up_needed bool, follow_up_date, next_action, created_at, created_by. Follow_up_date due → FOLLOW_UP_DUE notification (once A11 live).

Client detail gains tabs: Overview / Story / Deals / Documents / Communications / Call Log. First real capture: Fepa Sechaba Milling and Mining (contact Tumi) — mining (chrome+gold) + farming, R20M trust, R1bn Reserve Bank deal (nature TBD), assets: trucks/property/livestock/equipment/mining rights. Suggested funders per matrix: PrefCap, Paragon, Business Partners, Sourcefin. Qualifying questions to log: CIPC; mining rights S27 MPRDA vs S16 prospecting; Reserve Bank deal nature+stage; trust structure/trustees; specific funding need.

**Build status (B4 — built):**
- **`client_stories`** — 1:1 with `clients` (UNIQUE `client_id`), all the narrative fields above as editable markdown-text columns + `created_by`/timestamps. The 1:1 row is **created on first save** (upsert on `client_id`), so there are no empty story rows.
- **`ongoing_impressions` → child table `client_story_notes`** (id, story_id FK, text, author_id, created_at). **Append-only enforced at the DB layer via RLS** — the table has **SELECT + INSERT policies only** (no UPDATE/DELETE path through the API), so an impression can never be edited or removed. (Chosen over a jsonb array for per-note author/timestamp + clean append.)
- **`call_logs`** — all fields above; `date`→`call_date`, `time`→`call_time` (reserved words); `medium` is the `call_medium` enum. A `call_logs_followup_needs_date` CHECK requires a `follow_up_date` whenever `follow_up_needed`.
- **`FOLLOW_UP_DUE`** — fires from a **daily pg_cron sweep** `check_followups_due()` (04:15 UTC / 06:15 SAST, offset from the 04:00 document-expiry sweep) to the owner (in-app + email, `weekly_summary` layout per S16.4). Detection is the read-only `followups_due()`; dedup is a once-per-follow-up ledger `call_log_followup_alerts` with **claim-then-act** (claim the ledger row before emitting). Body names the client, the next action, and the source call/medium+date.

**Timezone convention (SAST-native):** all scheduled sweeps and date-based user-facing comparisons use **`public.current_sast_date()`** — the current date in Africa/Johannesburg (UTC+2). The CRM operates in SAST because the business operates in SAST. **Never use raw `current_date`** (which is UTC) in scheduled-job logic — that creates a 2-hour midnight gap where late-night SAST entries look like tomorrow to the database. The pg_cron **schedules** themselves run in UTC (that's the underlying scheduler); only the comparison logic *inside* the sweeps is SAST-native. Applies to the follow-up sweep (`followups_due` / `check_followups_due`, S3) and the document-expiry sweep (`document_expiry_due` / `mark_expired_documents` / `check_document_expiries`, S6); every future scheduled job must use `current_sast_date()`. *(Introduced as a B4 hotfix after a follow-up logged at 01:48 SAST — 23:48 UTC the prior day — was missed by the UTC comparison.)*
- **RLS: owner-only on all four tables** — these hold personal/family narrative (POPIA-sensitive); partners never see client stories or call logs, now or in Phase D.
- **Activity logging (A10):** `log_activity()` extended with `client_story` + `call_log` branches (linked to the client so events show on the client Activity tab); `client_story_notes` is deliberately **not** double-logged — the impressions stream is its own append-only audit trail. *(As with leads/clients, `client_stories` UPDATEs capture narrative before/after in `activity_logs` — the same owner-only, F10-tracked PII-redaction follow-up applies.)*
- **UI:** client-detail **Story tab** (narrative form + append-only impressions feed) + **Call Log tab** (log-a-call form + history with follow-up pills). Migrations are all new empty tables (inline FKs/indexes — no NOT VALID/CONCURRENTLY needed); DO-block assertions gate the schema migration.

**B4.1 follow-up refinement (✅ BUILT — PR #63, applied + verified live + owner smoke test PASSED 2026-07-20):** Client Story is now writable on the **lead** detail page (pre-qualification) and migrates to the client at qualification. **As built:** `client_stories` + `client_story_notes` moved to the XOR ownership model (nullable `client_id` ⊕ `lead_id`, `num_nonnulls(lead_id, client_id) = 1` CHECK) — `client_id`'s plain UNIQUE stays (NULLs distinct) and a symmetric plain `UNIQUE(lead_id)` (one story per lead) was built CONCURRENTLY; `client_story_notes` was **not** changed (it keys on `story_id`, which is stable across a re-point, so impressions ride along automatically). `StoryPanel`/`useClientStory` were entity-parameterised (`StoryEntity {kind:'lead'|'client', id}`), and a Story section sits **below Documents** on lead detail. Export is a client-side **curated 7-section markdown** builder (Copy + Download `.md`). `qualify_lead` (6th touch) re-points the story + impressions to the client; **conflict decision = MERGE-APPEND** — when the matched client already has a story, keep it as source of truth, move the lead story's impressions onto it, fold the lead narrative into one dated impression, delete the emptied lead story (nothing lost). The jsonb return grew to **10 keys** (+`story_count_migrated` +`story_notes_count_migrated`), and an owner-only `STORY_MIGRATED_LEAD_TO_CLIENT` activity event is logged once per migrated story. Original design intent (retained for reference):
- Make `client_stories` writable on the **lead** detail page in addition to client detail.
- Add a 'Story' section on lead detail, positioned **below** the Documents section.
- At qualification, story rows migrate from lead → client alongside the documents migration trigger (same pattern as B3.2's lead→client document re-pointer).
- Owner can export the story as structured markdown/text for use in Claude or other tools to draft funder-ready pitch narratives.
- **Ownership model (build-time contract to settle before implementation):** the current `client_stories` 1:1 is keyed on `UNIQUE client_id` (NOT NULL). Lead-writable stories require an explicit owning key — model it on the `documents` pattern: nullable `client_id` **XOR** `lead_id` with a `num_nonnulls(lead_id, client_id) = 1` CHECK and a per-entity uniqueness constraint (one story per lead, one per client). Migration at qualify must re-point `client_id`/`lead_id` on **both** `client_stories` and `client_story_notes`, and repoint the story's `activity_logs` references, in one transaction. Define conflict behaviour when the lead maps to an **existing** client that already has a story (merge-append the impressions vs block-with-notice — decide at build). Owner-only RLS carries over unchanged (partners never see stories — S3).
- Estimated 1 PR, ~2 hours build (the ownership-model migration may push this slightly).

Priority: after Phase B closes (B5 SA validation ships first) — small enough to slot in as **B4.1** before Phase C opens, OR defer to Phase E1 if C0 momentum is prioritised. **Elevated to priority follow-up after B5** because it is the substrate for the E3/E6 auto-generation flow (see **S6a** Deal Package Auto-Generation and **S17b** Claude Story Refiner) — the story captured pre-qualification feeds the refined credit case. Suggested build order: **B5 → B4.1 → C0 → C1 …**

**Owner intent — B4 close-out (2026-07-19), for future sessions:** the owner identified that (a) client story is broker-facing insight best captured **pre-qualification** (this B4.1 refinement); (b) the funder-submission **consent pack** shipping alongside application signing is essential for NCR/FAIS/POPIA compliance (S17 scope expansion) — funder submissions cannot ship to clients in production without both consent documents in signed form; (c) signing links need **7-day expiry with owner-initiated reset** for the busy-SA-client reality (S17); (d) **Terms & Conditions** must exist for both client-side (bundled with the S17 consent pack) and partner-side (Phase D onboarding, S11); (e) **follow-on deals** for repeat clients get a proper workflow in Phase D (S11). All architectural — no implementation begins now.

---

## S3a. STAKEHOLDERS — Directors, Shareholders, Beneficial Owners (Part 2 — Roadmap B6)

**Status: docs only, NOT started (B6, opens before Phase B closes).** SA business finance requires capturing **directors, shareholders (25%+ holdings for POPIA/FICA), sureties, and beneficial owners** — plus **passport support for foreign directors**. The CRM today captures only a single `contact_name` + `contact_id_number` per lead/client (via `client_contacts`); B6 adds a full stakeholder structure. **Owner-locked decisions (2026-07-20):** (1) one row **per person** with a `roles` array; (2) shareholding-total over 100% **warns, never blocks**; (3) passport country is an **ISO dropdown**; (4) beneficial-owner is **auto-suggested at ≥25%, owner-overridable**; (5) **no ownership backfill** of the existing clients — the owner enters real cap-table data.

**Table `client_stakeholders` (one row per person):**
- `id uuid PK`, `client_id uuid` FK (nullable), `lead_id uuid` FK (nullable — set when captured pre-qualification).
- `full_name text NOT NULL`.
- `id_type` enum `stakeholder_id_type` (`sa_id` | `passport`) — drives the validation branch.
- `id_number text` — SA ID (Luhn-validated via B5.1 `sa-validation.ts`) **or** passport number (free-text, 6–12 alphanumeric).
- `passport_country text` — ISO 3166 **alpha-2** code, set only when `id_type = 'passport'` (nullable otherwise). **Decision 3:** captured via an ISO country **dropdown**, not free-text (avoids "RSA"/"South Africa"/"ZA" drift that would break future FICA reporting / E6 screening).
- `roles stakeholder_role[] NOT NULL` — enum `stakeholder_role` (`director` | `shareholder` | `surety` | `key_person` | `signatory`). **Decision 1:** one row per *person* carrying all their hats, rather than a row per role — a director who is also a surety is one human, so PII/ID is captured once and shareholding/beneficial-owner/consent-routing attach to the person cleanly. (A non-empty CHECK guards `array_length(roles,1) >= 1`.)
- `shareholding_percent numeric(5,2)` — nullable (only for holders). CHECK `shareholding_percent IS NULL OR (shareholding_percent BETWEEN 0 AND 100)`. **Decision 1 corollary:** the "shareholder needs a %" rule becomes `'shareholder' = ANY(roles) → shareholding_percent IS NOT NULL`.
- `is_beneficial_owner bool NOT NULL DEFAULT false` — true when the person holds ≥25% direct/indirect beneficial interest (FICA). **Decision 4:** the UI **auto-suggests** on when `shareholding_percent >= 25` with a "FICA: ≥25% suggests beneficial owner" hint, but the owner can override either way (beneficial ownership can be true below 25% via agreements, or false above) — the DB stores the owner's final value, never auto-forces it.
- `cell text`, `email text`, `physical_address text` — for consent-pack routing (S17). `notes text`.
- `created_at`, `updated_at`, `created_by uuid` FK `profiles(id)`, `updated_by uuid` FK `profiles(id)`.

**CHECK constraints:** `num_nonnulls(lead_id, client_id) = 1` (XOR — documents pattern); `id_type='passport' → passport_country IS NOT NULL`; `id_type='sa_id' → passport_country IS NULL`; the shareholding range + `'shareholder' = ANY(roles)` rule above; non-empty `roles`.

**Validation (app-side, B5.1 lib):** SA ID → Luhn + DOB + citizenship digit; passport → free-text 6–12 alphanumeric **with** a required ISO country. **Shareholding total (decision 2):** the UI **warns** (amber) when the sum of `shareholding_percent` across a client's stakeholders exceeds 100% (and gently notes "X% unallocated" below 100) — but **never blocks the save**; real cap tables carry rounding, treasury shares, and partial-knowledge-at-capture.

**Lead → client migration:** captured pre-qualification on a lead, stakeholders migrate `lead_id → client_id` at `qualify_lead` — the **same transactional re-pointer pattern as B3.2 documents**, in the same qualify path, preserving the `num_nonnulls = 1` CHECK. Legacy `contact_*` fields on `leads`/`clients` are **retained** (no data loss) but **deprecated** for new capture — B6 UI is the source of truth. At the first post-B6 qualification of a lead that has a `contact_id_number` but no stakeholder rows, a **`signatory` stakeholder is auto-created** from the contact fields for the owner to review.

**RLS:** Owner — full CRUD. Partner — SELECT scoped to their referred leads/clients (via `referral_partner_id`), seeing **`full_name`, `roles`, `shareholding_percent` only** (FICA transparency); **never** `id_number`, `passport_country`, `cell`, `email`, `physical_address` (PII — same POPIA exclusion pattern as documents, CLAUDE.md rule 7). **No partner INSERT** in B6 (the Phase D portal handles partner capture). Every mutation uses `.select()`/RETURNING with a row-count check (silent-RLS rule).

**Activity logging (A10):** `log_activity()` gains a `client_stakeholder` branch (CREATE/UPDATE/DELETE, linked to the owning client/lead) — same as documents/leads/clients.

**Backfill (decision 5):** the three live clients (Mama Mabase, Fepa Sechaba, NRL Bakwena) start with **no stakeholder rows** — the owner enters real cap-table data when convenient. We do **not** auto-suggest ownership from the single legacy contact field: that would *invent client data we don't actually know* (a contact isn't necessarily a 25% owner), a FICA/data-integrity risk (CLAUDE.md "never invent facts").

**Out of scope for B6 (deferred):** automatic beneficial-ownership calculation from nested corporate ownership (parent companies, trusts) → **Phase E / deferred polish**; sanctions/PEP screening on stakeholder identities → **Phase E6** (AI); consent-pack (S17) auto-population from stakeholders → **Phase E4** wires it.

**PR breakdown:** **B6.1** — schema + enums + CHECKs + RLS + `log_activity()` branch + the `qualify_lead` stakeholder re-pointer + legacy-contact auto-create + DO-block assertions (FK-adds on the populated `leads`/`clients` use `NOT VALID` + `CREATE INDEX CONCURRENTLY` + `VALIDATE`; `client_stakeholders` itself is a new empty table, inline FKs). **B6.2** — UI: "Directors & Shareholders" section on lead + client detail, add/edit modal (SA-ID/passport toggle with conditional country dropdown, multi-role select, conditional shareholding, auto-suggest beneficial-owner toggle, contact fields), and a read-only summary card ("3 directors · 2 shareholders · 1 surety").

---

## S4. NOTIFICATIONS (Part 4 — Roadmap A11/A12, D6)

Tables:
- `notifications`: id, user_id FK, event_type, title, body_text, body_html, link_url, data jsonb, read_status bool, created_at, read_at
- `notification_deliveries`: id, notification_id FK, channel enum(email/whatsapp/sms/in_app), delivery_status enum(pending/sent/delivered/failed), sent_at, delivered_at, error_message, external_id
- `notification_preferences`: id, user_id, event_type, email_enabled, whatsapp_enabled, sms_enabled, in_app_enabled, quiet_hours_start, quiet_hours_end, digest_mode, updated_at

`profiles` gains: phone_number, phone_number_verified, whatsapp_opted_in, sms_opted_in.

Event types (enum): LEAD_CREATED_FOR_YOU, LEAD_SUBMITTED_BY_PARTNER, LEAD_QUALIFICATION_UPDATED, LEAD_STARTED_QUALIFICATION, LEAD_QUALIFIED, LEAD_NOT_QUALIFIED, LEAD_UPDATED, LEAD_DOCUMENT_REJECTED, DEAL_SUBMITTED_TO_FUNDER, DEAL_APPROVED, DEAL_DECLINED, DEAL_FUNDED, COMMISSION_PAID, FUNDER_RESPONSE_RECEIVED, CLIENT_MESSAGE_RECEIVED, FOLLOW_UP_DUE, BADGE_EARNED, MONTHLY_TARGET_MILESTONE, TIER_REVIEW_UPCOMING, FUNDER_RATE_CONFIRMED, DOCUMENT_UPLOADED, DOCUMENT_EXPIRING_30D, DOCUMENT_EXPIRING_7D, DOCUMENT_EXPIRED, SYSTEM_MAINTENANCE, WEEKLY_SUMMARY. (The four `LEAD_STARTED_QUALIFICATION` / `LEAD_QUALIFIED` / `LEAD_NOT_QUALIFIED` / `LEAD_UPDATED` values were added in B2.3, superseding the coarse `LEAD_QUALIFICATION_UPDATED` placeholder, which is retained but unused. The three `DOCUMENT_EXPIRING_30D` / `_7D` / `DOCUMENT_EXPIRED` values were added by the B3 expiry-alert PR and fire from the daily `check_document_expiries()` pg_cron sweep — owner-targeted, once-per-(document,threshold), `weekly_summary` email layout per S16.4. `LEAD_DOCUMENT_REJECTED` was added in B3.2 and fires from the `documents_notify_rejected` trigger to the lead's referring partner — POPIA-safe (document category + reason category only), `weekly_summary` email layout per S16.4. `DOCUMENT_UPLOADED` exists but no trigger emits it yet.)

Phase A scope: in-app bell (badge count, dropdown last 10, mark read/all, Realtime updates) + Notification Center page (filter/search/bulk) + Resend email for LEAD_CREATED_FOR_YOU, DEAL_APPROVED, DEAL_FUNDED, COMMISSION_PAID only. Branded HTML template (navy header, teal CTA button, unsubscribe/prefs link). From hello@fundnowcapital.africa via Cloudflare routing; Google Workspace MX untouched; SPF already includes resend.

Phase D scope: Twilio WhatsApp (pre-approved templates, emoji style per Part 4, always ends with CRM link + "— Fund Now Capital"), SMS fallback after 60s failure, retry 3x exp backoff, quiet hours, digest mode, prefs page with per-event channel matrix.

**CRITICAL: partner-facing notification bodies use fictional funder names only.**

**A11 implementation notes (as built):**
- Only the **in-app** channel is emitted in Phase A. Each in-app notification writes one `notification_deliveries` row with `channel='in_app', delivery_status='delivered'`. Email/WhatsApp/SMS delivery is A12/D6.
- Emitted by SECURITY DEFINER triggers: **DEAL_APPROVED** (a `deal_funder_submissions` row → `approved`), **DEAL_FUNDED** (a deal → `funded` stage), **COMMISSION_PAID** (a `commission_records` row gets `payment_received_date` set). **LEAD_CREATED_FOR_YOU** was a documented placeholder in the A11 migration — **activated in B2.3** by its own INSERT trigger `notify_lead_created_for_you` (fires when a lead is loaded on behalf of a referrer, exactly the placeholder's predicted name). The qualification-lifecycle events `LEAD_STARTED_QUALIFICATION` / `LEAD_QUALIFIED` / `LEAD_NOT_QUALIFIED` / `LEAD_UPDATED` fire from the UPDATE trigger `notify_lead_events` (see S2 "Lead activity + notifications").
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
- Triggers are attached to **deals, deal_funder_submissions, clients, client_contacts, commission_records**, and — as of **B2.3** — **leads** (entity_type `lead`; a `qualification_stage` transition emits the `QUALIFICATION` event and links the created deal). See S2 "Lead activity + notifications".
- Event-type mapping: INSERT→`CREATE`, UPDATE→`UPDATE`, DELETE→`DELETE`; a deal update that changes `stage`→`STAGE_CHANGE`; **all** `deal_funder_submissions` writes→`SUBMISSION` (the description carries the added/updated/status-change detail). `changed_fields`/`before_values`/`after_values` are captured on UPDATE (excluding `updated_at`).
- `entity_type` values are singular strings: `deal`, `deal_funder_submission`, `client`, `client_contact`, `commission_record`. `related_entity_ids` links children to parents (submissions/commission → deal; contacts/deals → client) so a deal's Activity tab picks up its submissions and a client's picks up its deals + contacts.
- RLS: **owner-only SELECT**; no insert/update/delete policy exists, so the trail is written only by the SECURITY DEFINER trigger and is immutable through the API. `ip_address`/`user_agent`/`session_id` are left for the app layer (auth/READ events, Phase E/F). READ logging is **not** enabled at this stage.
- Frontend: Activity **section** on the deal detail page (which uses stacked sections, not a tab bar) and an Activity **tab** on the client detail page; owner `/activity` timeline with date/user/event/entity filters, description search, and CSV export (client-side; latest 500 per page).

**PII in before/after snapshots (current behaviour — known, tracked):** on an **UPDATE**, `activity_logs` captures the old and new *values* of the changed fields — which includes sensitive PII when such a field is edited (`contact_id_number`, `contact_cell`, `contact_email`, addresses, notes) across `leads`, `clients`, and `client_contacts`. (INSERT/DELETE store no value diff.) Access is **owner-only via RLS**, and the trail is immutable and retained ~7 years by design (POPIA record-keeping). Redacting these values from the snapshots (uniformly across the three entities) + a right-to-erasure workflow is a deliberate follow-up — **ROADMAP F10 (POPIA Audit Trail Compliance Pass)** — not done in B2.3.

---

## S6. DOCUMENT MANAGEMENT UPGRADE (Part 6 M1 — Roadmap B3 core, E/F extras)

**Build status (B3.1 — shipped ✅, applied + verified live):** schema (PR #42 + deferrable-FK hotfix #43) and owner-facing UI (PR #44) are live. The as-built detail below is the source of truth. 9-point smoke test passed against real production data (Mama Mabase JV: CIPC + 2 concurrent bank-statement months with versioning — the first real documents in the CRM). Remaining B3 slices: **expiry-alert automation** (DOCUMENT_EXPIRING_* via pg_cron — not yet built) and **B3.2** (per-document verification workflow — not yet built; previewed at the end of this section).

B3 core slice — turn the thin `documents` table into a governed store: full
taxonomy enum, audit-truth provenance, type-aware version control, period-scoped
"packs", expiry defaults + alerts, and a partner-aware RLS matrix. Split into
**B3.1** (this foundation) and **B3.2** (per-document verification workflow +
qualification gate — follow-up).

**B3.1 taxonomy (as built — `document_type` enum, 52 values across 8 categories + `other`):**
- **business:** cipc_cert, company_profile, tax_clearance, bee_cert, moi, trading_license, shareholder_register, director_appointment
- **financial:** bank_statement, financial_statements, mgmt_accounts, debtors_ageing, creditors_ageing, cashflow_projection, budget
- **personal:** id_copy, proof_of_address, anc_contract, personal_financials, spousal_consent, marriage_cert
- **deal:** application_form, credit_consent, purchase_order, cession, suretyship, personal_guarantee, business_plan, quotation, invoice_doc
- **asset:** natis, vehicle_license, title_deed, valuation_report, equipment_schedule, livestock_inventory
- **compliance:** fica_pack, popia_consent, source_of_funds, tax_residency
- **funder_comms:** approval_letter, decline_letter, offer_letter, term_sheet, funder_agreement, submission_cover
- **fnc_business:** invoice_sent, commission_agreement, referral_agreement, msa, welcome_pack
- **other:** other

The type→category mapping is the IMMUTABLE `document_type_category()` function (single source of truth; hardcoded for B3.1, a configurable metadata table deferred to Phase F). `category` is a **stored generated column** (`document_category` enum) so category filters are indexable and can never drift. The 8 named categories are the UI filter chips; `other` is the catch-all bucket.

**B3.1 columns (as built).** `doc_type` (text) was dropped and recreated as `document_type` (enum, NOT NULL); `file_name` renamed → `filename`. Added:
- **Provenance (audit-truth, immutable):** `uploaded_by uuid NOT NULL DEFAULT auth.uid()` (FK → `profiles(id)` ON DELETE RESTRICT — profiles.id === auth.users.id, and the profiles FK is what the UI joins for the owner/partner "uploaded by" badge), `upload_source` enum(owner/partner/client/funder) NOT NULL DEFAULT 'owner'. A BEFORE-UPDATE trigger (`documents_prevent_audit_rewrite`) blocks any change to these two for **every** role including owner.
- **Ownership:** `lead_id uuid` FK → leads (nullable, **`ON DELETE RESTRICT`** — governed documents never vanish silently when a lead is deleted; the owner must deal with them explicitly first). `client_id` unchanged. CHECK `num_nonnulls(lead_id, client_id) = 1` (exactly one owning entity; replaces the old client-or-deal check). `deal_id` stays an orthogonal optional pointer. `owning_entity_id` is a **stored generated** `coalesce(client_id, lead_id)` so version/supersede logic works whether a doc hangs off a lead or a client.
- **Periods:** `period_start`, `period_end` dates. CHECK: period-scoped types **must** carry a period; non-period types must not.
- **Versioning:** `version_number int NOT NULL DEFAULT 1`, `is_current_version bool NOT NULL DEFAULT true`, `superseded_by uuid` FK → documents, `is_period_scoped` stored generated bool.
- **Lifecycle + metadata:** `status` enum(active/archived/expired/rejected) NOT NULL DEFAULT 'active', `expiry_date date`, `received_from text`, `notes text`, `tags text[]`, `shared_with text[]`, `updated_at timestamptz`.

**Type-aware version supersede (Postgres trigger `documents_apply_versioning`, race-safe):** on insert, a **non-period** type supersedes on key `(owning_entity_id, document_type)` — the prior current version flips `is_current_version=false` + `superseded_by=<new>`, the new row becomes version N+1. A **period-scoped** type (bank_statement, financial_statements, mgmt_accounts, debtors_ageing, creditors_ageing, cashflow_projection) keys on `(owning_entity_id, document_type, period_start, period_end)` — so multiple concurrent periods (a 12-month SA bank-statement pack) all stay current; only a re-upload of the **same** period supersedes. Race safety is guaranteed at the DB layer by two partial unique indexes (`documents_current_nonperiod_uq`, `documents_current_period_uq`) — the trigger keeps at most one current version per key and the indexes enforce it under concurrency. Documents are never deleted.

**Default expiry (IMMUTABLE `document_default_expiry()`, applied at insert unless the owner supplies one):** bank_statement → period_end + 3mo · proof_of_address → upload + 3mo · tax_clearance / bee_cert / fica_pack → upload + 12mo · financial_statements → period_end + 12mo · cipc_cert / moi / title_deed / popia_consent / anc_contract → no expiry · everything else → null (owner sets manually).

**RLS matrix (partner-aware from day one):** Owner — full CRUD (`documents_owner_all`). Partner SELECT — scoped to `uploaded_by = auth.uid()` (their own **partner-source** uploads) **AND excludes document types containing structured client PII** (bank statements, financial statements, ageing reports, personal financials, source of funds declarations — enum slugs `bank_statement`, `mgmt_accounts`, `debtors_ageing`, `creditors_ageing`, `financial_statements`, `personal_financials`, `source_of_funds`); even if the partner uploaded such a document as a temporary conduit, they must never become a permanent viewer of client transaction PII (CLAUDE.md rule 7, extended). A partner also never sees owner/other-partner/other-source documents. Since partners cannot upload until Phase D, this resolves to zero rows for them today (RLS ready, portal later). Partner INSERT — a structural policy exists with `WITH CHECK (false)` and the intended Phase-D predicate in a comment above it (Phase D just flips the check). Partner UPDATE/DELETE — no policy (not permitted in B3.1). The migration carries DO-block assertions (trigger/supersede/CHECK correctness + a role-simulated owner-sees-all / partner-sees-only-own / partner-INSERT-blocked check) that RAISE and roll the whole migration back on failure; the RLS-simulation block is guarded to skip on a fresh/CI DB (replay-safe) and runs against the live DB. The `documents` **storage bucket** RLS mirrors the table matrix so file access can never diverge from row access: owner full CRUD; partner SELECT only objects they uploaded (`storage.objects.owner = auth.uid()`); partner INSERT structurally present but `WITH CHECK (false)` until Phase D (which flips it to validate the scoped path `{owning_entity_type}/{owning_entity_id}/{document_id}/{filename}`). `deal_id` stays orthogonal to the client-XOR-lead CHECK — a document can belong to a client/lead **and** a deal's submission pack at once (deal-side attachment workflow is Phase E3).

**Storage bucket policies are intentionally path-permissive (do not add prefix policies before Phase D):** owner INSERT uses `bucket_id='documents' AND is_owner()` with no path constraint. Security is enforced by RLS-by-uploader (`storage.objects.owner = auth.uid()`), not path shape. Both legacy bare-path files and new `{clients|leads}/{id}/…` uploads pass. Explicit prefix-scoped policies will be added in Phase D when partner INSERT enables (partner INSERT will need path-scoped `WITH CHECK` to prevent cross-referred document uploads). Do not add prefix policies before Phase D — path shape is functionally irrelevant to security posture without partner INSERT enabled.

**Expiry alerts (built — B3 expiry-alert PR):** `DOCUMENT_EXPIRING_30D` / `_7D` / `DOCUMENT_EXPIRED` fire from `check_document_expiries()`, a **pg_cron** sweep scheduled **daily 04:00 UTC (06:00 SAST)** — never client-render. The sweep evaluates current + active docs with an `expiry_date`, and for each threshold reached (whole calendar days: `<0` expired · `≤7` urgent · `≤30` heads-up) that hasn't already fired, emits an owner notification (in-app + email via the existing `emit_in_app_notification` path). **Dedup:** a `document_expiry_alerts (document_id, alert_type)` ledger guarantees once-per-(document,threshold) even across daily runs. Alert bodies are **pack-aware** for period-scoped types (names the expiring period + prompts the next upload to keep a 12-month pack); non-period alerts are the simple "{client}'s {type} expires on [date]". The sweep also **auto-marks** past-expiry current docs `status='expired'` (only `active`→`expired`, never a terminal `archived`/`rejected`), feeding the E3 "block expired docs from submission" rule. Email extends the **`weekly_summary`** layout (informational/warning tone — see S16.4 tone map), not `deal_approved` — no new template variant. Owner prefs seeded email-on for all three (mutable). Daily-digest bundling of multiple alerts is deferred (ROADMAP Deferred Polish). Expired docs blocked from new submission packages remains E3.

**B3.2 (Document Verification Workflow — built):** turns documents into a qualification-decision gate.
- **Verification columns on `documents`:** `verification_status` enum (`unverified` default / `accepted` / `rejected`), `verification_notes` (owner-only free text), `rejection_reason` (partner-safe enum `illegible` / `expired` / `wrong_document` / `incomplete` / `mismatch` / `outdated_version` / `other` — A9.5 decline-category pattern), `verified_by` (FK → `profiles(id)`, NOT VALID + `CREATE INDEX CONCURRENTLY` + VALIDATE), `verified_at`. A `documents_rejection_reason_scope` CHECK ties a reason to the rejected state (present IFF rejected). **`verified_by`/`verified_at` are audit-truth:** the immutability trigger (`documents_prevent_audit_rewrite`) allows them to change **only alongside** a `verification_status` change — never rewritten on their own (decision: they reflect the LATEST decision, not frozen at first touch, so they always match the current status).
- **Controlled verification path:** `set_document_verification(document_id, status, reason, notes)` — owner-only (`is_owner()`), SECURITY DEFINER. Stamps `verified_by = auth.uid()` / `verified_at = now()` **only on a real status change** (a reason/notes-only edit keeps the existing stamp, so it doesn't trip the immutability guard), enforces "reason required on reject", `.select()`/RETURNING-checked, and writes an `activity_logs` row with before/after of all five verification fields (documents has **no** A10 trigger, so verification decisions are logged here explicitly, entity_type `document`).
- **Owner review UI:** the client/lead Documents surface shows a verification badge per document (unverified / accepted / rejected + rendered reason) and, on current versions, accept / reject (with reason + optional owner-only notes) / reset controls. Superseded versions are frozen (no controls).
- **Qualification gate:** `lead_required_docs_missing(lead_id)` — the single rule (called by `qualify_lead` AND surfaced to the UI as an RPC for the disabled-button tooltip / inline hint). Required **accepted current** documents by category: **Business** (cipc_cert + tax_clearance) · **Financial** (≥1 bank_statement) · **Personal** (id_copy + proof_of_address). `qualify_lead(lead_id, override boolean default false)` **blocks by default** when categories are missing; an explicit owner **override** (the UI requires typing `OVERRIDE`, mirroring the B2.3 `SAVE` pattern) proceeds and writes a `QUALIFICATION` `activity_logs` row via `log_qualification_override()` recording which categories were missing. (The 1-arg `qualify_lead` was dropped so PostgREST resolution stays unambiguous.)
- **Lead → client document re-pointer:** on qualify, `qualify_lead` moves the lead's documents to the new/matched client in a single UPDATE (`client_id = new`, `lead_id = null`) — preserves the `num_nonnulls(lead_id, client_id) = 1` CHECK, `verification_status`, provenance, and versioning. The **physical storage bytes stay at their original `leads/{id}/…` path** (storage RLS is keyed on the uploader, not the path, so files stay accessible); the physical byte-move is deferred (ROADMAP Deferred Polish).
- **`LEAD_DOCUMENT_REJECTED` notification:** the `documents_notify_rejected` trigger fires on a transition **into** `rejected` on a **lead-owned** document and notifies the lead's referring partner (`partner_profile_id(referral_partner_id)`, only when `referred_by <> 'self'`). **POPIA-safe body:** business name + document category + rejection **reason category** only — never the free-text `verification_notes`, contact PII, or funder identity. Email extends the neutral **`weekly_summary`** layout (S16 tone map — action-needed, not celebratory); prefs seeded email-on for every profile (the partner's only channel until Phase D).

Frontend note: the client Documents tab component + hooks were **parameterized by owning entity** (`DocEntity = { kind: 'client' | 'lead', id }`, prop `entity={{ kind, id }}`) — the same `DocumentsPanel` now serves both the client tab and a new lead-detail Documents section. New uploads use the entity-prefixed storage path `{clients|leads}/{id}/{document_id}/{filename}` (the document id is generated client-side and used as both the row id and the path segment); legacy pre-B3.2 docs stay at their bare `{client_id}/...` path (functionally accessible — storage RLS keys on the uploader, not the path). Verifying/deleting a lead document also invalidates the `lead_required_docs_missing` gate query so the Qualify button refreshes live.

Deferred to E3/F: OCR text extraction, external share links w/ expiry+tracking, watermarks, e-signature integration, document request links (E4), bundled PDF (E3).

**Frontend (separate UI PR, after this schema is merged + applied + verified):** Client-detail Documents tab (taxonomy dropdown, expiry-defaulting date input, version-history toggle, expiry status pill, tag filter, uploaded-by owner/partner badge); global owner-only `/documents` route (filter by client/category/type/expiry/tag, 8 category chips); pack view UX grouping concurrent period-scoped docs with a coverage indicator; deal-detail read-only view of the linked client's documents with expiry warnings. Row-count checks (`.select()`/RETURNING) added to the existing document mutations. Activity logging on documents lands with this UI PR (write-side), alongside S5 READ-logging for sensitive docs in Phase E/F.

---

## S6a. DEAL PACKAGE AUTO-GENERATION (Part 6 M3 — Roadmap E3, expanded scope)

**Status: docs only, NOT started (Phase E3).** Fund Now Capital application-form auto-generation. Traditional broker workflow: forward client documents to funders unchanged. **FNC workflow: auto-generate a professional FNC-branded application PDF that packages CRM-captured client data into a credit-ready pitch document.**

Structure of the auto-generated FNC application:
- **Cover page** — FNC branding, deal reference, submission date, target funder name.
- **Client details** — auto-filled from CRM: business name, CIPC, contact, industry, address.
- **Refined credit case / story** — from the E6 Claude Story Refiner (see **S17b**).
- **Financial summary** — turnover trend, average balance, expense pattern. **Source contract (build-time):** figures come from **owner-confirmed values** (or S18 document-intelligence extractions the owner has reviewed) — never unverified raw auto-extraction presented as fact to a funder. Each generated package **snapshots the exact source-document versions** (document ids + `version_number`) used, so a regenerated PDF is reproducible and auditable against what was submitted.
- **Funding request** — amount, purpose, timeline — auto-filled from the deal.
- **Supporting document index** — list of attached PDFs (CIPC, ID, POA, bank statements, financial statements).
- **Referral acknowledgment** — if partner-sourced (Doctor's referral noted with commission-agreement reference).
- **Compliance clauses** — broker-referrer clause per NCR/FAIS, POPIA data-handling notice.
- **Signature footer** — owner's signature block.

Package generation is triggered from the deal detail page — "Generate FNC application for [funder name]". PDF generated server-side (via jsPDF or similar), stored as a **versioned document** in the `documents` table, attached to the `deal_funder_submission`. **Enum note (build-time):** this needs a new `upload_source = 'system_generated'` value — the current S6 enum is only (owner/partner/client/funder). The E3 migration must add it and define its behaviour explicitly: **owner-only RLS** (never partner-visible, even on a partner-referred deal), stored under the deal's storage path, and excluded from the partner document surface. Do not rely on an undocumented enum value.

**Per-funder customisation:** each funder submission gets its own generated PDF (naming the specific funder, adjusting emphasis based on funder appetite scored in B1). Multi-funder submissions get **separate PDFs per funder** — no generic pack.

**Owner intent:** this becomes the KEY differentiator of Fund Now Capital vs other brokers. Most brokers forward client documents unchanged; FNC forwards a professional pitch package that presents the client the way a credit committee wants to see them — increasing approval rate and speed.

**Est. build:** 2–3 PRs (~2–3 weeks) in Phase E3, combined with E6.

**Regulatory:** the generated PDF is an **owner-authored** document (owner reviews and signs before sending) — **not** client-signed. Content is factual (client data auto-filled) + Claude-drafted narrative (owner-reviewed and edited before send).

---

## S7. INVOICING (Part 5 M2 — Roadmap C1)

`invoices`: id, invoice_number (INV-XXXX, sequential from INV-0032, never gaps — void don't delete), deal_id FK nullable, funder_id FK, funder_contact_id, invoice_date, due_date (net 30 default), subtotal, total_amount, status enum(draft/pending_approval/sent/paid/partial_paid/overdue/voided), pdf_url, notes, created_by/at, sent_at, paid_at, payment_received_amount, payment_shortfall_amount, payment_shortfall_reason.
`invoice_line_items`: id, invoice_id, deal_id, description, amount, sort_order.
`invoice_payments`: id, invoice_id, payment_date, payment_amount, bank_reference, notes, recorded_by.

Flow: deal → Funded stage ⇒ auto-draft invoice (pending_approval) ⇒ owner reviews/adjusts ⇒ approve ⇒ PDF generated (branded: logo, TAX INVOICE, FNC details CIPC 2026/066284/07 + Bryanston address + 010 102 0534 + thapelol@, funder details, line item "Referrer commission on funding facility of R[amount] to [Client] — Deal REF: DEAL-XXX", Absa Universal 632005 acct 4125798855, footer "Fund Now Capital (Pty) Ltd is not VAT registered" + tagline) ⇒ Resend email to funder accounts contact ⇒ status sent. Payment recorded manually ⇒ paid. Overdue flags 30/45/60d with drafted reminder emails (owner reviews before send). Bundled monthly invoices + credit notes (CN-XXXX): defer to Phase E. PDF gen: Supabase Edge Function (or server util) — pick pragmatic library, store in Storage. **No VAT charged anywhere (not VAT registered).**

---

## S7A. COMMISSION LIFECYCLE AMOUNTS (Part 5 — Roadmap C0/C2)

Commission calculation depends on the **per-funder rate structure** (see ROADMAP **Phase C0**). The `deal_funder_submissions.amount_approved` / `amount_funded` columns are the substrate; **C0 provides the rate lookup that produces the FNC gross, which then feeds the existing 40/60 tiered engine** (`calculate_commission()`). Nothing here changes the internal split math — it only supplies the gross that math runs on.

**Note on schema state at S7A ratification:** the `deal_funder_submissions.amount_approved` and `amount_funded` columns referenced here are described as substrate but do **NOT yet exist** on the `deal_funder_submissions` table. They will be added in Phase C0's migration alongside the per-funder rate structures. This S7A section defines the **semantic contract** (three commission states, effective-dated rate lookup, snapshot rule) so Phase C0's implementation has a locked target. Column-shape decisions (nullable? default? indexed? triggers?) belong to C0's build proposal, not this docs pass.

**Three commission states per submission** — each tied to a different amount column and displayed with a different certainty label:

**State 1 — Estimated (submission created):**
- Trigger: `deal_funder_submissions` INSERT.
- Uses: `amount_requested` (from the deal — what the client asked for).
- Calculation: `funder_rate × amount_requested → FNC gross → 40/60 split → tiered partner share`.
- Owner sees: "Estimated FNC gross: R X. Estimated owner share: R Y. Estimated partner share: R Z."
- Partner (Phase D) sees: "Estimated potential commission: R Z" (partner share only per the D5 decision).
- Certainty: rough — depends on whether the funder approves the requested amount.

**State 2 — Potential (funder approved):**
- Trigger: `amount_approved` set on the submission (status → `approved`).
- Uses: `amount_approved` (what the funder actually offered).
- Calculation: same as State 1 with the approved amount.
- Owner sees: "Potential FNC gross if client accepts: R X."
- Partner sees: "Potential commission if client accepts: R Z."
- Certainty: firm offer — the client still needs to accept.
- Multiple funder approvals are visible in parallel (per S11 — Doctor sees all offers; the owner picks the one presented to the client).

**State 3 — Actual (deal funded):**
- Trigger: `amount_funded` set on the submission (status → `funded`, deal stage → Funded).
- Uses: `amount_funded` (what actually landed in the client's account after any funder fees).
- Calculation: same engine, actual amount.
- Owner sees: "Actual FNC gross earned: R X."
- Partner sees: "Actual commission earned: R Z" (feeds Doctor's Earnings module, Phase C3).
- Certainty: real money — feeds invoice generation (C1) and the Doctor's earnings lifecycle (C3).

**Rate lookup rule — approval pins the rate (locked):** the **approval transition** is authoritative. When a submission is approved, the `funder_commission_structures.effective_from` / `effective_to` bracket in force **as-of the approval date** is looked up and becomes the rate that governs the deal's commission from then on — including the funded/actual calculation. Funding does **not** re-look-up the rate at the funding date. So if Merchant Capital's rate structure changes on March 1 and a submission approved on Feb 15 funds on March 15, the **Feb (approval-time) rate** produces the actual commission — never the March rate. This is a deliberate business rule (commission is earned on the terms agreed at approval, not whatever rate happens to be live when the money lands) and keeps commissions honest when funders renegotiate mid-deal. (Estimated state — pre-approval — uses the rate live at submission for display only; it is superseded by the approval-time rate and never governs actual commission.)

**Rate structure snapshot:** at each state transition (submitted, approved, funded) the rate in force at that moment is recorded as an **audit snapshot on the `commission_record`** (Phase C2) — this is the trail (what was live at each stage), distinct from the **authoritative** rate. The authoritative rate = the approval-time snapshot; that is the one the funded/actual calculation uses and the one **C1 (invoicing)** and **C3 (Doctor's earnings)** consume via the **funded-state actual** figure. A later funder rate change never rewrites a snapshot already taken.

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
Visual pattern reference: horizontal step-progression with numbered/coloured tiles and directional arrows, similar to standard project-milestone infographics. Use brand colours: navy #1a3a52 for completed, teal #2da8b8 for current step, brand green #5dba5d for upcoming/pending steps, cyan #3ec6d9 for accents. Icon per step. Label + status timestamp below each tile. See owner's saved reference (Envato milestone infographic) for visual language.

**Commission state labels on the timeline (S7A):** Doctor's portal displays commission in state-appropriate labels — **"Estimated"** at submission, **"Potential (if you accept)"** at approval, **"Earned"** at funding. It **never** displays the internal FNC gross or the 40/60 split math — **partner share only** per the D5 decision. When multiple funders approve simultaneously, Doctor sees all offers with per-funder Potential values so he can appreciate the offer landscape (the owner still has the final call on which offer is presented to the client).

**Submission decline (data model live from Roadmap A9.5; partner surface built here in Phase D):** each funder submission carries a partner-safe `decline_reason_category` (affordability / documentation_gaps / sector_appetite / credit_profile / security_insufficient / funder_criteria_not_met / other) and an owner-only `decline_notes_internal`. On the partner deal timeline a declined submission reads **"Declined by [fictional name] — [generic reason category]"**, sourced from `partner_submission_view` (fictional funder name + status + reason category only — never the real funder name, the internal notes, or any commission figures). When the last active submission on a deal is declined, the deal auto-moves to the terminal Declined stage.

**Partner document upload (RLS ready from B3.1):** the `documents` RLS matrix and columns are provisioned so a partner can attach documents at lead submission — partner SELECT is scoped to `uploaded_by = auth.uid()` (own uploads only, tagged `upload_source = 'partner'`), and the partner INSERT policy is present but `WITH CHECK (false)` until Phase D flips it to the intended predicate (own upload, `upload_source='partner'`, on a client the partner referred). The actual portal upload form is built here in Phase D; B3.1 only made the data layer ready (see S6).

**Rejected-document notification (`LEAD_DOCUMENT_REJECTED`, live from B3.2):** when the owner rejects a document on a lead the partner referred, the partner is notified — **POPIA-safe: business name + document category + rejection reason category only** (e.g. "expired", "illegible"), **never** the owner's free-text verification notes, contact PII, or funder identity. Email extends the neutral `weekly_summary` layout (S16). The partner has no login until Phase D, so today it lands in-app silently + emails; the portal surface (a "re-upload" action on the rejected document) is built here in Phase D.

Part 3 F1 Client Estimator: inputs (deal size slider R50k–10M, industry+sub dropdown, turnover range, trading history slider 0–60mo, security multi-select, timeline, existing debt toggle) → outputs: fundability gauge (green 80-100/amber 50-79/red 0-49 + natural-language explanation), suggested funder cards (fictional name, fit, product icon, turnaround, ticket range, why-line), estimated client cost (APR range, term, total cost bar), timeline prediction, document checklist + "Download Client Prep Sheet" PDF, HIS estimated commission (tight range). Save Scenario → `calculator_scenarios` (id, doctor_id, scenario_name, calculator_type, inputs jsonb, outputs_snapshot jsonb, created/updated_at).

Part 3 F2 Commission Estimator: inputs (facility slider, deal type toggle, funder dropdown fictional, repeat status) → big animated number (range), deal comparison bars (500k/1m/current/5m), monthly projection slider vs R50k target (green/amber/grey), "path to R50k" card, career trajectory. **BUSINESS VIEW SECTION: ⚠ OPEN DECISION — do not build until owner decides transparency level (full ranged breakdown vs his-number-only).**

Part 3 F5/F6 (Phase F): `learning_content`, `doctor_badges`, `doctor_activity_feed` tables; badges (first deal funded, 4-week streak, 10 quality leads, R100k earnings, repeat client); notification celebrations. Estimator outputs use ranges, never exact internal rates. Real-time recalc, no submit buttons. Mobile-first layouts.

**D1 first-login T&C acceptance (docs — Phase D):** the D1 partner-routing + portal-shell first-login flow includes **T&C acceptance**. The partner sees the FNC **Partner T&Cs** (versioned) + an explicit "Accept" button. Acceptance is recorded with timestamp + T&C version. Subsequent logins bypass this step **unless** the T&Cs have been updated to a newer version. (Partner T&C content — commission split, referral protocol, deal ownership, confidentiality — see the T&Cs subsection in **S17**.)

**Follow-on Deal Workflow (locked deferral — Phase D, docs only):** repeat clients (a client returning for more funding after a prior funded deal) get a dedicated workflow in Phase D, not before. Scope:
- New column `deals.parent_deal_id` (nullable FK to the prior funded deal on the same client). **Constraints (build-time):** the parent must be a **funded** deal for the **same** `client_id`, and the chain must be **acyclic** — enforce via a DB constraint/trigger or transactional validation, not just a nullable FK.
- `deal_sequence_number` per client — **assigned atomically and concurrency-safe** (unique per client; two simultaneous follow-ons must not collide on the same number).
- Client detail page **'Deal history' tab** with lifetime funded total + repeat-client badge.
- Doctor's portal: **'Refer existing client for more funding'** button — separate from 'Submit new lead' — requires typing the existing CIPC or picking from the partner's prior referrals.
- **Duplicate-detection refinement** to distinguish 'same CIPC = repeat client legit' from 'same CIPC = accidental resubmit' — legit repeats bypass the CIPC hard-block (B2.3/B5) only with **owner + partner acknowledgment that is persisted** (who acknowledged, when, against which prior deal) — the bypass is an audited decision, not a silent skip.
- *(Optional, per Phase C0 decision)* Commission-tier bump on repeat referral — Doctor's rate may step up on the Nth-time client. To be decided during the C0/C2 build.

Owner-initiated follow-on **today**: the workaround is Pipeline → New Deal → search existing client → create a fresh deal at Qualifying stage. Works, but is manual and doesn't link parent-child. Acceptable at current volume; the formal workflow lands with Phase D.

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
Visual pattern reference: horizontal step-progression with numbered/coloured tiles and directional arrows, similar to standard project-milestone infographics. Use brand colours: navy #1a3a52 for completed, teal #2da8b8 for current step, brand green #5dba5d for upcoming/pending steps, cyan #3ec6d9 for accents. Icon per step. Label + status timestamp below each tile. See owner's saved reference (Envato milestone infographic) for visual language.

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

### S16.1 Canonical layouts (refined in email-templates-v2)
A shared shell (gradient header → cyan bar → white content card → deep-navy 3-column footer) wraps the variants, each emitting **HTML + a matching plain-text body**. Variants differ only by a 40px accent icon + locked copy:
- **`welcome`** (open-door icon) — onboarding / first-touch.
- **`deal_approved`** (check-in-circle) — deal-state good news. `DEAL_FUNDED` reuses this layout with funded copy.
- **`weekly_summary`** (bar-chart) — digests.
- **`commission_paid`** (rand-in-circle) — money events.

**Structural blocks (table-based, inline styles only):**
- **Gradient header** — navy→teal 135° linear-gradient (solid navy `bgcolor` fallback for Outlook), centered hosted **white FN mark** (40px), "Many funders. More approvals." tagline.
- **Cyan accent bar** — 3px `#3ec6d9`, full width.
- **Content card** — white; 40px accent icon (inline SVG), H1, "Hi {first_name}," greeting, body paragraphs, green→teal gradient CTA button (padded `<a>` + MSO VML fallback), muted subscription/prefs line.
- **Three-column footer** — deep-navy `#0f2233`; **Offices / Contact / Connect** columns as `<div>`+`inline-block` inside an MSO ghost table (side-by-side on desktop, wrap on mobile, tables for Outlook); Connect holds inline-SVG white LinkedIn + TikTok glyphs; divider; legal row (© + CIPC).
- **Plain-text fallback** — subject, greeting, body paragraphs, CTA URL, subscription + prefs URL, full contact block, © + CIPC.

### S16.2 Design tokens (shared with the CRM UI)
Header gradient navy `#1a3a52`→teal `#2da8b8` (135°) · cyan accent bar `#3ec6d9` · CTA gradient green `#5dba5d`→teal `#2da8b8` (90°) · footer deep-navy `#0f2233` · white `#ffffff` content card · body ink `#1e293b` · H1 `#1a3a52` · small print `#64748b` · icon accent `#2da8b8`. Typography: **Inter** (matching the app), declared `Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif` — clients that lack Inter fall back to the web-safe stack, so never rely on Inter-only styling. 600px shell.

### S16.3 Locked contact block (Phase A closure — use exactly)
Fund Now Capital (Pty) Ltd · CIPC 2026/066284/07 · 010 102 0534 · hello@fundnowcapital.africa · www.fundnowcapital.africa · Cedarwood House, 128 Ballyclare Drive, Bryanston 2191 (Sandton) · 75 Marshall Street, Polokwane 0699 · LinkedIn (Fund Now Capital) + TikTok @fundnowcapital · tagline "Many funders. More approvals." **Never** put a personal email (e.g. `thapelol@…`) on an automated footer — `hello@` is the shared reply inbox.

### S16.4 Which variant each future email extends
- **Deal-state notifications** (`DEAL_APPROVED`) → **`deal_approved`** layout.
- **`DEAL_FUNDED`** → **`deal_funded`** (a fifth variant reusing the `deal_approved` layout + check-in-circle icon), with locked copy: subject/H1 "Deal funded"; body "`{funder_display}` has funded `{deal_reference}` for `{amount}`. The advance to `{client_name}` is complete." then "Open the deal to record the funded date and start the commission process."; CTA "View deal in CRM"; category `deal`.
- **Money notifications** (`COMMISSION_PAID`, invoice paid, payment received) → **`commission_paid`** layout.
- **Digests / summaries** (weekly summary, Doctor's monthly statements) → **`weekly_summary`** layout.
- **Onboarding / first-touch** (welcome, `LEAD_CREATED_FOR_YOU`, client Trust Pack cover) → **`welcome`** layout. (`LEAD_QUALIFIED` is a positive milestone → `deal_approved`; see the authoritative tone table below.)

(`deal_approved` + `commission_paid` share the green-success-band renderer; `welcome` + `weekly_summary` are live-dormant until B2 / C6.)

**Variant → tone mapping (authoritative — pick by the event's TONE, not just its noun; prevents future ambiguity):**

| Layout | Tone | Events |
|---|---|---|
| **`deal_approved`** | celebratory / success | `LEAD_QUALIFIED`, `DEAL_APPROVED`, `DEAL_FUNDED` (via `deal_funded`) |
| **`weekly_summary`** | informational / warning (neutral digest) | `DOCUMENT_EXPIRING_30D` / `_7D` / `DOCUMENT_EXPIRED`, `WEEKLY_SUMMARY`, future partner digests |
| **`welcome`** | onboarding / introduction | `LEAD_CREATED_FOR_YOU`, welcome |
| **`commission_paid`** | money received | `COMMISSION_PAID`, invoice-paid / payment-received |

Rationale (B3 expiry-alert decision): an expiry warning is *action-needed*, not good news — so it extends the neutral `weekly_summary` layout, NOT the celebratory green-band `deal_approved`. The four-layout rule (S16.1) still holds; this just maps each event to the layout whose tone fits. When adding an event, choose its layout from this table.

### S16.5 Adding a new event type
1. Add the value to the `notification_event_type` enum.
2. Pick one of the four canonical layout variants (S16.4). Every **production** email event must map to one of the four. `generic` is an internal safety-net fallback only — the same shared shell (header / footer / tokens) with a plain title + body + CTA and no variant-specific block; it exists so an unmapped event still renders on-brand rather than breaking, and is not a fifth brand template to design against.
3. Emit it via `emit_in_app_notification(...)` with a good `title`, `body_text`, optional `link_url` (keep funder names role-aware — fictional `display_name_for_partner` for partners).
4. Map it in `resolveVariant()` if it needs a specific layout; add its category to `eventCategory()` for the footer line.
5. If it should send email, confirm it's in the S4 email allow-list and that `notification_preferences` are backfilled.

**Template interface (v2).** The Edge Function hydrates typed display variables and passes them to `renderEmail(model)` → `{subject, html, text}`: `firstName`, `funderDisplay` (role-aware — real `funders.name` for owner, `display_name_for_partner` for partner), `dealReference`, `amount` (pre-formatted en-ZA, e.g. `R8,000,000`), `clientName`, `linkUrl`, `eventType`, `appBaseUrl`. Hydration reads the notification's `data` payload (`deal_id` / `submission_id` / `commission_record_id`) with the service-role client — triggers stay simple (they still fire `body_text` for the in-app bell); only the email is enriched. Any hydration miss falls back to `body_text`.

### S16.6 Logo & icon assets
`/public/logo-white.png` (white mark — dark header) and `/public/logo-full.png` (colour lockup — light backgrounds: future PDFs / signatures). The **header logo is a hosted PNG** referenced by absolute HTTPS URL built from `APP_BASE_URL` — never inline-embed or use `data:` URIs for the logo. The per-variant accent icon and the LinkedIn/TikTok social glyphs are **inline SVG** (`role="img"` + `aria-label` for SVG-capable clients). **Outlook 2016+ does not render inline SVG**, so these icons are simply absent there — an accepted compromise (no PNG fallback, per brief).

### S16.7 Deliverability & compatibility rules (non-negotiable)
- **Plain-text fallback for every variant** (spam score + text-only clients).
- **Tables + inline styles only** — no CSS classes, no `<style>` block, no flexbox, no grid. No `@media` queries; the footer columns instead stack via `<div>`+`inline-block` inside an MSO ghost table.
- **Hosted logo PNG** (absolute HTTPS, `alt` text); **accent + social icons are inline SVG** with `role="img"`/`aria-label` for SVG-capable clients. Outlook 2016+ does not render inline SVG (icons absent there) — accepted compromise, no PNG fallback.
- Outlook fallbacks for gradients (`bgcolor`) and a VML CTA button; don't rely on `border-radius`/`box-shadow` for legibility.
- Tested against Outlook 2016+, Gmail web, Gmail iOS/Android, Apple Mail.

---

## SA VALIDATION RULES (used everywhere)

- **SA ID:** 13 digits, Luhn checksum, valid DOB + citizenship digit.
- **CIPC:** YYYY/NNNNNN/NN.
- **VAT:** 10 digits starting 4.
- **Cell:** +27/0 then 6/7/8, normalised storage.
- **Postal code:** 4 digits.

---

## S17. FUNDER FORM AUTO-FILL + CLIENT E-SIGNATURE (Roadmap E4 — Phase E, deferred)

**Status: scope locked, NOT started.** Documented now so it's build-ready when Phase E arrives. No implementation until then. This is the refined scope for what ROADMAP Phase E4 calls **"Client Onboarding & Submission Automation."**

**Purpose.** Remove client paperwork friction on funder submissions. Take each funder's ORIGINAL application PDF, auto-fill the fields we already know from CRM data, mark the client-fill and signature fields, send the client a signing link, capture the signed original, and deliver it to the funder. Each funder's real form is preserved — never rebuilt.

**Technical approach — AcroForm-first.**
- Each funder is uploaded as a "form template" with their real PDF (AcroForm expected — Pollen confirmed).
- **Field-mapping wizard:** on upload, auto-detect the AcroForm field names and map each to one of — `crm_auto_fill` (data source: client / deal / contact / owner-supplied), `client_fill` (left blank for the client), `owner_fill` (owner completes before sending), `signature` (client draws or types).
- Flat/scanned PDFs (no AcroForm) are **deferred** until the first non-fillable funder is actually needed; the `position_x/position_y` fields on `funder_form_fields` exist for that future case only.

**Workflow.**
1. Owner triggers a submission to a funder from the deal detail page.
2. System fetches the funder template and generates a pre-filled PDF using CRM data.
3. Client receives a time-limited unique link (email + WhatsApp once D6 lands).
4. Client opens the link and sees the actual funder form with the auto-fills already done.
5. Client completes the remaining fields and draws a signature (touchscreen or mouse).
6. The signed PDF returns to the CRM, attaches to the deal, and a notification fires.
7. Owner reviews and sends to the funder's submission address (or the CRM sends automatically per funder config).

**Legal / POPIA.**
- Owner never signs on the client's behalf.
- Client review + explicit confirm required before signing.
- Per-signature audit trail: timestamp, IP, session token, form version.
- South Africa ECT Act compliance — a draw-signature is valid; retain the original PDF byte-for-byte.
- An owner-only **"voided signing session"** state for aborted flows.

**Data model (indicative — build in Phase E).**
- `funder_forms` (id, funder_id FK, form_name, form_pdf_url, active_from, active_to, current_version)
- `funder_form_fields` (id, form_id FK, field_name, field_type, source, position_x, position_y — position only used for flat PDFs)
- `form_signing_sessions` (id, deal_id FK, client_id FK, funder_form_id FK, token, expires_at, status, signed_at, signed_pdf_url)
- `signed_submissions` (id, session_id FK, deal_funder_submission_id FK, delivered_to_funder_at)

**Owner intent.** This addresses the single biggest friction point in the brokerage workflow — client paperwork. High priority for Phase E, but sequenced correctly: **after** Phase C money operations (so we have real deal volume) and **after** Phase D Doctor's portal (so partners can trigger flows too). Estimated 2–3 weeks of focused build.

**Consent Pack — added to S17 scope (Phase E4).** Before submitting a client's deal to any funder, the CRM generates a **two-document consent pack** via the S17 e-signature pipeline:
1. **Broker Referral Consent** — fixed, legally-reviewed template. Client explicitly acknowledges that Fund Now Capital acts as a **business referrer/intermediary** (not a lender, not a credit provider, not a financial advisor per NCR/FAIS). Client consents to FNC introducing their business to multiple funders on the FNC panel.
2. **Multi-Funder Credit Consent** — dynamic template. Lists the **specific funders** the deal is being submitted to (e.g. Merchant Capital, Bridgement, PrefCap). Client authorises each named funder to run credit checks and process their data per POPIA.

Both e-signed by the client via the same S17 time-limited link pipeline. Signed PDFs versioned in the `documents` table, attached to the deal, notification to owner when signed. **Deal submission to funders is BLOCKED until both consent documents are signed and attached.**

**Consent integrity (build-time — do not gate on generic signed PDFs).** At generation/signing, persist the **consent-pack version/hash** and an **immutable snapshot of the exact funder set** the Multi-Funder Credit Consent named. The submission path must compare the **requested funder set** against the signed pack's snapshot: if funders are **added or removed** (or swapped), the pack is **invalidated and re-signing is required** for the new set. A deal must never be submitted to a funder the client didn't explicitly consent to — the block clears only for the specific funders on a matching signed pack, not "any signed pack is attached."

Regulatory scope: **NCR** (National Credit Regulator) intermediary distinction, **FAIS** (broking vs financial advice), **POPIA** (explicit consent for cross-organisation data sharing). **Legal review of the Broker Referral Consent template REQUIRED before first live use** — flag to legal advisor when the Phase E4 build opens. **S17 total revised estimate: 3–4 weeks focused build in Phase E4.**

**Link expiry and reset behaviour (Phase E4).**
- **Default signing-link expiry: 7 days** from generation (not 24–48h). Reflects the real SA broker workflow — clients are busy business owners.
- **Owner-initiated link regeneration:** on any deal with an expired or expiring signing link, the owner can click "Regenerate signing link" from the deal detail page. Regeneration is an **atomic server-side session rotation**: in one transaction, revoke the prior `form_signing_session` and create **exactly one** active replacement — so concurrent regeneration clicks can never leave **two** valid links live. The old token is **immediately invalidated** (revoked/expired sessions stay dead and **cannot be replayed** even after a new one is issued). A new time-limited link is sent via the same channel (email + WhatsApp once D6 lands).
- **Audit trail:** every regeneration captures `link_regenerated_by`, `link_regenerated_at`, `previous_token_hash` (a hash for POPIA — never the raw token), plus the **previous and new signing-session ids and their linkage** (which session superseded which). Regeneration events flow through `activity_logs`.
- **No client-side self-service link renewal** — the flow stays owner-driven, reducing public-endpoint attack surface and preserving owner visibility on signing status.
- **Notification:** a `LINK_REGENERATED` event fires to the owner's activity feed. The client sees only the new-link email, with no mention of prior expiry.

**Terms & Conditions integration (Phase E4).** Client-facing T&Cs are **part of S17's consent pack, NOT a separate module.** When a client signs the Broker Referral Consent, they simultaneously accept the FNC Client T&Cs (an "I have read and accept the Terms and Conditions" checkbox + link/PDF attachment in the signing surface).
- Client T&Cs must cover: FNC broker/intermediary role (NCR distinction), FNC commission disclosure (FAIS requirement), POPIA data handling, client right of consent withdrawal, dispute resolution, SA governing law.
- **Legal review of the T&Cs template REQUIRED before first live use** — the same legal-review pass as the Broker Referral Consent template.
- **Partner-facing T&Cs** (Doctor, future partners): added to the Phase D partner-portal onboarding flow (see S11). Partner accepts T&Cs before first portal access. Content covers commission split, referral protocol, deal ownership, confidentiality.
- Both client and partner T&Cs are **versioned**. Signed acceptances include the T&C version reference so we know which version each user agreed to and when. **Retention** follows a defined **records-retention schedule** — each acceptance record carries its **retention basis** (e.g. the underlying financial-services/tax record-keeping obligation, commonly ~5 years under FICA/tax norms — confirm with the legal advisor; POPIA itself sets no flat period) and an **applicable duration**, with **deletion or restriction at expiry**. Versioned acceptance tracking is preserved regardless.

**Explicit non-goals.**
- NOT rebuilding funder forms — always work with the funder's original PDF.
- NOT signing owner-side on behalf of the client.
- NOT automating funder-to-funder submissions without owner review.

---

## S17b. CLAUDE STORY REFINER (Roadmap E6 — Phase E, expanded scope)

**Status: docs only, NOT started (Phase E6).** The **owner** captures the **raw client story** on the lead (business context, background, why they need funding, competitive edge, credit case). *(Story authoring is **owner-only** to stay consistent with S3 — partners never see or write client stories, now or in Phase D. If partner-drafted stories are ever wanted, that is a deliberate Phase-D RLS decision with its own partner-visible-field and redaction rules, not assumed here.)* Owner clicks **"Refine with Claude"** on the lead detail page. The CRM sends the raw story + client context (industry, funding amount, purpose, financial highlights) to Claude via the Anthropic API. Claude returns a **structured funder-ready pitch narrative**. Owner reviews side-by-side (raw vs refined), edits if needed, approves. The refined narrative becomes the **credit-case section of the auto-generated FNC application form** (see **S6a** / Phase E3).

**Architecture.** New table `story_refinements` (`raw_story_id` FK, `claude_prompt_version`, `refined_output`, `owner_edits`, `owner_approved_at`, `approved_by`). The prompt template is **versioned** so the refinement process can itself be refined without losing history. The Anthropic API key is stored in **Supabase Vault**. Rate limiting + cost tracking per owner.

**Data-processing controls (build-time — separate from secret storage).** Sending client narrative to a third-party model is POPIA processing, so the build must document: **lawful basis + client notice** (the consent pack, S17, should cover AI-assisted processing); **data minimisation / redaction** (send only what the pitch needs — no ID numbers, bank account numbers, or contact PII unless required); an **approved Anthropic API configuration under commercial/processor terms** (business/commercial tier with a data-processing agreement and **zero-retention / no-training** where available — never a consumer account); **provider retention + deletion** handling; and **auditable access** — the prompt version, inputs sent, and Claude output are logged owner-only for audit. (This is in addition to the Vault-managed key above.)

**Prompt engineering.** The initial prompt template covers: *"as a South African broker preparing a credit pitch, refine this raw client context into a professional 2–3 paragraph credit narrative. Highlight: business viability, ability to repay, use-of-funds credibility, and any risk mitigants. Do not fabricate numbers — use only what is provided."* Versioned in the prompts table.

**Owner intent:** *"The refined story is the difference between a submission that gets approved fast and one that sits waiting for a credit committee to guess. Every deal deserves a pitch, and Claude helps me write consistent pitches at scale."*

**Est. build:** 1–2 PRs in Phase E6, ~1 week focused build. **Prerequisite: the B4.1 refinement (story on lead — see S3) must ship first.**

**Owner intent — the FNC differentiator (B4 close-out, 2026-07-19):** the FNC differentiator is **auto-generated professional pitch packages, not just document forwarding.** B4.1 story capture is the substrate. E3 (S6a) packages the CRM data into a credit-ready PDF. E6 (this section) refines the narrative via Claude. Together they turn Fund Now Capital into a broker that pitches every deal professionally at scale.

---

## S18. DOCUMENT INTELLIGENCE (Roadmap E6 — Phase E, new scope addition)

**Status: docs only, NOT started (Phase E6).** AI-assisted cross-document verification and risk flagging. Owner (or in Phase D, Doctor's referred lead) uploads a set of client documents to a lead or deal — bank statements, CIPC, ID, POA, financial statements, tax clearance, business proposal, etc. Owner clicks **"Analyse deal"** on the deal detail page. The CRM sends document extractions + client-declared data to Claude via the Anthropic API. Claude returns a **structured intelligence report**:
- **Mismatches:** business name on CIPC vs bank-statement account holder, ID on POA vs ID copy, business address on CIPC vs client-submitted address, etc.
- **Financial red flags:** overdrafts, returned debits, R/D entries, high stop-orders, insufficient-funds fees, unexplained large transactions, salary/income source inconsistent with declared business activity.
- **Document quality issues:** unreadable pages, expired documents, missing pages in period-scoped packs (e.g. a bank-statement pack missing March 2026).
- **Compliance flags:** SARS non-compliance signs, tax-clearance expiry, BEE-certificate mismatch, POPIA-relevant PII visible where it shouldn't be.
- **Story-to-documents consistency:** client story says "we do mining supply" but bank statements show consulting-services income — flagged for owner review.
- **Fraud signals:** obvious digital alterations, inconsistent fonts across an ostensibly same document, mismatched dates on scanned documents, watermark irregularities.

Owner reviews the report on a **'Document Intelligence' tab** on the deal detail page. **Severity flags (red/amber/green)** per finding. Drill-down opens the specific document with the flagged section highlighted. Owner can **dismiss** findings with a note (audit-logged), or take action (request re-upload, ask client for clarification, decide not to submit to funders).

**Architecture.**
- New table `document_extractions` — raw text extractions from PDFs (page-by-page), extraction confidence per page, `extracted_at`, `tool_used` (Vision API vs OCR).
- New table `document_intelligence_reports` — **versioned** reports per deal. Report structure: `{ mismatches: [], red_flags: [], quality_issues: [], story_consistency: [], fraud_signals: [] }` with severity and `evidence_document_id` + `page_number` references.
- **Access + retention (both new tables):** **owner-only RLS** — extractions and reports contain concentrated client PII and must never reach a partner, even on a partner-referred deal. Retention follows the same **records-retention schedule** as the rest of S17/S18 (basis + duration + deletion/restriction at expiry — not a blanket flat period); any **temporary or provider-side files** created during extraction/analysis are deleted after the report is persisted, and the tables participate in the **right-to-erasure / restriction** workflow (F10).
- **Evidence-reference validity:** `evidence_document_id` + `page_number` point at a specific document **version**. When a source document is **superseded, replaced, or deleted**, the referencing findings are marked **stale/invalidated** (not silently left pointing at moved bytes) — a regenerated report re-derives evidence against the current versions.
- Anthropic API integration for the analysis pass, under the **same data-processing controls as S17b** (approved commercial/API config + processor terms, zero-retention/no-training where available, data minimisation, Vault-managed key). Prompt template **versioned** in a `prompts` table; per-owner **rate + cost limits**; prompt/output **auditable logging** (owner-only).
- **Cost management:** analysis triggered **per-owner-click (never automatic)**, rate-limited per owner, monthly budget-alert threshold.
- **Report regeneration:** owner can rerun analysis when new documents land — old reports archived, the new one becomes current.

**Regulatory.** The intelligence report is an AI-assisted **DECISION SUPPORT** tool. The owner makes the final judgement — **the CRM does not auto-decline based on AI findings.** The report is **owner-only** (the partner does NOT see AI reports on their referred deals in Phase D). Findings are stored under the **defined records-retention schedule** (retention basis + duration + deletion/restriction at expiry — POPIA sets no flat period; confirm the applicable obligation with the legal advisor). The prompt template + Claude output are logged for audit.

**Owner intent:** *"This is the difference between guessing at a deal and knowing what I'm submitting. Every funder submission today is manual due diligence — I read every statement, cross-check every ID, spot every mismatch. AI does this in 90 seconds instead of 4 hours, catches things I miss, and produces an audit-ready report showing I did my homework."*

**Est. build:** 3–4 PRs (~2–3 weeks focused build) in Phase E6. Combines with **S17b** (Claude Story Refiner) and **S6a** (auto-generated FNC application) — all three form the **AI-assisted deal packaging suite**.

**Prerequisite:** the B4.1 substrate (story on lead — see S3) + the solid B3.1/B3.2 document infrastructure (already live). No new prerequisites to add now.

**Owner intent — the AI-assisted deal packaging suite (B4 close-out, 2026-07-19):** Document Intelligence, combined with the Claude Story Refiner (S17b) and the auto-generated FNC application (S6a), forms the **AI-assisted deal packaging suite** — the KEY commercial differentiator of Fund Now Capital vs other South African SME brokers. Every deal gets AI-assisted verification + an AI-refined pitch + an auto-generated professional package. A **manual version can bridge the gap before E6**, but **only under proper data handling** — client PII may not be uploaded to a consumer/personal AI account: use an approved processor (business/commercial tier under a data-processing agreement), obtain client consent, minimise/redact the documents, and delete after use. The automated CRM integration in Phase E6 is what makes this routine and audit-clean; treat the interim manual path as the exception, with the same care.
