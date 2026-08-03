# Agent Coordination Status

## MY-DEALS-VIEW-SHELL LANE — partner + contractor "My Deals" read-only view (2026-08-03)
- Branch: `claude/my-deals-view-shell-e3w2z0` (fresh main @ `a1b2ae5`, PRs #104/#105 in). One PR. **DO NOT merge — owner merges after Macroscope.**
- **Real problem solved:** partners (Doctor / Bright Destiny) + contractors need to see the deals that grew out of the leads THEY referred — with a partner-safe status and an anonymised funder name. Read-only shell; **no earnings/commission display** (that's a follow-up PR after PICKER-BACKEND merges).
- **Schema reconciliation (verified against live 2026-08-03 — the brief's assumed shape did NOT match live):** `deals` carries **no** submitter-attribution column (only `referral_partner_id` → referral_partners.id; contractors have no referral_partner at all) and **no** `submitted_at`. Submitter attribution lives on `leads.attributed_to_partner_id` / `attributed_to_contractor_id` (= auth.uid(), from LEAD-SUBMIT PR #104); a deal links back via `deals.lead_id` (set by qualify_lead). **So the only POPIA-correct, role-uniform submitter→deal path is `deals.lead_id → leads.attributed_to_{partner,contractor}_id = auth.uid()`** (INNER JOIN leads → legacy DEAL-001 with no lead is correctly invisible). `submitted_at` = the originating lead's `created_at`.
- **Lane owned (this agent ONLY):**
  - **Migration `20260803090000_my_deals_view_rpcs.sql`** — two read-only SECURITY DEFINER RPCs `partner_list_own_deals()` / `contractor_list_own_deals()`. Belt-and-braces: `search_path=''`, role re-check (partner/contractor respectively) + `is_active` guard from profiles, strict `auth.uid()` filter; returns deal_id, deal_reference, client_business_name, current_stage (raw 15-value `deal_stage` as text), anonymized_funder_name (via existing `funder_display_name(awarded_funder_id, uid)` → fictional name only), submitted_at (lead created_at). **No commission/earnings columns.** Grants authenticated + service_role; anon/public revoked (FIX-A posture). DO-block assertions (exists / SECURITY DEFINER / grants matrix). **Dry-run verified via BEGIN/ROLLBACK against live — compiles, definer, grants correct, NOT persisted. Apply to live AFTER merge.**
  - `src/hooks/usePortalDeals.ts` — `usePortalDeals(portal)` (calls the role-appropriate RPC, cache keyed by portal) + `dealStatus()` (15 owner stages → 6 partner-facing labels New/Qualified/Submitted/Approved/Funded/Declined) + `DEAL_STATUS_BADGE`.
  - `src/components/portal/MyDealsList.tsx` — shared table used by both portals (Business / Funder / Stage badge / Submitted relative-time). Loading + error(retry) + empty state (`EmptyState` primitive; CTA → `/{portal}/submit-lead`).
  - `src/pages/partner/PartnerDealsPage.tsx` + `src/pages/contractor/ContractorDealsPage.tsx` (PortalShell + MyDealsList, mirroring the MyLeadsPage wrappers).
  - Routes: `/partner/deals` (App.tsx, inside PartnerGate block) + `/contractor/deals` (ContractorGate's own `<Routes>`, inside ContractorGate).
  - "My Deals" nav entry added to the shared `PortalShell` navItems (both portals get it — the brief's "sidebar entry in Partner + Contractor sidebar").
- **POPIA cross-role isolation:** partner RPC filters `attributed_to_partner_id = auth.uid()`, contractor RPC `attributed_to_contractor_id = auth.uid()`; the two columns are role-exclusive + each RPC is role-gated, so a partner can never see a contractor's deals and vice-versa. Funder identity never leaves the DB un-anonymised. Owner unaffected (owner has no partner/contractor role → RPCs raise; owner uses the CRM directly).
- **Shared files edited (additive only, expected merge points):** `src/App.tsx` (1 import + 1 route), `src/pages/ContractorGate.tsx` (1 import + 1 route), `src/components/portal/PortalShell.tsx` (1 nav item + icon import), `.coordination/status.md` (this section). PortalShell is LEAD-SUBMIT's file but merged to main; my lane owns adding the "My Deals" entry per brief.
- **Did NOT touch (other active lanes):** `deals` table / `activity_event_type` enum / any `calc_*`/`set_commission_picker`/`transition_to_*`/commission-picker fn (PICKER-BACKEND PR #106); `contractors` table + `/apply` route (CONTRACTOR-APPLICATION); `admin_*` RPCs (Team); sign-out buttons; `MyLeadsView`/`usePortalLeads`/`partner_submit_lead`/attribution migration (LEAD-SUBMIT — read/reused only). Migration timestamp `20260803090000` is 2026-08-03, distinct from every existing + LEAD-SUBMIT (2026-08-02) file.
- **Follow-up (next PR, after PICKER-BACKEND + TIER-ENGINE merge):** add the earnings column (Doctor's Rands, 50/50 framing per SPEC S7C — never gross/tier/pool) to `MyDealsList` + extend the RPCs.
- **Build:** `tsc -b` + `vite build` green; `oxlint` no new warnings (only pre-existing vapour-text/FilterBar/ConfettiProvider warnings remain).
- **POST-MERGE steps (owner/applier):** 1) apply `20260803090000_my_deals_view_rpcs.sql` to live; 2) Vercel auto-deploys frontend. Then acceptance test (below).
- **Acceptance test (post-merge + apply):** Doctor `queenasdice@gmail.com` → `/partner` → "My Deals" in nav → sees deals from leads he referred (anonymised funder + status), or the empty state if none of his leads are qualified into deals yet. Contractor `maupatrades@gmail.com` → `/contractor` → "My Deals" → same, own deals only. Partner cannot see contractor's deals; contractor cannot see partner's; owner unaffected. *(Note: with 0 attributed leads live today, both correctly show the empty state until the owner qualifies an attributed lead into a deal.)*
- Last update: 2026-08-03.

## LEAD-SUBMIT LANE — partner + contractor lead submission forms (2026-08-02)
- Branch: `claude/lead-submit-forms-bo10x4` (fresh main @ c2cb393). One PR. DO NOT merge — owner merges after Macroscope.
- **Depends on (already merged + live):** CONTRACTOR-BUILD (`contractor` role enum live), DOCTOR-BUILD (`PartnerGate`/`PartnerHomePage`). Verified live: `user_role = {owner,partner,contractor}`; test users owner `business.lekgoro@gmail.com` / partner `queenasdice@gmail.com` (→ Bright Destiny `9f48c460…`) / contractor `maupatrades@gmail.com`.
- **Lane owned (this agent ONLY):** `/partner/submit-lead` + `/partner/leads` + `/contractor/submit-lead` + `/contractor/leads` routes & pages · `src/components/portal/*` (PortalShell nav, LeadSubmitForm, MyLeadsView) · `src/hooks/usePortalLeads.ts` · `partner_submit_lead` + `contractor_submit_lead` RPCs · leads/documents/storage RLS additions (partner + contractor scoping) · "Submit a new lead" CTA + nav on both home pages.
- **Schema (3 migrations, verified via non-persisting BEGIN/ROLLBACK dry-run against live — DDL applies clean, both RPC bodies compile, grants matrix correct; NOT yet applied):**
  - `20260802120000_lead_submit_enums.sql` — `document_upload_source` += `contractor`; `notification_event_type` += `LEAD_SUBMITTED_BY_CONTRACTOR` (own migration so the values are committed before use).
  - `20260802120100_lead_submit_attribution.sql` — `leads.attributed_to_partner_id` / `attributed_to_contractor_id` (uuid → auth.users, FK NOT VALID + VALIDATE, partial indexes); `caller_owns_lead(uuid)` DEFINER helper (authenticated-only grant); leads SELECT policies `leads_partner_read_own` / `leads_contractor_read_own` (`attributed_to_*_id = auth.uid()`); documents `documents_lead_submitter_read` (PII-exclusion backstop) + `documents_lead_submitter_insert`; storage `documents_bucket_submitter_insert` (`leads/{lead_id}/…` path, own-lead check). DO-block assertions.
  - `20260802120200_lead_submit_rpcs.sql` — `partner_submit_lead` / `contractor_submit_lead` (belt-and-braces DEFINER: role re-check from profiles, required-field guards, sets attribution + `entered_by`, notifies every active owner via `emit_in_app_notification`; the existing leads triggers give activity_logs + CIPC-block for free). authenticated-only grants; anon/public revoked. DO-block assertions.
- **POPIA cross-role isolation:** partner sees ONLY `attributed_to_partner_id = auth.uid()` rows, contractor ONLY `attributed_to_contractor_id`; the columns are role-exclusive so neither can ever see the other's leads. Owner keeps full access (`leads_owner_all` / `documents_owner_all` untouched).
- **Notifications:** reuses existing `LEAD_SUBMITTED_BY_PARTNER` for partner; adds `LEAD_SUBMITTED_BY_CONTRACTOR` for contractor. `src/lib/notifications.ts` maps both (label + Handshake icon). NOT a badge event — clear of the BADGES lane. Email uses the send-notification-email generic fallback (a dedicated variant is optional F4/S16 follow-up, not built here).
- **⚠️ SHARED FILE with BADGES lane:** `src/pages/ContractorHomePage.tsx` — this lane adds the "Submit a new lead" CTA + nav (rewrites the shell onto PortalShell, keeps a content-stack card BADGES can extend). BADGES adds its badge CARD to the same content stack. Both branch from the same main; owner resolves the one expected merge overlap (additions to the content stack). No other file overlaps any active lane.
- **Files NOT touched (other lanes):** `/team/*`, `admin_*` RPCs, `badges`/`contractor_milestones` tables + badge triggers, the badge card component, badge-earning notification enum values.
- **POST-MERGE steps (owner):** 1) apply the 3 migrations to live IN ORDER (`enums` → `attribution` → `rpcs`); 2) Vercel auto-deploys the frontend on merge. Then run the acceptance test (below).
- **Acceptance test (post-merge + apply):** partner `queenasdice@gmail.com` → `/partner` → "Submit a new lead" → fill + attach a doc → submit → "Lead submitted for review" toast → `/partner/leads` shows it (status New). Owner inbox `/leads` shows it (referred_by Bright Destiny) + bell notification "New lead submitted by Bright Destiny". Same as contractor `maupatrades@gmail.com` (notification names the contractor). Partner cannot see contractor's lead; contractor cannot see partner's; owner sees both.
- `tsc -b && vite build` + oxlint green (no new warnings). Last update: 2026-08-02.

## TEAM-BUILD LANE — Team Management module (2026-08-02)
- Branch: `claude/team-management-module-8kutix` (fresh main — contractor + partner foundations already merged). One PR. **DO NOT merge — owner merges after Macroscope.**
- **Real problem solved:** adding a partner/contractor previously required manual SQL in the Supabase dashboard. This ships the owner-facing CRM screen to invite, list, edit-role, and deactivate people.
- **Scope shipped:**
  - **Migration `20260802100000_admin_update_user_role.sql`** — `admin_update_user_role(p_user_id, p_new_role user_role, p_new_referral_partner_id default null)`, SECURITY DEFINER + `search_path=''` + `is_owner()` gate. Refuses to assign/modify the owner role; **clears `referral_partner_id` for any non-partner role** (mirrors the contractor-role migration's `current_partner_id` role guard — the write-time complement); RETURNING+FOUND check (silent-RLS rule); writes a `PERMISSION_CHANGE` `activity_logs` row; grant matrix authenticated-only (FIX-A rule) + DO-block self-checks. **Apply to live AFTER merge.**
  - **Edge Function `admin-invite-user`** (verify_jwt=false; verifies caller Bearer JWT + `is_owner()`, then service-role for admin work). Creates the Auth user (`auth.admin.createUser`, `email_confirm=true`), upserts profile (adds `phone_number`, which `handle_new_user` doesn't set), delivers access via **magic link (Resend)** or **temp password** (returned to owner). **Idempotent** (same email+role → returns existing; different role → 409). Writes audit rows. Also backs the row-level "Resend invite".
  - **Edge Function `admin-deactivate-user`** (same auth model). Soft-delete: **bans** the Auth user (`ban_duration` — blocks login + kills sessions on refresh) + `profiles.is_active=false` + audit. Guards: can't deactivate the owner or yourself; idempotent if already deactivated.
  - `config.toml`: both functions `verify_jwt = false` (documented — CORS preflight + clean JSON errors; is_owner() is the real gate).
  - Frontend: `/team` route under OwnerGate, sidebar "Team" (between Activity and Industries), `src/pages/TeamPage.tsx`, `src/hooks/useTeam.ts`, `src/lib/team.ts`. Filter tabs (All/Owners/Partners/Contractors/Deactivated), table (Name/Email/Phone/Role/Status/Joined/⋮), Invite dialog (magic-link default / temp-password), temp-password copy-to-clipboard modal, Edit Role dialog (+ re-auth/referral-reset warning), Deactivate dialog (type `DEACTIVATE`).
- **Schema verified live (2026-08-02):** `user_role = owner|partner|contractor`; `profiles.role` NN default partner, `profiles.is_active` bool (no `status` column — deactivation uses `is_active`); `handle_new_user` sets full_name/role/referral_partner_id from `raw_user_meta_data` but NOT phone; `is_owner()` reads `profiles.role`; `activity_logs` written by DEFINER/service-role (no INSERT policy). Edge-function auth pattern (AUDIT §4): existing functions use verify_jwt=false + webhook secret for **server-to-server**; these are **browser-called**, so they verify the caller's JWT via `is_owner()` instead — documented in each function header.
- **NOT touched (respecting parallel lanes):** the 3 sign-out buttons (Owner TopBar, ContractorHomePage, PartnerHomePage — CONTRACTOR-BUILD lane); `src/pages/PartnerGate.tsx`/`PartnerHomePage.tsx`, `src/pages/Contractor*`, `src/lib/roles.ts` (imported read-only), `src/lib/notifications.ts`. Only shared files edited: `App.tsx` (one route), `navItems.ts` (one item), `config.toml` (append), `.coordination/status.md` (this section).
- **Build:** `tsc -b && vite build` green; `oxlint` no new warnings. No secrets added — `RESEND_API_KEY` / `APP_BASE_URL` are project-wide and already set.
- **Post-merge steps (owner / applier):** 1) apply migration `20260802100000_admin_update_user_role.sql` to live; 2) deploy Edge Functions `admin-invite-user` + `admin-deactivate-user` with **verify_jwt=false**; 3) acceptance test per the brief (owner sees Team → invites via magic link to a spare email → recipient logs in → temp-password path → edit role → deactivate).
- Last update: 2026-08-02.

## CONTRACTOR-BUILD LANE — contractor role + portal foundation (2026-08-02)
- Branch: `claude/contractor-role-portal-routing-urj72p` (fresh main @ d62c581). One PR. DO NOT merge — owner merges after Macroscope.
- **Scope shipped in this PR:**
  - Migration `20260802090000_contractor_role.sql` — adds `contractor` to the live `public.user_role` enum (verified live 2026-08-02: role lives on `profiles.role`, bootstrapped by `handle_new_user` from `raw_user_meta_data->>'role'`; NOT a JWT claim, NOT a separate table). No new tables/RPCs → no grant-matrix change; DO-block assertions (exact 3 labels; zero RLS policies referencing contractor). **Apply to live AFTER merge.** Contractor gets zero data access by default: partner surfaces scope via `current_partner_id()` (NULL for contractors), everything else `is_owner()`.
  - `src/lib/roles.ts` — `roleHome()` single source of truth: owner → `/dashboard`, partner → `/partner`, contractor → `/contractor`.
  - Three-way post-login redirect (AuthPage) + role-aware `/` landing (App.tsx `RoleLanding`).
  - App.tsx routes: `/partner/*` → `PartnerGate` (DOCTOR-BUILD's file) · `/contractor/*` → `ContractorGate` (mine).
  - `src/pages/ContractorGate.tsx` (session+role guard, owns its subtree) + `src/pages/ContractorHomePage.tsx` (minimal shell: header/logo/logout, welcome, two placeholder cards).
  - OwnerGate: partner/contractor hitting any owner route now bounce to their own portal (was: static "Owner access only" card); unknown-role card retained.
- **⚠️ MERGE ORDER (owner):** DOCTOR-BUILD's PR (creates `src/pages/PartnerGate.tsx`) must merge **before or together with** this PR — App.tsx imports it, so main won't build (Vercel deploy fails) if this merges alone. Verified: with PartnerGate present, tsc+vite build+oxlint all green; without it, the missing import is the only error.
- **Contract for DOCTOR-BUILD:** App.tsx mounts `<Route path="/partner/*" element={<PartnerGate />} />` — PartnerGate must default-export a component that owns the whole `/partner` subtree (session + partner-role check inside; render PartnerHomePage itself or via descendant `<Routes>` with relative paths). Mirror ContractorGate.tsx if useful. Note: the live role enum value is **`'partner'`** (not `referral_partner`); `roleHome()` in `src/lib/roles.ts` is the shared redirect map — use it, don't hand-roll.
- Files NOT touched (DOCTOR-BUILD lane): `src/pages/PartnerHomePage.tsx`, `src/pages/PartnerGate.tsx`, `src/pages/partner/*`, `src/components/partner/*`, `src/lib/notifications.ts`.
- **Macroscope findings (both owner-approved + applied in-PR):** (1) Critical — role-conversion SQL now also clears `referral_partner_id`, AND the migration hardens `current_partner_id()` with `and p.role = 'partner'` so partner-scoped RLS/views can never authorize a non-partner regardless of column state (zero behaviour change for the 3 live profiles); (2) Medium — `useProfileRole` cache now keyed by user id + `ContractorGate` watches the live session (same pattern as PR #100).
- **Post-merge steps:** 1) apply migration to live; 2) owner assigns the contractor role to the existing test user `maupatrades@gmail.com` (auth user + profiles row already live, currently role `partner` via the handle_new_user default) in the Dashboard SQL editor — `update public.profiles set role = 'contractor', referral_partner_id = null where id = (select id from auth.users where email = 'maupatrades@gmail.com') returning id, email, role, referral_partner_id;` — expect exactly 1 row back (profile id `ce628fd1-5280-450a-8c14-71b83e2d4af0`, `referral_partner_id` null); sign that account out/in before testing; 3) acceptance: owner login → /dashboard · Doctor → /partner · contractor (maupatrades@gmail.com) → /contractor welcome shell · contractor hits /dashboard → bounced to /contractor · owner hits /contractor → bounced to /dashboard.
- **Known follow-up (owner, 2026-08-02 — small hygiene PR after both foundation PRs merge):** static-query-key sweep per DOCTOR-BUILD's PR #100 heads-up — this PR already re-keyed `useProfileRole` by user id; audit the remaining pre-existing hooks for the same static-key pattern (lower stakes — role-level data, not names) and re-key any that cache per-user data.
- Out of scope (later PRs): lead submission form, `/apply` application form, onboarding wizard, training, commission display, `contractors` table.
- **MERGE-ORDER RESOLVED (2026-08-02):** DOCTOR-BUILD's PR #100 merged to main first (correct order); this branch merged origin/main in — `PartnerGate.tsx` + `PartnerHomePage.tsx` now present, App.tsx `/partner/*` route resolves, full build green. Only conflict was this file (both lanes prepended a section — both kept).
- Last update: 2026-08-02.

## DOCTOR-BUILD — Partner portal welcome screen (2026-08-02)
- Branch: `claude/partner-portal-welcome-fbd8kz` (fresh main, d62c581). One PR; Macroscope reviews; **owner merges — agent does NOT merge**.
- Lane (this agent ONLY): `src/pages/PartnerGate.tsx` + `src/pages/PartnerHomePage.tsx`. Does NOT touch LoginPage/AuthPage, App.tsx, migrations, or anything in the CONTRACTOR-BUILD lane (`contractor` role migration, post-login redirect, App.tsx `/partner/*` + `/contractor/*` route entries, `src/pages/Contractor*`, `src/pages/contractor/*`, `src/components/contractor/*`).
- **Schema verified live before coding:** the referral-partner role is stored as `profiles.role = 'partner'` (`user_role` enum = `owner | partner` — there is NO `referral_partner` enum value). Partner identity: `profiles.referral_partner_id` → `referral_partners` (columns: id, name, contact_email, contact_phone, is_active, notes, slug — **no logo/branding columns**, so the header uses FNC branding; partner logos are C4/S11.2 territory). RLS confirmed: `profiles_select_own` + `referral_partners_partner_read_own` let a partner read exactly their own two rows.
- **Note for CONTRACTOR-BUILD:** `PartnerGate` checks `role === 'partner'` and works as a layout route (`<Outlet />`) or a children wrapper — mount `/partner/*` however suits App.tsx. Non-partners are redirected to `/login` per the brief (today `/login` falls through the `*` catch-all to `/` = AuthPage; harmless either way).
- Built: PartnerGate (role guard) + PartnerHomePage (FNC-branded header + sign-out, welcome using `referral_partners.name` — test partner renders "Bright Destiny", EmptyState "referred deals" placeholder, disabled "Submit a new lead" placeholder). No schema changes. `tsc && vite build` + oxlint clean (no new warnings).
- Acceptance test after BOTH PRs merge + Vercel deploy: queenasdice@gmail.com logs in → contractor-lane redirect → `/partner` → gate passes → welcome screen with partner name.
- Status: PR #100 MERGED to main (2026-08-02).

## AUDIT-FIX LANE — full system audit + sequenced fixes (2026-07-31)
- **Audit ✅ COMPLETE — `AUDIT.md`** (on branch `claude/fnc-crm-audit-fix-n48rvm`, awaiting owner merge). Read-only inventory of live `hvxruwkgmhjoypepffgv`: 29 tables/RLS/triggers/row counts, DEFINER RPC matrix (locks/idempotency/state guards/grants), Edge Functions, pg_cron (all green), routes, action buttons, notification events, commission-logic sites, advisors. **No blockers.** It supersedes the never-committed `.coordination/full-system-audit-2026-08-01.md` this file previously cited.
- **Owner-approved fix order: FIX-C (docs) → FIX-A (grants migration) → FIX-B (notification prefs matrix).** One PR each, fresh main, Macroscope, owner merges.
- **FIX-C — docs reconciliation — ✅ MERGED (PR #95, 2026-07-31).** Both Macroscope findings addressed in-PR (BONUS_PAID generic-fallback truth; S4 enum list completed to 30 values).
- **FIX-A — RPC grants hardening — ✅ MERGED (PR #96) + APPLIED + VERIFIED LIVE (2026-08-02).** Advisor after apply: anon DEFINER WARNs 14→0, mutable search_path 1→0, trigger-fn authenticated WARNs all cleared; remaining WARNs are the intentional authenticated RPC surface + F5 views (Phase D) + extensions (Phase F) + leaked-password (owner toggle). Verified live: authenticated intact on the API 10, zero API-role grants on the 29 internal fns, `leads_qualification_guard` pinned, `supabase_auth_admin` grant on `handle_new_user`. Residual cosmetic: 6 pure INVOKER helpers (`current_sast_date`, 4× `document_type_*`, `fnc_gross_commission`) still anon-granted — stateless, unflagged, out of approved scope.
- **FIX-B — 🔨 THIS PR** (`claude/fix-b-bonus-paid-email-variant`). Scope shrank: **PR #94 (merged) already delivered all 30 labels/icons/colours AND the prefs matrix** (which iterates `NOTIFICATION_EVENT_TYPES`); the prefs page displays missing rows as ON (`?? true`) matching the Edge Function default, and toggles upsert — so the F4 frontend control gap is closed. The one remaining F4 item: `send-notification-email` had no `BONUS_PAID` variant (generic fallback — Macroscope #95). This PR adds the **`bonus_paid`** variant (commission_paid layout + bonus copy, the `deal_funded` reuse pattern), `eventCategory` → `commission`, SPEC S4 + docs/email-templates.md updated. 12-check render test PASS. **After merge: redeploy `send-notification-email` (v12 → v13).**
- After all 3: separate scope proposal for the two S7C compliance items (flat-40% PO scope, R1M+ tier). **No commission-math change without explicit owner sign-off.**
- Owner-side dashboard tasks (no PR): leaked-password protection toggle; `short_code` for Business Partners + Better Banc; delete inert `pdflibtest` + `ops-storage-remove` Edge Functions. Architectural flag (Phase D planning): the 4 `partner_*` SECURITY DEFINER views.
- Last update: 2026-07-31 — FIX-C in flight.

## FIX LANE — audit follow-up (2026-07-31) — historical, folded into AUDIT-FIX lane above
Sequenced fixes, ONE PR at a time; owner merges each before the next. Do NOT merge — owner merges. Wait for Macroscope.
- **FIX #1 — Docs drift — ✅ MERGED (PR #92, 2026-07-31).** Docs-only. Reconciled funder count `21→23` (CLAUDE.md build-state, ROADMAP A1 annotation, SPEC S1 C0.3 `43+/21→43+/23`) and Polokwane address `75→73` (SPEC S16.3 + S7B.4 footer notes reflect the deployed v12 fix, docs/email-templates.md locked footer block). No code/DB changes.
- **FIX #2 — Lula + RM Capital rate cleanup — ✅ MERGED (PR #93) + APPLIED + VERIFIED LIVE (2026-07-31 audit spot-check: `funder_commission_structures` = exactly 4 rows, all `is_contracted=true` — Business Partners / Flow48 / Merchant Capital / Pollen).**
- **FIX #3 — notification event labels/icons — PR #94 OPEN** (`claude/fix-3-notification-icons`, awaiting Macroscope + owner merge).
- FIX #4–#5 — not started (sequencing now governed by the AUDIT-FIX lane above).

## OLD CC 1 — C2 Backend — ✅ CLOSED OUT (handover items all resolved as of 2026-07-31)
- Session: 2026-07-22 → 2026-07-27. C2.1/C2.2/C2.3 MERGED + APPLIED + verified live.

### ✅ RESOLVED — C2.4 applied (was "next session's first job")
- **PR #86 (C2.4) — MERGED + BOTH MIGRATIONS APPLIED IN ORDER + VERIFIED LIVE** (audit spot-check 2026-07-31): `bonus_records` table live with lifecycle triggers, `BONUS_PAID` present in both `activity_event_type` and `notification_event_type`, 0 rows, no leaked test deals.

### ✅ PR #87 (docs) — MERGED
- CLAUDE.md DEAL-001 correction (Funded stage but NOT genuinely funded; commission_records legitimately 0 rows; never backfill from notes).

### 6 triage findings — status (2026-07-31)
1. Test residue (DEAL-011/012 "reginald maupa") — **DONE** (owner cleaned).
2. Stale docs PRs #64/#39/#29 — **STILL OPEN**, recommend close/renumber (#64's "S7B" label clashes with merged #81's S7B).
3. BONUS_PAID (+ missing event) frontend mapping in src/lib/notifications.ts — **PR #94 OPEN**; full 30-event coverage lands as audit FIX-B after #94.
4. Email footer 75→73 Marshall St — **DONE via PR #84** (merged; v12 deployed + verified).
5. G7 commission-engine reconciliation — **OPEN, promoted to Open Decision 3** (CLAUDE.md/ROADMAP): (a) flat-40% for ALL PO deals vs S7C Sourcefin-only; (b) R1M+ tier 25% in-code vs "TBD" in S7C. Separate scope proposal after audit FIX-A/B/C; no engine change without owner sign-off.
6. DEAL-001 at kanban "Funded" but not genuinely funded — **OWNER JUDGMENT, still open** (move back vs progress properly). Money layer already ignores it correctly.

### C3 — 🔨 PARTIAL (updated 2026-07-31)
- **Owner-side `/partner-earnings` reconciliation view MERGED (PR #91).** Remaining C3: the S8 `doctor_earnings` lifecycle (earned → ready_to_invoice → invoiced → paid) + statements plumbing; P0002 settle/unsettle stubs wire up when C4 builds partner_invoices. Respect SPEC S7C presentation policy (Doctor sees only his Rands, 50/50 framing) + S8. Same rhythm: schema-verify → scope proposal → owner OK → build → PR → owner merges.

### Partial work worth preserving
- None uncommitted. Everything is in a PR (#86, #87) or merged. Scratchpad has commit-message drafts only (ephemeral). No stray branches beyond the pushed feature branches.
- LIVE STATE (verified 2026-07-27): 11 contracted funders; commission_records + (once #86 applies) bonus_records lifecycle wired; 0 real money rows (no genuine funding yet).
- Standing rule reminder for the applier: OLD CC 1 does NOT touch funder billing columns, CIPC data, or frontend.
- Last update: 2026-07-27 (Mon) — HANDOVER; OLD CC 1 stood down for rate-limit pause. Fresh session applies #86 post-merge.

## NEW CC 1 — Funder Billing + email footer + docs (STANDING DOWN — rate-limit pause)
- Last update: 2026-07-28 (Tue) — handover before strategic pause.

### ✅ Edge Function redeploy (DONE + verified)
- `send-notification-email` redeployed **v11 → v12** from merged `main` (after PRs #84 + #85 merged).
- Verified: footer address now **73 Marshall Street** (HTML + plain-text), no `75` anywhere; `verify_jwt=false` preserved (webhook-secret auth). Also brought the function current with `main` — the previously-undeployed C1.1 invoice email routing (FUNDER_INVOICE_ISSUED / INVOICE_MARKED_PAID / INVOICE_OVERDUE) is now live. This closes OLD CC 1's deferred "75→73 email-template TODO".

### ✅ SPEC S1 docs PR — ALREADY OPENED as **PR #88** (awaiting Macroscope + owner merge)
- NOT "planned/unopened" — it is open. A fresh session only needs to MERGE it, not create it.
- Content: SPEC.md S1 funder count `21 → 23` (+ derived appetite line 12 scored / 9→11 unscored, against 23; no invented scores); CLAUDE.md adds `Naledi` (Spartan) + `Sizwe` (AAA Consortium) to the fictional name pool.

### Funder billing block progress (funders INVOICE TO fields)
- **Pollen Finance** — full (pre-existing reference).
- **Merchant Capital** — DONE except **VAT** (owner to confirm number, or "not registered" → NULL). legal_name/address/CIPC/accounts_email/phone all set.
- **Bright On Capital** — name+legal_name set (renamed from "Brighton Capital"), short_code `BRIGHTON`. Address/CIPC/VAT/accounts_email still pending.
- **7 more contracted funders PENDING owner registered data** (address/CIPC/VAT/accounts_email): Bridgement, Sourcefin, GenFin, Better Banc, Flow48, Business Partners, + the 2 new (Spartan, AAA Consortium). ⚠️ Better Banc + Business Partners also lack a short_code.
- These details come from funder invoices/letterheads, not rate emails. Reconcile migration for all applied funder data = merged PR #85.
- Also captured (NOT applied): funder RATE-structure intel for C2 in scratchpad/funder-rate-structures-capture.md (Bright On 7.5% fees+interest, Sourcefin net-profit, Business Partners 1%, Spartan 1%, AAA 3%/opt1.6%, Centrafin 1%+2.8% client fee [NOT contracted]). Needs new rate_types → a C2 scope proposal.

- STANDING DOWN. No new work this session.

## DESIGN — UI polish + brand consistency (F5/F6 lane)
- Session: 2026-07-29 (Wed) ~21:25 SAST.
- Scope: empty states + loading states polish only. No partner/* routes, no C3–C7, no backend, no SPEC/CLAUDE/ROADMAP.
- **PR #89 — ✅ MERGED.** Branded empty state for `/leads` + new reusable `EmptyState` component (`src/components/ui/empty-state.tsx`). Filtered-empty vs first-run split.
- **PR #90 — OPEN (awaiting Macroscope + owner merge).** Branded empty state for `/clients` — reuses `EmptyState`, search-empty ("Clear search") vs first-run ("Add your first client"), lifted out of the table cell. Loading/error rows untouched. Visual-only, 1 code file, tsc+build+oxlint green.
- Note for other lanes: `EmptyState` (`src/components/ui/empty-state.tsx`) is the canonical empty-state primitive — reuse it, don't hand-roll "No X yet" text.
- Discrepancy flagged to owner: the briefing's `docs/proposals/f5-f6-ui-polish-scope-proposal.md` (Codex banked proposal) and `src/assets/fintech-spinner/` assets do NOT exist in this branch or origin/main. DESIGN lane is proceeding on the real live-code baseline instead.
- Queue: `/invoices` empty state APPROVED next (global CTA → `/pipeline?filter=funded`, verify param support first — else guidance-text-only). `/pipeline` empty column ON HOLD until BACK lands C3.
- Last update: 2026-07-29 (Wed).

## NEW CC 2 — Data Hygiene
- Session: not yet started
- Task: CIPC correction drafts + Brighton/Flow48 audit + sequence check + test residue scan
- Blocked on: owner CIPC portal lookup + Brighton/Flow48 review decision
- Last update: N/A
