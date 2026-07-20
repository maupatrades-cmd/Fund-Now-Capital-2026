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
- ✅ A8. Declined-stage terminal fix (CodeRabbit finding — client guard + DB trigger + deliberate revival) — merged, applied + verified live
- ✅ A9. SMOKE TEST GATE: Mama Mabase entered as client, R8M deal created (DEAL-001), dragged across stages, priority glow on, dashboard KPIs show real numbers — passed
- ✅ A9.5. Partner-safe decline model (merged, migration applied live): `deal_funder_submissions` gains `decline_reason_category` (partner-safe enum) + owner-only `decline_notes_internal`; DB CHECK requires a category when a submission is declined; deal-level auto-decline moves the deal to terminal Declined once its last active submission is declined (respects the terminal trigger + `reopen_deal`, logs to `deal_stage_history`); `partner_submission_view` exposes fictional funder name + status + reason category for the partner's own deals only. Owner decline-form UI included; partner portal surface deferred to Phase D (S11).
- ✅ A10. Activity Logging foundation (Part 4): `activity_logs` table, async triggers on CREATE/UPDATE/DELETE for deals/clients/client_contacts/deal_funder_submissions/commission_records, per-entity Activity tab (deal + client detail), owner `/activity` timeline with filters + CSV export. (Generalises the stage-history table from PR #9.) `leads` trigger deferred to B2 (table doesn't exist yet). — merged, applied + verified live.
- ✅ A11. In-app Notification system (Part 4): `notifications` + `notification_deliveries` + `notification_preferences` tables, bell icon + dropdown + mark-as-read, Realtime badge updates, `/notifications` list + `/settings/notifications` prefs. DEAL_APPROVED / DEAL_FUNDED / COMMISSION_PAID triggers live (owner-targeted, role-aware funder names); LEAD_CREATED_FOR_YOU trigger stubbed for B2. Hardened: mark-read RPCs return affected rows. — merged (PRs #18, #19), applied + verified live.
- ✅ A12. Email notifications via Resend (Part 4, high-priority events: LEAD_CREATED_FOR_YOU, DEAL_APPROVED, DEAL_FUNDED, COMMISSION_PAID): `send-notification-email` Edge Function invoked async via pg_net, branded HTML + text template, per-event email prefs (owner default on), skip on disabled/quiet-hours/digest, `notification_deliveries` email rows. Domain `fundnowcapital.africa` verified in Resend. — merged (PR #20), migration applied + function deployed to live; live DEAL_APPROVED smoke test passed end-to-end (email sent from hello@fundnowcapital.africa, `notification_deliveries` email row recorded `sent`).
- 🔨 A13. STARTED (paperwork only, external — owner-driven, runs in parallel): Twilio account + WhatsApp Business API verification + template pre-approval. Long lead time; underway now. Not a code build.

## PHASE B — Data Foundations (Parts 2 + 6.M1)
Goal: the data structures every later feature assumes.

- ✅ B1. Industry Classification (Part 2): `industries` + `sub_industries` + `funder_industry_preferences` tables, seed all 25 industries + sub-industries + baseline appetite matrix. Clients gain `industry_id` (migrate free-text sector). (Applied + verified live.)
- ✅ B2. Lead Entry + Qualification (Part 2): `leads` table, owner manual-entry form (full field set), qualification workflow (4 stages, 15 standard reasons), auto-create deal on "Qualified". Loaded-on-behalf fields (Part 4) included now. Fires LEAD_CREATED_FOR_YOU notification (owner-entered for Doctor). — B2.1 (lead entry) + B2.2 (`qualify_lead` workflow) + B2.3 (CIPC hard-block + advisory duplicate detection at entry, lead activity logging, and lead-lifecycle notifications with email) all ✅ DONE, applied + verified live. B2.3 smoke test passed (all 6 sections + both stop-ship PII gates) and test-data cleanup complete — the live DB now holds only real data: Mama Mabase JV (DEAL-001, funded), Fepa Sechaba (DEAL-002), NRL BAKWENA (DEAL-004).
- 🔨 B3. Document Management upgrade (Part 6 M1, core slice): full taxonomy enum, version control, expiry dates + expiry alerts, metadata fields. (OCR, external share links, e-signatures deferred to Phase E/F.) — **B3.1 ✅ DONE (schema PR #42 + hotfix #43, UI PR #44), applied + verified live, 9-point smoke test passed with the first real documents (Mama Mabase JV).** Remaining: none — expiry-alert automation (DOCUMENT_EXPIRING_* via pg_cron, PR #46) ✅ live; **B3.2 (per-document verification workflow + qualification gate + lead→client doc migration + LEAD_DOCUMENT_REJECTED) ✅ built.**
- ✅ B4. Client Story basic (Part 2): `client_stories` (1:1, create-on-first-save) + append-only `client_story_notes` (impressions, RLS-enforced append-only) + `call_logs` (+ `call_medium` enum, follow-up CHECK) + `call_log_followup_alerts` dedup ledger. Story tab + Call Log tab on client detail. `FOLLOW_UP_DUE` daily pg_cron sweep (04:15 UTC) → owner in-app + `weekly_summary` email. Owner-only RLS (personal/family narrative — POPIA). A10 activity logging on stories + call logs. — built (one PR); first real capture (Fepa Sechaba / Tumi) is the post-merge smoke test.
- ✅ B5. Data validation pass (Part 6 M6, core slice): SA ID Luhn check, CIPC format, cell format, duplicate detection on client/lead creation. — **B5.1 ✅ DONE (PR #53), applied + verified live**: canonical `src/lib/sa-validation.ts` (Luhn SA ID + DOB/citizenship, CIPC, cell, VAT, postal), consolidated the drifted lead/client validators, wired Luhn into the lead + contact forms, added CIPC validation to the client form. **B5.2 ✅ DONE (PR #61 + replay-fix #62), applied + verified live**: `find_client_duplicates` RPC + `clients_cipc_block` trigger + race-proof partial UNIQUE index + `qualify_lead` **Path A** (match an existing client by CIPC (authoritative) or name and re-point onto it, jsonb audit return, logs `QUALIFIED_ONTO_EXISTING_CLIENT` / `QUALIFIED_NEW_CLIENT`) + client-form dup UX.
- ✅ B6. Stakeholders — Directors, Shareholders, Beneficial Owners (Part 2): `client_stakeholders` (one row per person, `roles` array; SA ID **or** passport with ISO country; shareholding % + FICA beneficial-owner ≥25% auto-suggest), lead→client migration at qualify (documents pattern), owner-full / partner-PII-excluded RLS, activity logging. Full spec + owner-locked decisions in **SPEC S3a**. — **B6.1 (schema/RLS, PR #58) + B6.2 (UI, PR #59) + B6.3 (qualify_lead stakeholder re-pointer + legacy-contact signatory bridge, PR #60) all ✅ DONE, applied + verified live.**

_**Phase B is COMPLETE** (B1–B6 + the B4.1 Client-Story-on-lead refinement, PR #63 — see Deferred Polish). **Phase C opens next with C0** (per-funder commission structures — prerequisite for C1/C2). Interim: Phase B data-hygiene cleanup owed (test-leftover clients/deals/leads + Mama Mabase CIPC correction)._

## PHASE C — Money Operations (Part 5)
Goal: every rand invoiced, tracked, and paid — with the audit trail already live under it.
_Email design: every email here (invoices, statements, payment/overdue notices) extends one of the four canonical templates in **SPEC S16** — never designed from scratch._

- ⬜ **C0. Money Operations Foundations (opens Phase C — prerequisite for C1 and C2).** Per-funder commission structure tracking. Each funder in the CRM has its own commission rate that FNC earns from them per signed broker agreement. The commission engine today computes only the FNC-internal 40/60 split + tiered Doctor's share — it doesn't know what FNC earns from each specific funder. This module adds:
  - `funder_commission_structures` table: (funder_id, deal_type, rate_type, rate_value, effective_from, effective_to, notes, contract_clause_ref).
  - `rate_type` enum: `percent_of_gross_funded` · `percent_of_mdr` · `flat_rand_per_deal`. (`percent_of_mdr` applies where FNC's cut is a share of the funder's Merchant Discount Rate — typically merchant-cash-advance / card-settlement funders. The MDR is a **per-deal captured input**; where its value is sourced from and how it's snapshotted for the commission calc is a **C0 build-proposal decision**, not fixed in this docs pass.)
  - Owner-only `/settings/funders` sub-tab for maintaining rate structures per funder.
  - Historical rate lookup (which rate applied when a deal funded).
  - Wires into `deal_funder_submissions.amount_approved` / `amount_funded` (the S7A substrate) so commission on approval = rate applied to the approved amount, commission on funding = rate applied to the funded amount.

  **C0 must ship before C1 (invoicing) or C2 (commission auto-write)** — both depend on knowing what FNC earns per deal per funder. Owner intent: _"Each funder has its own rate structure per signed broker agreement. The CRM must know these rates to invoice correctly, compute honest commissions, and show accurate per-approval potential earnings on Doctor's Phase D portal."_ Full lifecycle spec in **SPEC S7A**.
- ⬜ C1. Invoicing FNC → funders: `invoices`/`line_items`/`payments` tables, auto-draft on Funded, approval flow, branded PDF (sequence continues from INV-0031), Resend delivery, overdue flags at 30/45/60 days
- ⬜ C2. Commission records wiring: deal funded → `commission_records` ledger row (the follow-up Claude Code flagged in PR #9)
- ⬜ C3. Doctor's earnings engine: `doctor_earnings` lifecycle (earned → ready_to_invoice → invoiced → paid)
- ⬜ C4. Doctor invoicing: BD-XXXX sequence, branded PDF, payment recording
- ⬜ C5. Monthly statements for Doctor (auto-generated PDF)
- ⬜ C6. Reports v1 (Part 5 R1+R2): Business Performance Overview + Funder League Table
- ⬜ C7. Owner Home v1 (Part 2): greeting, scripture/affirmation line, monthly targets, vision horizons (basic). Old dashboard becomes "Business Overview" in nav.

## PHASE D — Doctor's Portal Launch (Parts 1 + 3)
_Email design: portal + stage notifications extend a **SPEC S16** canonical template (fictional funder names on every partner-facing email)._
Goal: Doctor logs in and finds a living product. GATE: real deals + earnings data exist. DECISION REQUIRED before D5: Commission Estimator "Business View" transparency level (full ranged breakdown vs Doctor's-number-only). Logged in CLAUDE.md as OPEN DECISION.

- ⬜ D1. Partner-role routing + portal shell (his own layout, fictional funder names everywhere)
- ⬜ D2. Portal screens: dashboard, Submit Lead, My Deals, Deal Detail (timeline view, Part 3 F3), Earnings & Statements, Invoicing (ready-to-invoice queue), Profile, Help
- ⬜ D3. Deal Success Timeline visualisation (Part 3 F3) with stage notifications
- ⬜ D4. Client Estimator calculator (Part 3 F1) + Save Scenario
- ⬜ D5. Commission Estimator (Part 3 F2) — pending transparency decision
- ⬜ D6. WhatsApp notifications go live (Twilio approved by now; SMS fallback)
- ⬜ D7. Swap test partner account → Doctor's real account (masobota18@gmail.com), partner smoke test of anonymisation (zero real funder names anywhere)
- ⬜ D8. Follow-on deal workflow for repeat clients (`deals.parent_deal_id`, computed deal sequence, client 'Deal history' tab + repeat-client badge, partner-side 'Refer existing client for more funding' button, repeat-vs-resubmit duplicate-detection refinement). Partner T&C acceptance on first login (versioned). See **SPEC S11**.

## PHASE E — Automation & Intelligence (Parts 1, 5, 6, 7)
_Email design: welcome flow (E5) + nurture sequences (E9) extend a **SPEC S16** canonical template — no new templates from scratch._

**Note:** Part 7 (Lead Nurture & Partner Focus, SPEC S15) slots in here, after Doctor's portal ships in Phase D. It's deliberately not earlier — nurture automation needs real **leads** (B2), **notifications** (A11/A12/D6), the **partner portal** (D1–D2), and **invoicing** (C1) live underneath it first.

- ⬜ E1. Gmail integration (two-way, auto-attach to deals)
- ⬜ E2. Email template library + funder submission templates (Part 6 M3)
- ⬜ E3. Deal packaging & submission automation (Part 6 M3): validation checks, auto-bundled PDF, multi-funder submit. **Deal packaging automation — auto-generated FNC application PDF per funder submission** with client data, refined credit case, financial summary, document index, referral acknowledgment, and compliance clauses. Est. 2–3 PRs / 2–3 weeks. See **SPEC S6a**.
- ⬜ E4. Client Onboarding & Submission Automation (Part 6 M4): client onboarding workflow tracker (10 steps) + document request links, plus **funder form auto-fill + client e-signature** — take each funder's original PDF, auto-fill known CRM fields, mark client-fill/signature fields, send a time-limited signing link, capture the signed original, deliver to funder. AcroForm-first; never rebuilds the funder's form. Scope locked in SPEC **S17**. Sequenced after Phase C (deal volume) and Phase D (partner-triggered flows). **S17 scope now includes the consent pack (Broker Referral + Multi-Funder Credit) + T&Cs integration — regulatory-adjacent (NCR/FAIS/POPIA), requires legal review before first live use. Revised estimate: 3–4 weeks.**
- ⬜ E5. Automated welcome flow (website form → CRM → Resend)
- ⬜ E6. AI features (revised scope, Part 1 P3): email drafter, funder routing recommender, Best Fit AI Advisor for Doctor (Part 3 F4), **and the AI-assisted deal packaging suite — Claude Story Refiner (S17b) + FNC application auto-generation (S6a) + Document Intelligence (S18)** (AI-assisted cross-document verification: mismatches, financial red flags, quality/compliance/fraud signals, story-to-documents consistency; owner-only decision support, never auto-declines). Combined est: 4–6 weeks focused build. See **S17b + S6a + S18**. **Manual interim workflow (with data-handling caveats):** before E6 automation lands, manual AI analysis is possible but must **not** put client PII through a consumer/personal AI account — use an approved processor (business/commercial tier under a data-processing agreement), obtain client consent, minimise/redact documents, and delete after use. Consumer claude.ai privacy handling is **not** the same as the approved commercial/API path E6 will use. See S18 for the full controls.
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
- ⬜ F10. POPIA Audit Trail Compliance Pass (post-deployment compliance follow-up) — redact PII from before/after snapshots on activity_logs across leads + clients + client_contacts. Includes: assessment + redaction of existing rows that may already contain PII (A10 has been live), write-time redaction of sensitive columns going forward, right-to-erasure workflow documentation, and a POPIA data-handling SPEC section. Est. 1–2 focused PRs. Current before/after behaviour documented in SPEC S5.

## PART 7 (future, deliberately deferred)
Client-facing portal, client self-service applications, client dashboards.

## DEFERRED POLISH
Small quality-of-life items intentionally deferred until real production volume warrants them.
- ✅ **B4.1 — Client Story writable on lead detail (pre-qualification)** + export as structured markdown. **DONE (PR #63), applied + verified live + owner smoke test PASSED 2026-07-20.** See **SPEC S3**. Shipped: `client_stories`/notes XOR ownership (nullable client_id ⊕ lead_id), Story section on lead detail, curated 7-section markdown export (copy + download), `qualify_lead` re-points story + impressions to client with MERGE-APPEND on an existing-client story, owner-only `STORY_MIGRATED_LEAD_TO_CLIENT` event. Substrate for the E3/E6 AI-assisted deal packaging suite (S6a auto-generation + S17b story refiner + S18 document intelligence). Built build order: **B5 → B6 → B4.1 → C0 → C1 …**
- Test harness for pure-function utilities (date arithmetic, commission calc, format helpers). Consider standing up Vitest with focused scope for pure-function coverage — not full integration testing. Est. 1 PR when volume of pure utilities justifies it.
- Daily digest bundling of document expiry alerts. Currently each alert fires as its own email. When document volume exceeds ~5 expiry alerts per morning consistently, revisit with a per-user daily digest option. Est. 1 PR when justified by volume.
- Legacy document storage paths — the first real documents (Mama Mabase, pre-B3.2) were stored at the bare `{client_id}/...` path; B3.2 uploads use the entity-prefixed `{clients|leads}/{id}/{document_id}/{filename}` shape. Migrate legacy paths to the entity-prefixed shape at a natural moment (likely Phase E3 submission packaging). Not urgent — no functional issue, the path shape doesn't affect RLS-by-uploader (`storage.objects.owner`), and the download helper reads whatever `storage_path` holds. Est. small PR.
- Document physical storage-path migration on lead→client qualification. B3.2 re-points `client_id`/`lead_id` in the DB when a lead is qualified, but the physical files stay at their original `leads/{id}/...` storage path. Files remain functionally accessible (storage RLS is keyed on the uploader, not the path). Migrate the physical bytes via an Edge Function (Storage `move()`) when the stale path becomes visible operational friction. Est. 1 PR.
- Document delete flow hits the versioning-columns immutability check. When a document that has versioning references is deleted, the delete path attempts updates to `superseded_by` / `is_current_version` / `version_number` (part of unwinding the version chain), which the immutability trigger correctly refuses because it blocks updates to those columns. Fix: the delete path should bypass the versioning-columns immutability check when the operation is a DELETE, not an UPDATE. (On pickup, confirm exactly which trigger fires — S6 documents `documents_prevent_audit_rewrite` as guarding `uploaded_by`/`upload_source`; verify whether the versioning columns are guarded by the same or a separate trigger before writing the fix.) Est. small PR, when someone actually needs to delete a document that has version history / superseded references. Surfaced during B3 expiry-alert work.
- Owner-side dashboard to review dismissed duplicate warnings. Useful at scale — not urgent at current lead volume. Revisit when weekly warning count justifies. (B2.3 surfaces duplicate warnings at entry but doesn't log dismissals; this would capture and surface them.)
- Sole-trader business name PII flag — surface a confirmation dialog when qualifying a lead where entity_type = sole_prop, warning that business_name may be personal data. Not urgent, current lead volume is corporate. Revisit when first sole-trader lead is entered.
- Add an owner-only "archive deal" action for accidental duplicates / test data. Not urgent, deferred until real production volume warrants it. Alternative for now: continue owner-requested cleanups via SQL (small scale, controlled). Retention/audit semantics when built: archiving is a soft state (sets an `archived_at`/`archived_by` flag) that **preserves** the deal's `activity_logs` trail and child records (submissions, `deal_stage_history`, commission rows) rather than deleting them; archived deals are **excluded from pipeline KPIs and dashboards** but remain queryable owner-side; the action is **owner-only (RLS `is_owner()`)** and writes a `DELETE`/`UPDATE` `activity_logs` row — the same authorization and audit guarantees as the interim SQL cleanup, minus the irreversible row deletion.

## OPEN DECISIONS
1. Doctor's Commission Estimator "Business View": full ranged internal-split breakdown (Part 3 spec) vs Doctor's-own-number-only. Blocks D5. Owner to decide.
2. Password expiry policy (Part 6 suggests 90 days; modern guidance disfavours forced rotation — recommend long unique passwords + 2FA instead). Owner to decide at F2.

## STANDING RULES FOR EVERY BUILD
- One PR per logical change; CodeRabbit reviews BEFORE merge; owner merges.
- Schema PRs: migration applied to live DB immediately after merge, then owner smoke test.
- All money computed server-side. All new tables get RLS + activity logging from day one.
- Fictional funder names in every partner-facing surface. No exceptions.
