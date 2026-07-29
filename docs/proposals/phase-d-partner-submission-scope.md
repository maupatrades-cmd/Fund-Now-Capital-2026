# Phase D — Partner Submission Scope Proposal (D1–D4)

**Status:** DRAFT — awaiting owner approval. Not final until Thapelo signs off.
**Author:** Claude Code (SCOPE session), 2026-07-29.
**Scope:** D1 → D4 only — the four modules that unblock referral partners from self-serving referrals. D5–D8 explicitly deferred (see §4).
**Nature:** Pure scope document. **No code, no schema, no migrations were written for this proposal.** It is the build brief a future Claude Code session will execute, one small PR at a time, under the standing propose → PR → CodeRabbit → owner-merge → apply → smoke-test rhythm.

> **Guard-rails honoured while writing this:** did not touch `SPEC.md` / `CLAUDE.md` / `ROADMAP.md`; did not touch application code; verified every schema claim below against the **live** database (`hvxruwkgmhjoypepffgv`, 2026-07-29). Where the canonical docs and the live schema disagree, this proposal calls it out rather than trusting the doc.

---

## 1. Why this, why now

Doctor (Bright Destiny) was always Partner #1. The business reality has moved faster than the roadmap: **multiple referral partners beyond Doctor now want to bring clients into Fund Now Capital.** Today every one of those referrals routes through Thapelo by hand — she is the single bottleneck. D1–D4 remove that bottleneck by giving a partner a login where they can:

1. **get in** (invite-only auth, T&C acceptance, a portal that is theirs, not the owner's) — **D1**
2. **submit a lead themselves** (same rigour as the owner's lead form, straight into the owner's inbox flagged as theirs) — **D2**
3. **attach the client's documents at submission** (upload-only, owner still controls verification) — **D3**
4. **watch their own referrals move** (stage, anonymised funder, hypothetical 50/50 earnings, 4-state cashflow) — **D4**

That is the minimum that turns a partner from "emails Thapelo a name" into "self-serves a complete, documented referral and tracks it to payout." D5 (the estimator) and everything social/automation-flavoured come later.

**One hard constraint frames the whole phase:** a partner must *never* see FNC's real funder names, FNC's gross commission, the 40/60 split, tier bands, another partner's data, or any client's bank statements. Every design decision below is subordinate to that. See §8 (anonymisation safety).

---

## 2. Ground truth — what already exists (verified live, 2026-07-29)

This is the single most important section for the build session: **a large part of the Phase D foundation is already in the database.** Do not rebuild it.

| Thing | State in live DB | Implication for D1–D4 |
|---|---|---|
| `user_role` enum | `{owner, partner}` — `partner` already exists | No enum change. Role value is ready. |
| `profiles.role` | `user_role` column, present | Role-based routing keys off this. |
| `profiles.referral_partner_id` | `uuid` FK, present | A partner login is already linkable to a `referral_partners` row. |
| `is_owner()` | exists | Owner-side RLS gate, reuse everywhere. |
| `current_partner_id()` / `partner_profile_id()` | **both exist** | Partner-scoping helpers already written — D2/D3/D4 RLS builds on these, not from scratch. |
| `is_partner()` | does **not** exist | Add a thin `is_partner()` (role='partner') for symmetry/readability. |
| `referral_partners` | exists but **thin**: `id, name, contact_email, contact_phone, is_active, notes, created_at, updated_at, slug` | **No** branding / banking / legal / address columns. D1 adds them. |
| `referral_partners` rows | 1 row: **Bright Destiny** (active) | Doctor's partner record exists; pilot target. |
| `funders.display_name_for_partner` | present, **populated on all 23 funders** | Anonymisation substrate is **already done** — the task's "add column if missing + populate" is a no-op. Verify the two newest funders' fictional names read as intended (Naledi / Sizwe per S1) — they are non-null, just confirm the spellings. |
| `funders.short_code`, `funders.is_contracted` | present (11 contracted) | Not needed by D1–D4 directly; noted for completeness. |
| Partner-facing views | `partner_leads_view`, `partner_submission_view`, `partner_stakeholders_view`, `partner_funder_industry_appetite` — **all exist** | D4 extends this established pattern (anonymised, PII-excluded, own-rows-only). Do not invent a new anonymisation mechanism. |
| Notifications | `notifications` / `notification_deliveries` / `notification_preferences` live; `notify_owner()` + `notify_recipient(referral_partner_id)` exist (the latter retained specifically for Phase D); `funder_display_name(funder_id, recipient)` is role-aware | Partner notifications ride existing rails. `notify_recipient` was built for exactly this moment. |
| Email | `send-notification-email` Edge Function v11+, four canonical S16 variants | Partner emails extend a canonical variant — never designed from scratch. |
| Documents | `documents` table live; partner INSERT policy present but `WITH CHECK (false)`; partner SELECT scoped to `uploaded_by = auth.uid()`, `upload_source='partner'` tag reserved | **D3 flips the guard** — the data layer was pre-provisioned in B3.1 exactly for this. |
| Decline surface | `deal_funder_submissions.decline_reason_category` (partner-safe) + `partner_submission_view` | D4 timeline reads declines from here (fictional name + reason category only). |
| T&C / acceptance / session tables | **none exist** | D1 builds T&C versioning + acceptance ledger from scratch. |
| Custom session token table | **none exists** (correct — see §7 security) | Do **not** create one. Supabase Auth owns sessions. |
| `commission_records` | live, 0 rows | D4 earnings display reads from here once C2 writes rows. Columns today: `gross_commission, company_retention, partner_pool, tier_pct, partner_share, owner_share` (+ `payment_received_date`). |
| `bonus_records` | **not yet live** (PR #86 pending merge) | D4's earnings display should tolerate its absence; wire bonuses only after #86 lands. |

**Net:** D1 is smaller than it looks (role plumbing + partner linkage already exist); the real D1 work is **T&C acceptance + branding profile fields + the invite Edge Function + the partner shell UI**. D4 is smaller than it looks (anonymised views + role-aware funder naming already exist); the real D4 work is **wiring the 50/50 display + 4-state cashflow onto existing anonymised reads**.

---

## 3. In-scope — the four modules in detail

### D1 — Partner Authentication + Portal Shell + T&C Acceptance

**Goal:** a partner receives an invite, sets a password, logs into a portal that is unmistakably *theirs* (not the owner's AppLayout), accepts versioned T&Cs on first login, and can see (read-only) their own branding/company profile.

**D1.1 — Invite-only authentication**
- Owner-initiated invite (see Open Decision A — recommend owner-initiated). Owner opens a `/settings/partners` form, enters the partner's email + selects/creates the `referral_partners` row, and sends an invite.
- Invite uses **Supabase Auth's native invite / magic-link flow** (`auth.admin.inviteUserByEmail` via the Edge Function using the service-role key server-side only) — the user record is created with `role='partner'` and `referral_partner_id` set. The partner clicks the emailed link and sets their password on first login. **No custom token table** (CLAUDE.md rule 1; §7).
- Public signup stays OFF (CLAUDE.md rule 4). Users are created only by the owner.

**D1.2 — Role-based access / routing**
- `partner` role sees **only** `/partner/*` routes. Owner surfaces (`/pipeline`, `/invoices`, `/clients`, `/settings`, `/activity`, `/calculator`, `/reports`, dashboard) are hard-blocked for partners — both at the router guard (redirect partner → `/partner`) **and** at the data layer (RLS), so a hand-typed URL returns no data even if the route rendered.
- Owner logging in still lands on the owner app unchanged.

**D1.3 — Portal shell (`PartnerLayout` + `PartnerSidebar`)**
- Separate layout, brand-consistent but distinct from owner AppLayout. Sidebar items: **Home · My Referrals · Documents · Earnings · Settings.**
- Top bar: partner's own branding (logo + business name), notification bell (reuses existing bell, partner-scoped), logout.
- Fictional funder names everywhere by construction — the shell never has access to a real-name data path.

**D1.4 — First-login T&C acceptance modal**
- On first login (and again only when a newer T&C version exists), a blocking modal shows the current **Partner T&Cs** (versioned) + explicit "I Accept" button. Acceptance recorded with `partner_id`, `tc_version`, `accepted_at`, `ip_address`/`user_agent` (best-effort), in an append-only ledger.
- Content of the T&Cs (commission split framing, referral protocol, deal ownership, confidentiality, POPIA) is owner/legal-supplied — see the T&Cs subsection of SPEC S17 and the ROADMAP E4 legal-review pre-work note. **This module builds the mechanism, not the legal text.** (See Open Decision B for versioning policy; §9 risk register for the "content not ready" risk.)

**D1.5 — Session management + logout**
- Sessions are **Supabase Auth sessions** (JWT access token + refresh token), timeout configured via Supabase Auth settings (Open Decision E). Logout calls `supabase.auth.signOut()`. No bespoke session store (§7).

**D1.6 — Partner profile page (read-only)**
- `/partner/settings` (or a Profile sub-tab) shows the partner their own record: logo, legal name, CIPC, VAT status, banking, physical address, contact info — **read-only** (owner sets it; Open Decision C recommends owner-controlled). A "Request an update" affordance sends a notification/email to the owner rather than letting the partner edit directly.
- Also on Settings: notification preferences (email on/off; WhatsApp shown "coming soon" until D6) and a link to download their signed agreement (deferred content-wise; placeholder acceptable).

**New/changed schema (D1):**
- `referral_partners` gains branding/company columns: `logo_url text`, `legal_name text`, `cipc_number text`, `vat_number text`, `is_vat_registered bool`, `bank_name text`, `bank_account_number text`, `bank_branch_code text`, `physical_address text`, `postal_address text`, `contact_person text`. (Banking columns are POPIA-sensitive → owner-only read except the partner's own row; see §6/§7.) *Correction to canonical docs: S8 states banking "(jsonb, already exists)" on `referral_partners` — it does **not** exist in the live schema; D1 adds it. Recommend discrete typed columns over jsonb for validation + RLS clarity, but flag for owner (Open Decision J).*
- `partner_tc_versions` (new): `id, version int/semver, title, body_markdown, published_at, published_by, is_current bool`. Append-only in spirit; one `is_current`.
- `partner_tc_acceptances` (new, append-only ledger): `id, referral_partner_id FK, profile_id FK, tc_version_id FK, accepted_at, ip_address, user_agent`. SELECT+INSERT-only RLS (mirrors the `client_story_notes` append-only pattern already in the codebase).
- (Optional, audit-only) `partner_login_events` — **not** a session store; a login/audit ledger feeding future F4 activity monitoring. Recommend deferring to F4 unless the owner wants login visibility now.
- `is_partner()` helper.

**New Edge Function (D1):** `partner-invite` (and password-reset path) — see §5.

---

### D2 — Partner Lead Submission

**Goal:** a partner submits a lead through `/partner/submit-lead` with the same field rigour and SA validation as the owner's lead form; it lands in the owner's inbox flagged as the partner's referral; owner is notified; duplicate submissions are prevented.

**D2.1 — Partner lead form (`PartnerLeadForm`)**
- Same field set as the owner's `/leads/new` (SPEC S2): business name, entity type, CIPC (format-validated), industry + sub-industry, turnover/employee ranges, primary contact (name, role, cell, email, ID), addresses, funding amount/purpose/timeline, existing debt, security available, initial notes.
- **Real SA validation** reused from the canonical `src/lib/sa-validation.ts` (B5.1): SA ID Luhn, CIPC format, cell normalisation. No partner-specific validation fork.
- **Duplicate detection at entry** reuses `find_lead_duplicates()` (B2.3): CIPC exact → **hard block** ("A lead already exists for this business — Fund Now Capital will follow up"); fuzzy name / email / cell → **soft warn**. The partner-facing copy must be gentle and must **not** leak whether the duplicate is another partner's lead or an owner client (privacy) — a generic "this business is already in our system, we'll be in touch" is the ceiling of what the partner sees.

**D2.2 — Submission writes the lead (`partner_submit_lead` RPC)**
- A `SECURITY DEFINER` RPC (belt-and-braces: `SET search_path=''`, `is_partner()` gate at entry, `current_partner_id()` for attribution) that inserts a `leads` row with:
  - `referral_partner_id = current_partner_id()` and `flagged_from_partner = true` (new boolean column on `leads`, default false — distinguishes partner-portal submissions from owner-entered `loaded_on_behalf` leads).
  - `entered_by = auth.uid()` (the partner), `qualification_stage='new_lead'`.
  - Server-side re-validation of CIPC + required fields (never trust the client). Client values are inputs, not truth.
- **Idempotency guard:** a Postgres **advisory lock** keyed on `hashtext(partner_id::text || lower(business_name))` for the duration of the insert, plus a short-window duplicate check, so a double-tap / double-submit cannot create two identical leads. (Distinct from the B2.3 CIPC hard-block, which catches *legally* identical entities; this catches *mechanically* duplicated submits of the same in-flight form.)

**D2.3 — Confirmation + owner notification**
- Partner sees: **"Lead submitted successfully — Fund Now Capital will contact your client within 24 hours."**
- Owner gets a notification: **"New lead from {partner name} — {business name}"** via a new `LEAD_SUBMITTED_BY_PARTNER` trigger (the enum value already exists — SPEC S4 lists `LEAD_SUBMITTED_BY_PARTNER`; confirm it's in the live enum and wire the trigger). Email extends the `welcome` variant (onboarding/first-touch tone) or a neutral variant — pick per S16.4 at build; recommend `welcome`.
- Activity logging: the existing A10 `leads` trigger already logs CREATE; the partner attribution rides in `referral_partner_id` + `flagged_from_partner`.

**New/changed schema (D2):**
- `leads.flagged_from_partner bool NOT NULL DEFAULT false`. (`referral_partner_id` already exists on `leads` per S2 — verify live and reuse.)
- `partner_submit_lead(payload jsonb)` RPC + grant matrix (EXECUTE to `authenticated`, gated internally to partners).
- `LEAD_SUBMITTED_BY_PARTNER` trigger + notification wiring.

---

### D3 — Partner Document Upload at Lead Submission

**Goal:** the same document-upload UX the owner has, scoped so a partner can upload **only** to their own submitted lead, can **only** upload (never verify/reject/delete), and the owner is notified.

**D3.1 — Partner upload UI (`PartnerDocumentUpload`)**
- Mirrors the owner's DocumentsPanel upload affordance (drag/drop or picker, category select), but scoped to the partner's own lead. Required categories match the owner's qualification gate (SPEC S2/S6, B3.2): **Business** — CIPC + tax clearance; **Financial** — bank statement; **Personal** — ID copy + proof of address for directors. Show a checklist of what's still needed so the partner knows the referral is "complete."
- Files upload to Storage under the entity-prefixed path `leads/{lead_id}/{document_id}/{filename}` (B3.2 shape), tagged `upload_source='partner'`.

**D3.2 — Upload permission (`partner_upload_document` RPC + RLS flip)**
- Flip the pre-provisioned partner INSERT policy from `WITH CHECK (false)` to the intended predicate: **own upload** (`uploaded_by = auth.uid()`), `upload_source='partner'`, **on a lead the partner referred** (`lead_id` belongs to a lead with `referral_partner_id = current_partner_id()`). (B3.1 built the columns + the `false` guard precisely so this is a one-policy change, not a schema change — see SPEC S11 "Partner document upload".)
- A `partner_upload_document` `SECURITY DEFINER` RPC records the row (belt-and-braces, `RETURNING id` row-count check per the silent-RLS rule). Partner has **no** UPDATE/DELETE path — verification columns (`verification_status`, `rejection_reason`, `verified_by`) are owner-only (B3.2); partner cannot touch them.
- Partner SELECT remains own-uploads-only (`uploaded_by = auth.uid()`), and **never** the structured-PII/bank-statement exclusion set (CLAUDE.md rule 7 — partners never see bank statements, even ones they uploaded? → **Open Decision J sub-point**: confirm whether a partner may re-view a bank statement *they themselves* uploaded. Recommend: partner sees the *fact* of the document (name, category, status) but not the *content* of bank statements after upload — safest POPIA posture. Decide at build.)

**D3.3 — Owner notification**
- On partner upload: owner notified **"Document uploaded on {partner}'s referred lead — {business name}"** (`DOCUMENT_UPLOADED` enum value exists but currently has no emitter — D3 becomes its first trigger). Email: neutral `weekly_summary` variant (informational tone, S16.4), or bundle into a digest to avoid one-email-per-file (see ROADMAP deferred "daily digest bundling").
- The existing B3.2 `LEAD_DOCUMENT_REJECTED` path already notifies the partner when the owner rejects — D3 gives that its portal surface (a "re-upload" action on the rejected doc, SPEC S11).

**New/changed schema (D3):** no new tables (documents infra exists). One RLS policy edit + `partner_upload_document` RPC + `DOCUMENT_UPLOADED` trigger.

---

### D4 — Partner Sees Their Referred Deals + Status

**Goal:** `/partner/my-referrals` lists the partner's own referred leads → clients → deals with stage, anonymised funder, and hypothetical-50/50 earnings across the 4-state cashflow; a detail view drills in; RLS guarantees own-referrals-only.

**D4.1 — Referrals list (`PartnerReferralsList`, `list_partner_referrals` RPC/view)**
- Lists the partner's referrals with: **business name (real — the partner referred it, they know who it is)**, current stage (Qualifying / Approved / Funded / Invoiced / etc.), anonymised funder via `display_name_for_partner`, and a commission summary (hypothetical 50/50 — see D4.3).
- Backed by extending the existing `partner_leads_view` / `partner_submission_view` pattern, or a new `list_partner_referrals()` `SECURITY DEFINER` reader that joins leads→clients→deals→submissions with `referral_partner_id = current_partner_id()` and **anonymised funder only**. Real funder name is *never in the query's projection* (§8).

**D4.2 — Deal detail (`PartnerDealDetail`)**
- Still anonymised, still hypothetical 50/50. Shows the stage timeline (the Part 3 F3 milestone pattern lives fully in D3-of-portal/S11; for D4's slice, a simpler stage indicator is acceptable — the rich 11-milestone timeline can be its own PR), declined submissions read as "Declined by {fictional name} — {reason category}" (from `partner_submission_view`), and per-deal earnings.

**D4.3 — Earnings display (`PartnerEarningsCard`) — the money presentation**
- **This is the highest-risk surface in the phase.** It must render the **hypothetical 50/50 view** exactly per SPEC S7C / S7C.1 / S11.1 (LOCKED):
  - Read the deal's **real** `doctor_take` (state-appropriate per S7A: requested→Estimated, approved→Potential, funded→Earned) from `commission_records` (once C2 writes rows).
  - Compute **display-only** `displayed_deal_pot = doctor_take × 2`; show "Your share (50%): R{doctor_take}" and "Other 50%: R{doctor_take}". The ×2 pot is **never persisted** — UI construct only.
  - **NEVER** show: `fnc_gross_commission` / `gross_commission`, `company_retention`, `partner_pool`, `tier_pct` / tier band, `owner_share`, the funder rate structure, or the real funder name.
- **4-state cashflow** (Earned → Outstanding → Payable → Settled): show per-deal state and a portfolio roll-up: "R X earned / R Y outstanding / R Z payable / R W settled." (Confirm canonical state labels vs the S8 `doctor_earnings.status` enum `earned/ready_to_invoice/invoiced/paid` — SPEC S7C reconciliation flag #2 — at build; C3 sets the enum, D4 must match its copy.)
- **Pre-Funded display** (Open Decision G — recommend show from **Approved** stage): show hypothetical earnings once a submission is Approved (Potential), not during raw Qualifying, so the partner sees expected earnings during the approval wait without seeing speculative numbers on unqualified leads.
- **Bonus tolerance:** `bonus_records` is not yet live (PR #86). The earnings card must render correctly with zero bonus data and only surface bonuses after #86 merges. Bonuses, when shown, follow the same partner-share-only framing.

**New/changed schema (D4):** primarily read-side — `list_partner_referrals()` reader + any thin partner-scoped view extensions. No new writable tables. Depends on **C2** having written `commission_records` for real numbers to exist (see §10 sequencing — D4 can ship its shell before C2 finishes and show "pending" states).

---

## 4. Explicitly out of scope (deferred)

Per the task brief, **not** in D1–D4:

- **D5** — Doctor's Commission Estimator (already locked: partner-share-only, hypothetical 50/50; S11.1/S7C). Builds on D4's earnings component but is its own module.
- **D6** — WhatsApp channel for partners (Twilio + Meta Business approval; A13 paperwork dependency).
- **D7 / D8** — Follow-on deal workflow (`parent_deal_id`, repeat clients — S11) and partner activity feed.
- **Doctor invoicing FNC** (C4 — `partner_invoices`, BD-XXXX sequence, partner-branding bucket). D1 stores the branding *fields*; the **`partner-branding` Storage bucket is C4 territory — do NOT create it in Phase D** (SPEC S11.2).
- **Monthly statements** (C5).
- Rich 11-milestone Deal Success Timeline (S11 F3) — D4 ships a basic stage indicator; the full visual timeline can be a later PR.
- Partner *edit* of their own profile/branding (D1 is read-only + "request update"; owner-controlled per Open Decision C).

---

## 5. New Edge Functions

| Function | Purpose | Auth model |
|---|---|---|
| `partner-invite` | Owner-triggered: create the auth user with `role='partner'` + `referral_partner_id` via `auth.admin.inviteUserByEmail` (service-role, **server-side only**), send branded invite email (extends S16 `welcome` variant) with the Supabase set-password link. | `verify_jwt` + owner check, OR invoked from an owner-only RPC via `pg_net` with the shared `X-Webhook-Secret` (same pattern as `send-notification-email`). Service-role key **never** reaches the client (CLAUDE.md rule 2). |
| Password reset | Prefer Supabase Auth's built-in `resetPasswordForEmail` (email link, configurable expiry — Open Decision D, recommend 24h) rather than a bespoke function. Only build a wrapper if branded email is required (then it extends `welcome`). | Supabase Auth native. |

Both must set `WEBHOOK_SECRET` in Vault + as an Edge Function secret if invoked via `pg_net` (CLAUDE.md Edge Function rule). Invite/reset emails extend a canonical S16 variant — no template designed from scratch.

---

## 6. Data model summary (all additive, all RLS-from-day-one)

| Object | Type | Notes |
|---|---|---|
| `referral_partners.*` branding/banking columns | new columns | Additive on a tiny table (1 row) — inline is fine (not a large populated table, so the NOT VALID/CONCURRENTLY FK rule doesn't bite; no new FKs anyway). Banking columns POPIA-sensitive. |
| `partner_tc_versions` | new table | Owner-write, all-authenticated-read (partners must read to accept). |
| `partner_tc_acceptances` | new table | Append-only (SELECT+INSERT policies only), partner inserts own, owner reads all. |
| `leads.flagged_from_partner` | new column | default false. |
| `is_partner()` | new function | role='partner'. |
| `partner_submit_lead()` | new RPC | SECURITY DEFINER, partner-gated, advisory-lock idempotency. |
| `partner_upload_document()` | new RPC | SECURITY DEFINER, own-referred-lead-scoped. |
| `list_partner_referrals()` | new reader | SECURITY DEFINER or view, anonymised projection, own-rows-only. |
| documents partner INSERT policy | policy edit | flip `WITH CHECK (false)` → real predicate. |
| `LEAD_SUBMITTED_BY_PARTNER`, `DOCUMENT_UPLOADED` triggers | new triggers | enum values already exist. |

Every new table gets RLS + A10 activity logging + (where user-relevant) notifications from day one (CLAUDE.md rule 8). Every mutation uses `.select()`/`RETURNING` + row-count check (silent-RLS rule).

---

## 7. Security architecture (the part that cannot be wrong)

### 7.1 Authentication & sessions — Supabase-native ONLY
CLAUDE.md rule 1 is **NON-NEGOTIABLE**: *Supabase native Auth only; `auth.uid()`-based RLS; NEVER custom session tokens (the LB-281 lesson).*

- **Correction to the task brief:** the brief lists a `partner_sessions` table as in-scope. **Do not build a custom session-token table** — that is precisely the LB-281 anti-pattern. Sessions are Supabase Auth JWT + refresh tokens. Session *timeout* is a Supabase Auth setting (Open Decision E). If the owner wants login *visibility*, build an **audit-only** `partner_login_events` ledger (append-only, never consulted for auth) — but recommend deferring that to F4. This proposal treats "partner_sessions" as satisfied by Supabase Auth, not a table.
- Invite + password-set + reset all go through Supabase Auth admin/native flows. Service-role key stays server-side in the Edge Function (rule 2).

### 7.2 RLS matrix (D1–D4 surfaces)

| Table / view | Owner | Partner |
|---|---|---|
| `referral_partners` (non-banking cols) | full | SELECT own row only (`id = current_partner_id()`), read-only |
| `referral_partners` banking cols | full | SELECT own row only (own banking is theirs) — but **never** another partner's; consider a column-restricted view if belt-and-braces wanted |
| `partner_tc_versions` | full CRUD | SELECT current only |
| `partner_tc_acceptances` | SELECT all | SELECT own + INSERT own (append-only) |
| `leads` | full | **no direct table access**; INSERT via `partner_submit_lead` RPC only; SELECT via `partner_leads_view` (own referrals, PII-excluded) |
| `documents` | full | SELECT own uploads (`uploaded_by=auth.uid()`, PII/bank-statement excluded); INSERT via policy+RPC on own referred lead; **no** UPDATE/DELETE |
| `deals` / `deal_funder_submissions` | full | SELECT via anonymised partner views only (own referrals, fictional funder, no gross/tier/owner-share) |
| `commission_records` | full (real math) | **no direct access**; earnings reached only through `list_partner_referrals()` projecting `partner_share` as the hypothetical-50/50 display — never `gross_commission`/`company_retention`/`partner_pool`/`tier_pct`/`owner_share` |
| `funders` | full (real names) | **never** — only `display_name_for_partner` via views/`funder_display_name(_, partner)` |
| bank statements / structured PII | full | **never** (rule 7) |

### 7.3 POPIA posture
- Partner sees only their own referrals' data, minimised: business name + stage + anonymised funder + their own earnings. Never client bank statement content, never other stakeholders' ID numbers/PII, never other partners' anything.
- T&C acceptance ledger is the POPIA consent record (versioned, timestamped, immutable).
- Notification/email bodies to partners carry fictional funder names + business name + reason categories only (never internal notes, never real funder identity) — the established B2.3/S4 rule.
- Activity logs continue to be owner-only; the F10 PII-redaction pass still applies to before/after snapshots.

---

## 8. Anonymisation safety architecture (Open Decision I — answered in depth)

**Threat:** a partner ever sees a real funder name. This is the relationship-and-trust-critical failure. Defence in depth:

1. **Projection-level (primary):** partner-reachable readers/views **never SELECT `funders.name`** into their projection. The real name is not merely hidden by RLS — it is *absent from the query the partner's client can run*. This is already how `partner_submission_view` / `partner_leads_view` work; D4 extends the same discipline. A leak would require adding `funders.name` to a partner projection, which code review must treat as a blocking finding.
2. **Function-level:** `funder_display_name(funder_id, recipient)` returns the real name only for owner recipients, `display_name_for_partner` for partners. All notification/email funder naming routes through it — never string-concat the raw name.
3. **RLS-level (backstop):** partners have no SELECT on `funders` at all. Even a mistaken join cannot reach the real name because the base-table grant isn't there.
4. **Data completeness:** all 23 funders already have non-null `display_name_for_partner` (verified) — there is no "falls back to real name because display name is null" gap. Add a CI/DB check (or a smoke assertion) that `display_name_for_partner` is non-null for every funder, so a future funder added without one is caught *before* it can leak.
5. **Test-level:** a dedicated anonymisation test (see §11) logs in as the test partner and asserts zero real funder names appear on any partner surface, PDF, notification, or email. This is a **release gate** (§13), not a nice-to-have.
6. **Materialised view? — not recommended.** A materialised view adds a refresh/staleness burden without adding safety over projection+RLS+function. Prefer the three live layers above. (Documented here because the task asked whether to materialise — recommendation is **no**.)

---

## 9. Open decisions — drafted with recommendations

| # | Decision | Recommendation | Rationale |
|---|---|---|---|
| **A** | Invite flow: owner-invite vs self-register+approve | **Owner-initiated invite** | Control the partner pool; public signup is OFF (rule 4); no approval-queue surface to build. |
| **B** | T&C versioning: how many prior versions kept; re-accept on update | **Keep all versions (append-only `partner_tc_versions`); require re-acceptance on next login after a version bump (blocking modal), not immediate forced logout** | Full audit trail is cheap and POPIA-friendly. Gradual (next-login) re-accept avoids kicking active partners mid-session; owner can force-expire sessions for a *material* change if ever needed. |
| **C** | Branding profile: who sets it | **Owner sets via `/settings/partners`; partner read-only + "request update"** | Owner-controlled data integrity (legal name, banking, CIPC feed C4 invoices); avoids a partner editing banking that pays them (fraud surface). |
| **D** | Password reset | **Supabase Auth email link, 24h expiry; MFA deferred to F2** | Native, secure, no bespoke code. MFA is a whole-app F2 hardening item, not Phase D. |
| **E** | Session timeout | **7 days (refresh-token rolling), with re-auth on sensitive actions** | Balances partner UX (they check in a few times a week) against exposure. 24h is too aggressive for low-frequency users; 30d too loose for a money surface. Owner may tighten. |
| **F** | Deals visibility scope | **Own referred only** | Matches the anonymisation architecture and D5 decision; a partner must not see another partner's or the owner's direct clients. |
| **G** | Commission display for pre-Funded deals | **Show hypothetical 50/50 from Approved (Potential) stage onward; hide during Qualifying** | Partner needs expected earnings during the approval wait (S11 "Potential (if you accept)"); avoids dangling speculative numbers on leads that may not qualify. |
| **H** | Per-partner notification prefs | **Email on/off per event now (reuse `notification_preferences`); WhatsApp shown "coming soon" until D6** | Infra already supports it; don't build WhatsApp UI before the D6 channel exists. |
| **I** | Anonymisation safeguards | **See §8 — projection + function + RLS + completeness check + release-gate test; no materialised view** | Defence in depth; the real name never enters a partner-reachable projection. |
| **J** | Anything else spotted | See below | — |

**J — additional items the build session must settle:**
1. **`partner_sessions` table** — **do not build** (see §7.1; violates rule 1). Treat as answered.
2. **Banking as columns vs jsonb** on `referral_partners` — recommend typed columns (validation + column-level RLS clarity). S8's "jsonb already exists" is inaccurate to live schema; correct it.
3. **Bank statement re-view by uploading partner** (§D3.2) — recommend partner sees the document's *existence/status* but not bank-statement *content* after upload (safest POPIA posture). Confirm at build.
4. **`bonus_records` not live** (PR #86) — D4 earnings must tolerate absence; wire bonuses only post-merge.
5. **Deal-name anonymisation** ("Deal #X" vs real business name) — S7C allows optional deal-name masking. Recommend **show the real business name** to the partner (they referred it; masking their own client is confusing); mask only the *funder*. Confirm with owner.
6. **`flagged_from_partner` vs existing `loaded_on_behalf`** — keep both; they mean different things (partner-portal-submitted vs owner-entered-for-a-referrer). Document the distinction in the migration comment.
7. **4-state label reconciliation** (Earned/Outstanding/Payable/Settled vs `doctor_earnings` enum) — must be settled at C3; D4 copy follows C3.

---

## 10. Dependencies & sequencing

- **D1** depends on nothing new (role plumbing exists) → can start immediately.
- **D2** depends on D1 (partner must be able to log in) + reuses B2.3 lead infra.
- **D3** depends on D2 (a lead to attach to) + B3.1/B3.2 documents (live).
- **D4 shell** can be built in parallel with D2/D3, but **real earnings numbers depend on C2** (`commission_records` rows). Since C2.2 is live and C2.4 is in PR #86, by the time D4 builds, C2 should be merged — but D4 must degrade gracefully to "pending" states when a deal has no commission record yet.
- **Bonuses** depend on PR #86.
- **Independent of** C4 (partner invoicing), D5, D6 — those come after.

**Recommended order:** D1 → D2 → D3 → D4 (each gating the next for real UAT), with the D4 shell scaffolded early against mock/pending data.

---

## 11. Suggested PR breakdown (small, independent)

One PR per logical change (standing rule). Rough sequence:

1. **PR-D1a (schema):** `referral_partners` branding/banking columns + `partner_tc_versions` + `partner_tc_acceptances` + `is_partner()` + RLS + A10 logging + DO-block assertions. *(migration)*
2. **PR-D1b (Edge Function):** `partner-invite` + password-reset wiring + branded invite email (extends `welcome`). Vault/secret setup.
3. **PR-D1c (UI):** `PartnerLayout` + `PartnerSidebar` + role-based routing guard + logout.
4. **PR-D1d (UI):** first-login T&C acceptance modal + acceptance write + partner profile (read-only) page + notification prefs.
5. **PR-D2a (schema/RPC):** `leads.flagged_from_partner` + `partner_submit_lead` RPC (advisory-lock idempotency) + `LEAD_SUBMITTED_BY_PARTNER` trigger. *(migration)*
6. **PR-D2b (UI):** `PartnerLeadForm` (reusing `sa-validation.ts` + `find_lead_duplicates`) + confirmation screen.
7. **PR-D3a (RLS/RPC):** flip documents partner INSERT policy + `partner_upload_document` RPC + `DOCUMENT_UPLOADED` trigger. *(migration)*
8. **PR-D3b (UI):** `PartnerDocumentUpload` + required-category checklist + rejected-doc re-upload surface.
9. **PR-D4a (reader):** `list_partner_referrals()` + any partner-view extensions (anonymised, own-rows-only). *(migration)*
10. **PR-D4b (UI):** `PartnerReferralsList` + `PartnerDealDetail` (basic stage indicator).
11. **PR-D4c (UI):** `PartnerEarningsCard` — hypothetical 50/50 + 4-state cashflow (the money surface; heaviest review).
12. **PR-D-owner-admin:** `/settings/partners` owner UI to create/invite partners + set branding (pairs with D1a/D1b).

Schema PRs (1, 5, 7, 9) each: merge → apply to live → owner smoke test before the dependent UI PR.

---

## 12. Estimated build time (per module)

Indicative, assuming the propose→PR→review→merge→apply→smoke cadence (calendar time > keyboard time because of review/merge waits):

| Module | Keyboard estimate | Notes |
|---|---|---|
| **D1** | ~4–6 focused build-days across 4 PRs + 1 Edge Function | Auth plumbing exists; T&C mechanism + shell + invite function are the real work. |
| **D2** | ~2–3 days across 2 PRs | Heavy reuse of B2.3 lead infra + validation. |
| **D3** | ~2 days across 2 PRs | Mostly an RLS flip + UI; documents infra exists. |
| **D4** | ~4–5 days across 3 PRs | Earnings card (50/50 + 4-state) is the careful part; needs C2 data. |
| **Owner admin (`/settings/partners`)** | ~1–2 days | Pairs with D1. |

**Phase D1–D4 total:** roughly **13–18 focused build-days**, spread over a longer calendar window by review/merge/UAT gates. The T&C *legal content* (external, owner-driven — ROADMAP E4 pre-work) can run in parallel and must be ready before the pilot (§13).

---

## 13. Testing strategy

**Unit (Vitest, per ROADMAP deferred-polish "pure-function test harness" — worth standing up here):**
- SA validation reuse (already canonical), 50/50 display math (`doctor_take × 2`, state selection per S7A), currency formatting (en-ZA `R1,250,000`).

**Integration (DB, via DO-block assertions + SQL smoke):**
- `partner_submit_lead` writes `referral_partner_id` + `flagged_from_partner`, honours advisory-lock idempotency (double-submit → one row).
- `partner_upload_document` succeeds on own referred lead, **fails** on a foreign lead (RLS returns 0 rows → RPC raises).
- RLS negative tests: partner cannot SELECT `funders.name`, `commission_records`, another partner's leads/deals/documents, any bank statement.
- T&C: acceptance is append-only (UPDATE/DELETE blocked); re-accept triggers on version bump.

**Anonymisation release-gate test (§8.5) — MUST pass before any real partner is invited:**
- Logged in as the test partner, crawl every partner surface + every partner notification/email body + any generated PDF; assert **zero** occurrences of any real `funders.name` and **zero** exposure of gross/retention/pool/tier/owner-share.
- Assert every funder has a non-null `display_name_for_partner`.

**Real partner UAT (Doctor):**
- Doctor (or the `queenasdice@gmail.com` test-partner placeholder first) runs the full flow: accept invite → set password → accept T&Cs → submit a real lead → upload documents → watch it appear owner-side → see it move to Approved/Funded → verify the 50/50 earnings read matches his signed-agreement expectation → confirm he never sees a real funder name.

---

## 14. Rollout plan

1. **Staging / preview first.** Build + verify on the Vercel preview against the live DB's partner-scoped RLS with the **test partner account** (`queenasdice@gmail.com`). Run the full §13 suite including the anonymisation release gate.
2. **Anonymisation gate + owner sign-off (hard stop).** No real partner is invited until the anonymisation release-gate test is green and the owner has personally viewed the partner surfaces and confirmed zero leakage.
3. **T&C content ready.** Partner T&Cs (legal-reviewed per E4 pre-work) loaded as `partner_tc_versions` v1 before any real acceptance.
4. **Doctor as pilot.** Swap/promote Doctor's real account (per ROADMAP D7 — `masobota18@gmail.com`; confirm current address with owner), invite him first, run the UAT above, gather feedback, fix, re-verify.
5. **Then widen.** Only after Doctor's pilot is clean, invite the next wave of partners — each via the owner-initiated invite, each accepting current T&Cs, each isolated by own-rows RLS.
6. **Monitor.** Watch notification delivery, invite email deliverability, and (if F4 login events are added) partner login success.

---

## 15. Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Partner sees a real funder name / internal split** | low (if §8 followed) | **critical** (trust/relationship) | Defence-in-depth §8; anonymisation release gate is a hard stop; code review treats any `funders.name` in a partner projection as blocking. |
| **Partner sees another partner's / owner's client data** | low | high (POPIA + trust) | Own-rows RLS via `current_partner_id()`; negative integration tests; owner review. |
| **Custom session table reintroduces LB-281** | medium (task brief lists it) | high | Explicitly rejected (§7.1); Supabase-native sessions only; called out here so the build session doesn't build it. |
| **Invite email fails to deliver** | medium | medium | Reuse verified `fundnowcapital.africa` Resend domain; log delivery in `notification_deliveries`; owner can re-send from `/settings/partners`; fallback: owner shares a manual reset link. |
| **T&C content not ready at pilot** | medium | medium (blocks acceptance) | E4 legal pre-work flagged now; T&C mechanism ships independently of content; pilot gated on v1 loaded. |
| **Duplicate/erroneous lead submissions** | medium | low | Advisory-lock idempotency + B2.3 CIPC hard-block + fuzzy warn; gentle privacy-safe partner copy. |
| **Wrong commission number shown (50/50 math or state)** | low | high (partner trust in money) | Read-only from `commission_records`; math per S7C.1 with worked-example unit tests; UAT against Doctor's signed agreement; graceful "pending" when no commission record. |
| **Partner edits banking that pays them (fraud)** | n/a by design | high | Owner-controlled profile (Decision C); partner read-only + request-update; edit triggers owner alert. |
| **`bonus_records` absent breaks earnings card** | medium (until #86) | low | Degrade gracefully; wire bonuses only post-merge. |
| **Multi-agent file collision** (4 sessions live) | medium | medium | This proposal touches **only** `docs/proposals/…`; build PRs coordinate through the owner as merge coordinator. |

---

## 16. Acceptance gates (owner signs off before each)

1. **Schema gate (per schema PR):** migration applied to live DB, DO-block assertions passed, owner smoke test of the new tables/columns/RLS.
2. **Anonymisation gate (before ANY real partner):** §8.5 release-gate test green; owner personally confirms zero real funder names / zero internal-split exposure on every partner surface, notification, email, and PDF.
3. **Auth gate:** invite → set-password → login → logout works; partner cannot reach owner routes (router **and** data layer); session timeout behaves per Decision E.
4. **T&C gate:** v1 T&Cs (legal-reviewed) loaded; first-login acceptance recorded; version-bump re-acceptance verified; ledger immutable.
5. **Submission gate:** partner lead lands owner-side with correct flags; owner notified; idempotency holds; duplicate detection fires with privacy-safe copy.
6. **Document gate:** partner can upload only to own referred lead; cannot verify/reject/delete; cannot see bank-statement content of others; owner notified.
7. **Earnings gate:** 50/50 display + 4-state cashflow match S7C.1 worked examples and Doctor's signed-agreement expectation; no gross/tier/owner-share anywhere.
8. **Pilot gate:** Doctor's end-to-end UAT clean before widening to other partners.

Each gate is an explicit owner sign-off, in her decision seat (CLAUDE.md working style).

---

## 17. Summary for the owner (plain language)

Thapelo — the goal of D1–D4 is to stop every referral going through you by hand. A partner gets their own login and their own little version of the CRM where they can add a client, attach that client's documents, and then watch the deal move and see what they'll earn — all without ever seeing which real funder we used or how our internal split works.

The good news from checking the live database tonight: **a lot of the foundation is already built.** The "partner" role, the link from a login to a partner record, the fake funder names on all 23 funders, and the safe partner-only views already exist. So D1 is mostly the T&C acceptance, the invite email, and the partner's own screens; D4 is mostly wiring the "50/50" earnings display onto reads that already hide the real funder.

Two things I want to flag before anyone builds:
1. The task notes mention a "partner_sessions" table. **We should not build that** — it's exactly the custom-session-token mistake CLAUDE.md rule 1 warns about (LB-281). Supabase's own login system handles sessions safely. I've written the proposal to use that instead.
2. The old spec says Doctor's banking is already stored — it isn't, in the live database. D1 adds those fields (and you'll control them, not the partner).

Everything else — invite flow, T&C versioning, who controls branding, password reset, session length, when to show earnings, and the anti-leak safeguards — I've drafted a recommendation for each in §9. Nothing gets built until you approve. Take your time with it.

---

*End of proposal. Awaiting owner approval before this is treated as final.*
