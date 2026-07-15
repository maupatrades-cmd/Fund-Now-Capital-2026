# FUND NOW CAPITAL CRM — MASTER ROADMAP (v2, integrates Parts 1–6)

This is the single source of truth for build order. It supersedes the per-part phase suggestions in Parts 1–6. Feature DETAILS live in `SPEC.md`. Core rules live in `CLAUDE.md`.

**Ordering principle:** dependencies first, money-adjacent systems get their audit/notification plumbing BEFORE they exist, Doctor's portal ships only when it has real data to show.

**Legend:** ✅ done · 🔨 in progress · ⬜ not started · 🔒 blocked by earlier item

## PHASE A — Core Spine (CURRENT — finish before anything new)
Goal: the original 5-screen CRM works end-to-end with a real deal, plus the two foundations every later module writes into.

- ✅ A1. Schema: 11 tables, RLS, commission engine, 21 funders seeded
- ✅ A2. Auth + login (owner + test partner accounts, signup disabled)
- ✅ A3. Owner Dashboard (KPIs, pipeline snapshot, actions needed)
- ✅ A4. Funder Panel (list, detail, editable partner display name)
- ✅ A5. Client Database (list, detail tabs, contacts, documents bucket)
- ✅ A6. Pipeline Kanban + Deal Detail + Calculator (PR #9)
- ✅ A7. GATE: deal_pipeline migration applied to live DB; dashboard/pipeline errors gone
- 🔨 A8. Declined-stage terminal fix (CodeRabbit finding — client guard + DB trigger + deliberate revival) — PR #10, awaiting CodeRabbit
- ⬜ A9. SMOKE TEST GATE: Mama Mabase entered as client, R8M deal created (DEAL-001), dragged across stages, priority glow on, dashboard KPIs show real numbers
- ⬜ A9.5. Partner-safe decline model (PR Y): `deal_funder_submissions` gains `decline_reason_category` (partner-safe enum) + owner-only `decline_notes_internal`; DB CHECK requires a category when a submission is declined; deal-level auto-decline moves the deal to terminal Declined once its last active submission is declined (respects the terminal trigger + `reopen_deal`, logs to `deal_stage_history`); `partner_submission_view` exposes fictional funder name + status + reason category for the partner's own deals only. Owner decline-form UI included; partner portal surface deferred to Phase D (S11).
- 🔨 A10. Activity Logging foundation (Part 4): `activity_logs` table, async triggers on CREATE/UPDATE/DELETE for deals/clients/client_contacts/deal_funder_submissions/commission_records, per-entity Activity tab (deal + client detail), owner `/activity` timeline with filters + CSV export. (Generalises the stage-history table from PR #9.) `leads` trigger deferred to B2 (table doesn't exist yet). — in this PR, awaiting CodeRabbit.
- ✅ A11. In-app Notification system (Part 4): `notifications` + `notification_deliveries` + `notification_preferences` tables, bell icon + dropdown + mark-as-read, Realtime badge updates, `/notifications` list + `/settings/notifications` prefs. DEAL_APPROVED / DEAL_FUNDED / COMMISSION_PAID triggers live (owner-targeted, role-aware funder names); LEAD_CREATED_FOR_YOU trigger stubbed for B2. Hardened: mark-read RPCs return affected rows. — merged (PRs #18, #19), applied + verified live.
- 🔨 A12. Email notifications via Resend (Part 4, high-priority events: LEAD_CREATED_FOR_YOU, DEAL_APPROVED, DEAL_FUNDED, COMMISSION_PAID): `send-notification-email` Edge Function invoked async via pg_net, branded HTML + text template, per-event email prefs (owner default on), skip on disabled/quiet-hours/digest, `notification_deliveries` email rows. Domain `fundnowcapital.africa` verified in Resend. — in this PR, awaiting CodeRabbit.
- ⬜ A13. START (paperwork only, runs in parallel): Twilio account + WhatsApp Business API verification + template pre-approval. Long lead time; begin now.

## PHASE B — Data Foundations (Parts 2 + 6.M1)
Goal: the data structures every later feature assumes.

- ⬜ B1. Industry Classification (Part 2): `industries` + `sub_industries` + `funder_industry_preferences` tables, seed all 25 industries + sub-industries + baseline appetite matrix. Clients gain `industry_id` (migrate free-text sector).
- ⬜ B2. Lead Entry + Qualification (Part 2): `leads` table, owner manual-entry form (full field set), qualification workflow (4 stages, 15 standard reasons), auto-create deal on "Qualified". Loaded-on-behalf fields (Part 4) included now. Fires LEAD_CREATED_FOR_YOU notification (owner-entered for Doctor).
- ⬜ B3. Document Management upgrade (Part 6 M1, core slice): full taxonomy enum, version control, expiry dates + expiry alerts, metadata fields. (OCR, external share links, e-signatures deferred to Phase E/F.)
- ⬜ B4. Client Story basic (Part 2): `client_stories` + `call_logs` tables, Story tab + Call Log tab on client detail. First real capture: Fepa Sechaba (Tumi).
- ⬜ B5. Data validation pass (Part 6 M6, core slice): SA ID Luhn check, CIPC format, cell format, duplicate detection on client/lead creation.

## PHASE C — Money Operations (Part 5)
Goal: every rand invoiced, tracked, and paid — with the audit trail already live under it.

- ⬜ C1. Invoicing FNC → funders: `invoices`/`line_items`/`payments` tables, auto-draft on Funded, approval flow, branded PDF (sequence continues from INV-0031), Resend delivery, overdue flags at 30/45/60 days
- ⬜ C2. Commission records wiring: deal funded → `commission_records` ledger row (the follow-up Claude Code flagged in PR #9)
- ⬜ C3. Doctor's earnings engine: `doctor_earnings` lifecycle (earned → ready_to_invoice → invoiced → paid)
- ⬜ C4. Doctor invoicing: BD-XXXX sequence, branded PDF, payment recording
- ⬜ C5. Monthly statements for Doctor (auto-generated PDF)
- ⬜ C6. Reports v1 (Part 5 R1+R2): Business Performance Overview + Funder League Table
- ⬜ C7. Owner Home v1 (Part 2): greeting, scripture/affirmation line, monthly targets, vision horizons (basic). Old dashboard becomes "Business Overview" in nav.

## PHASE D — Doctor's Portal Launch (Parts 1 + 3)
Goal: Doctor logs in and finds a living product. GATE: real deals + earnings data exist. DECISION REQUIRED before D5: Commission Estimator "Business View" transparency level (full ranged breakdown vs Doctor's-number-only). Logged in CLAUDE.md as OPEN DECISION.

- ⬜ D1. Partner-role routing + portal shell (his own layout, fictional funder names everywhere)
- ⬜ D2. Portal screens: dashboard, Submit Lead, My Deals, Deal Detail (timeline view, Part 3 F3), Earnings & Statements, Invoicing (ready-to-invoice queue), Profile, Help
- ⬜ D3. Deal Success Timeline visualisation (Part 3 F3) with stage notifications
- ⬜ D4. Client Estimator calculator (Part 3 F1) + Save Scenario
- ⬜ D5. Commission Estimator (Part 3 F2) — pending transparency decision
- ⬜ D6. WhatsApp notifications go live (Twilio approved by now; SMS fallback)
- ⬜ D7. Swap test partner account → Doctor's real account (masobota18@gmail.com), partner smoke test of anonymisation (zero real funder names anywhere)

## PHASE E — Automation & Intelligence (Parts 1, 5, 6, 7)

**Note:** Part 7 (Lead Nurture & Partner Focus, SPEC S15) slots in here, after Doctor's portal ships in Phase D. It's deliberately not earlier — nurture automation needs real **leads** (B2), **notifications** (A11/A12/D6), the **partner portal** (D1–D2), and **invoicing** (C1) live underneath it first.

- ⬜ E1. Gmail integration (two-way, auto-attach to deals)
- ⬜ E2. Email template library + funder submission templates (Part 6 M3)
- ⬜ E3. Deal packaging & submission automation (Part 6 M3): validation checks, auto-bundled PDF, multi-funder submit
- ⬜ E4. Client onboarding workflow tracker (Part 6 M4, 10 steps) + document request links
- ⬜ E5. Automated welcome flow (website form → CRM → Resend)
- ⬜ E6. AI features (Part 1 P3): email drafter, bank statement analyser, funder routing recommender; Best Fit AI Advisor for Doctor (Part 3 F4)
- ⬜ E7. Reports v2 (Part 5 R3–R5): sector analysis, velocity/conversion, cash flow projection; scheduled email reports
- ⬜ E8. Vision Board + KPI Projection Engine (Part 2, Owner Home v2)
- ⬜ E9. Lead Nurture + Nudge Toolkit (Part 7 — SPEC S15.M1 + S15.M3): 14-day client nurture automation (`lead_nurture_sequences` + `nurture_events`, pg_cron Edge Function, auto-created on lead qualify) + owner-managed WhatsApp/email nudge templates (`nudge_templates`/`template_versions`/`nudge_usage`, owner-edit / partner read-only). Highest impact.
- ⬜ E10. Partner Focus Dashboard + Trust Pack (Part 7 — SPEC S15.M2 + S15.M4): redesigned partner dashboard (this-week's-focus, lead-health, stalled leads, 3-lead friction check → `lead_health_metrics`/`partner_streaks`) + client Trust Pack PDF, progress indicator, and `client_testimonials`. Behavioural-change layer.
- ⬜ E11. Partner Motivation + Owner View + Sunday Setup (Part 7 — SPEC S15.M5–M7): weekly reflection, owner↔partner messages (`owner_partner_messages`), partner performance view + `coaching_prompts` + `partnership_health_scores`, and the Sunday Setup ritual (`weekly_commitments`). Partner AI Coach deferred to Phase F.

## PHASE F — Hardening & Scale (Parts 4, 5, 6)

- ⬜ F1. Global search (Part 6 M2): Postgres full-text first; semantic later
- ⬜ F2. Security hardening (Part 6 M8): 2FA, session management, security event alerts
- ⬜ F3. Backup & continuity (Part 6 M7): secondary offsite backup, weekly restore test, data export tools, DR playbook
- ⬜ F4. Activity monitoring dashboards (Part 5 M4): engagement scores, alerts, Doctor's transparent self-view
- ⬜ F5. PWA + mobile experience (Part 6 M9): installable, camera capture, push
- ⬜ F6. Learning feed + gamification (Part 3 F5–F6): rank badges (Bronze→Silver→Gold→Platinum→Elite; `badge_designs` catalogue + `doctor_badges`) + confetti celebrations (canvas-confetti, four sizes). Full design in **SPEC S14**. Build order unchanged — ships here in F6, not earlier.
- ⬜ F7. Integrations (Part 6 M10): CIPC validation, Absa matching, Chrome extension, webhooks
- ⬜ F8. Advanced BI (Part 6 M11) + institutional wiki (Part 6 M12)
- ⬜ F9. Data quality full suite (Part 6 M6): completeness scoring, hygiene prompts, merge

## PART 7 (future, deliberately deferred)
Client-facing portal, client self-service applications, client dashboards.

## OPEN DECISIONS
1. Doctor's Commission Estimator "Business View": full ranged internal-split breakdown (Part 3 spec) vs Doctor's-own-number-only. Blocks D5. Owner to decide.
2. Password expiry policy (Part 6 suggests 90 days; modern guidance disfavours forced rotation — recommend long unique passwords + 2FA instead). Owner to decide at F2.

## STANDING RULES FOR EVERY BUILD
- One PR per logical change; CodeRabbit reviews BEFORE merge; owner merges.
- Schema PRs: migration applied to live DB immediately after merge, then owner smoke test.
- All money computed server-side. All new tables get RLS + activity logging from day one.
- Fictional funder names in every partner-facing surface. No exceptions.
