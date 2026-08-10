# Fund Now Capital — 40-Build Queue

**Queue date:** 2026-08-07  
**Status:** PLANNED — no application or database changes are authorised by this document  
**Purpose:** Convert the remaining canonical scope, production gaps, and smoke-test blockers into small, reviewable builds.

**Master continuation handoff:** `CLAUDE-CODE-FNC-MASTER-HANDOFF-2026-08-09.md` — continue the complete product backlog in waves of up to 15 independent builds/PRs, not 15 total builds.

> **Total builds: 57** (was 55 after the Role Agreements extension). Builds 56–57, added
> 2026-08-09, cover the Lead-Refer-specific commission engine extension and Doctor's
> read-only "My Network" view. The **"40-Build Queue" filename is historical** — the
> queue now spans Builds 1–57. No existing build has been renumbered. See the two
> extension sections at the end of this file (Builds 41–55 and Builds 56–57).

## Sources and precedence

This queue was reconciled against the current repository and these canonical documents:

1. `ROADMAP.md` — master build order
2. `SPEC.md` — functional and data contracts
3. `CLAUDE.md` — engineering, privacy, money, migration, and PR rules
4. `AUDIT.md` — current security and control gaps
5. `CONTRACTOR.md`, `ONBOARDING.md`, `TIERS.md`, `PICKER.md`, `TRAINING.md`
6. `docs/CODEX_BUILD_WAVE_2026-08-05.md` — previous 15-build ledger
7. Current source and migrations as inspected on 2026-08-07

If a queue item conflicts with a canonical rule, the canonical rule wins and the build pauses for reconciliation.

## Baseline — do not rebuild

The current code already contains partner and contractor portals, their pipelines and lead/deal views, owner tasks, global search, repeat-client workflow, deal archive, package readiness and dispatch, repayments, partner invoices, statements, public contractor applications, contractor progression, training-platform skeletons, terms administration, and data-quality surfaces. These are smoke-tested and repaired where necessary; they are not duplicated in this queue.

PR #152 supplied the package-dispatch readiness migration. The later partner/owner-assigned visibility repair (Build 17) has since been published, merged (PR #153) and applied live (migration `partner_owner_assigned_visibility`); it now awaits only its role smoke + cross-role leak test before being treated as complete.

## Delivery rules

- One logical build per PR; do not mix unrelated features.
- Start from current `main` after the preceding dependency is merged.
- Do not stack PRs unless the owner explicitly authorises stacking.
- Every schema PR includes RLS, grants, indexes, idempotency, activity logging, and a migration verification query.
- Every money mutation is server-side, lock-protected, idempotent, numeric-safe, and auditable.
- Partner and contractor surfaces never expose real funder names or another person's records.
- Greptile review and proposed fixes are addressed before merge.
- A build is complete only after checks pass, its migration is applied where applicable, and its smoke test passes.

## Live progress ledger

> **Wave 0 reconciliation — 2026-08-09.** Verified against live GitHub + the live
> database. Builds **2, 4, 7, 17** merged with migrations applied live
> (`pr154_shared_payee_payment_profiles`, `pr155_funder_invoice_dispatch_ledger`,
> `pr156_contractor_payable_cascade`, `partner_owner_assigned_visibility`). Builds
> **1, 16, 18** had remote branches but **no PR**; each was rebased onto `main`,
> re-verified (build + lint), opened as its own PR (#159, #158, #160) and **merged**
> — all three are UI-only (no migration). Review fixes landed before merge (#159
> row-cap pagination; #160 re-attach dedup + shared Modal); a follow-up PR **#162**
> closes two residual #160 review findings (dedup load/error race + name+size
> false-skip). **No build below is "Complete" per the legend** — merged is not the
> same as smoke-tested; every row still owes its role smoke + cross-role leak test.

| Build | Status | Branch / PR | Verification |
|---:|---|---|---|
| 1 | MERGED — SMOKE/LEAK TEST PENDING | `codex/partner-invoice-eligibility` · **PR #159 (merged)** | Lint ✅ · TypeScript ✅ · production bundle ✅ · Gitar approved (row-cap pagination finding resolved) · no migration · browser smoke pending |
| 2 | MERGED + MIGRATION APPLIED LIVE — SMOKE/LEAK TEST PENDING | `codex/shared-payee-payment-profile` · **PR #154 (merged)** | Migration `pr154_shared_payee_payment_profiles` applied live ✅ · schema/privacy review ✅ · role smoke + cross-role leak test pending |
| 4 | MERGED + MIGRATION APPLIED LIVE — SMOKE/LEAK TEST PENDING | `codex/funder-invoice-dispatch-ledger` · **PR #155 (merged)** | Migration `pr155_funder_invoice_dispatch_ledger` applied live ✅ · append-only ledger + owner queue/result RPCs + retry chain + redacted activity evidence ✅ · smoke pending |
| 7 | MERGED + MIGRATION APPLIED LIVE — SMOKE/LEAK TEST PENDING | `codex/contractor-payable-cascade` · **PR #156 (merged)** | Migration `pr156_contractor_payable_cascade` applied live ✅ · locked tier amount remains authoritative; same-deal invoice validation, advisory locks, void reconciliation ✅ · smoke pending |
| 16 | MERGED — SMOKE/LEAK TEST PENDING | `codex/sole-trader-pii-warning` · **PR #158 (merged)** | Lint ✅ · TypeScript ✅ · production bundle ✅ · Gitar approved + CodeRabbit "no actionable comments" · no migration · browser smoke pending |
| 17 | MERGED + MIGRATION APPLIED LIVE — SMOKE/LEAK TEST PENDING | `agent/partner-owner-assigned-visibility` · **PR #153 (merged)** | Migration `partner_owner_assigned_visibility` applied live ✅ · fixes the confirmed partner visibility gap without widening cross-partner access · cross-role leak test pending |
| 18 | MERGED — SMOKE/LEAK TEST PENDING | `codex/portal-lead-document-recovery` · **PR #160 (merged)** + follow-up **PR #162** | Lint ✅ · TypeScript ✅ · production bundle ✅ · no migration · re-attach dedup + shared Modal landed pre-merge; 2 residual review findings (dedup load/error race, name+size false-skip) addressed in #162 · browser smoke pending |

All builds not shown in this ledger remain **QUEUED**. Update this table after every material state change; never mark a build complete merely because a branch or PR exists — and never merely because it is merged or its migration is applied. "Complete" requires the smoke test and cross-role leak test in the legend.

## Wave 1 — Close the money loop and unblock smoke testing

| # | Proposed build | User-visible outcome | Canonical basis | Dependency / gate |
|---:|---|---|---|---|
| 1 | Partner invoice eligibility UX | The invoice screen defaults to the current payable period, explains why an earning is excluded, and finds current payable commission without date guesswork. | SPEC S7C; Roadmap Sprint 4 | Ready |
| 2 | Shared payee payment-profile schema | Secure banking, account-holder, tax number, VAT status, and verification fields for partners and contractors; sensitive values are not exposed in list views. | CONTRACTOR; ONBOARDING; SPEC money controls | Ready; migration |
| 3 | Payee profile and verification UI | Partner/contractor maintains allowed fields; owner verifies or rejects the payment profile with a reason and audit trail. | ONBOARDING mini HR; SPEC S11 | Build 2 |
| 4 | Funder-invoice dispatch ledger | Every send attempt records recipient, invoice version, channel, actor, status, timestamp, failure, and retry relationship. | Roadmap E1/E2; SPEC S16 | Ready; migration |
| 5 | Send funder invoice by email | Owner sends the issued invoice PDF to the selected funder billing contact from the CRM using the canonical email template. | Roadmap E1/E2; SPEC S16 | Build 4; verified sender/domain |
| 6 | Invoice dispatch history, retry, and receipt UI | Invoice detail shows sent/failed/delivered history and permits safe retry without creating a duplicate invoice. | SPEC activity/delivery model | Builds 4–5 |
| 7 | Contractor payable commission cascade | When FNC records the funder's payment, the correct contractor commission becomes payable using the locked tier and 5–7-day rule. | CONTRACTOR Feature 5; TIERS; Roadmap Sprint 3 | Ready; migration |
| 8 | Contractor invoice lifecycle | Contractor can draft and submit one invoice for eligible payable commissions; owner can approve/reject it without double claiming. | CONTRACTOR money coexistence; Sprint 3/4 parity | Builds 2 and 7; migration |
| 9 | Contractor invoice PDF and portal | Contractor downloads a branded invoice and sees draft/submitted/approved/paid states without FNC internal gross details. | CONTRACTOR portal/privacy rules | Build 8 |
| 10 | Owner contractor-invoice approval and EFT proof | Owner reviews, approves, records EFT/payment reference and proof, then settles the linked contractor commissions atomically. | CONTRACTOR owner dashboard; audit rules | Builds 3, 8, 9 |

## Wave 2 — Payment controls, security, and repeatable verification

| # | Proposed build | User-visible outcome | Canonical basis | Dependency / gate |
|---:|---|---|---|---|
| 11 | Unified payout reconciliation queue | Owner sees partner and contractor amounts that are payable, invoiced, overdue, rejected, or settled in one view. | Roadmap C3/Sprint 3–4; AUDIT money controls | Builds 7–10 |
| 12 | Payout due dates and overdue reminders | The system calculates payment due dates, warns the owner before the 5–7-business-day window closes, and notifies the payee. | CONTRACTOR payment rule; SPEC notifications | Build 11 |
| 13 | Append-only payout evidence | EFT proof, payment reference, payer, amount, and timestamp are immutable after settlement; corrections use reversal/replacement records. | CLAUDE money/audit rules; AUDIT | Builds 10–11 |
| 14 | Invoice rejection and resubmission trail | Partner/contractor sees the rejection reason and can submit a corrected revision while the original remains auditable. | Partner invoice lifecycle; activity rules | Builds 8 and 13 |
| 15 | End-to-end money smoke-test harness | Automated fixtures verify funded → funder invoice → FNC paid → partner/contractor payable → invoice → settlement, including retries and duplicate prevention. | CLAUDE verification rules; current smoke-test gap | Builds 1–14 |
| 16 | Sole-proprietor qualification privacy check | Before qualifying a sole proprietor, the owner is warned that the business name may contain personal information and must explicitly confirm it is appropriate to share with authorised parties. | SPEC deferred POPIA polish; CLAUDE privacy rules | Ready |
| 17 | Partner visibility for owner-assigned work | Leads and deals captured by the owner but assigned to a partner appear in that partner's own lead/pipeline surfaces without exposing another partner's records. | Confirmed live smoke-test gap; partner scope rules | Local repair already prepared; publish/apply/verify |
| 18 | Portal lead document recovery | If partner/contractor lead creation succeeds but one or more document uploads fail, the submitter can attach the missing files later from My Leads without creating a duplicate lead. Successful files are not retried, 10MB validation is retained, and existing attribution RLS remains authoritative. | Confirmed current-code partial-success gap; portal paperwork flow; existing lead-document RLS | Ready; no migration |
| 19 | Partner-view RLS conversion and leak tests | Replaces or formally hardens SECURITY DEFINER partner views and proves cross-partner isolation and fictional-funder-name rules. | AUDIT F5; CLAUDE privacy | Architecture decision before build |
| 20 | POPIA activity-log redaction | Existing and future audit snapshots redact sensitive client/contact fields while retaining operational evidence. | Roadmap F10; SPEC S5 | Data-retention review; 1–2 migrations if needed |

## Wave 3 — Client mandate, consent, paperwork, and funder submission

| # | Proposed build | User-visible outcome | Canonical basis | Dependency / gate |
|---:|---|---|---|---|
| 21 | Deal-level success-fee selection and snapshot | Owner selects the mandate success fee for a client deal; the chosen value/version is saved immutably for document generation. | Client mandate instructions; PICKER principles | Legal fee options confirmed |
| 22 | Mandate and consent document data model | Tracks template version, generated copy, sender, signatures, countersignature, validity, expiry, and retention dates for both required documents. | Smart Documentation Checklist; SPEC S17 | Legal templates approved; migration |
| 23 | FNC-branded Mandate Letter generator | Generates the legal-version mandate with logo, populated client/deal details, and selected success fee. | Client Mandate requirement; Roadmap E4/S17 | Builds 21–22; attorney-approved template |
| 24 | Authority and Consent Form generator | Generates the POPIA/multi-funder authority form with populated client and deal details. | Consent email flow; SPEC S17 consent pack | Build 22; legal review |
| 25 | Consent-pack email and return workflow | Owner sends both documents together, tracks the email, and gives the client a clear return/sign path. | Provided six-step email flow; Roadmap E4 | Builds 4–6 and 23–24 |
| 26 | Signature and countersignature status workflow | CRM tracks client signature on both documents and FNC countersignature on the mandate, including rejected/expired/replaced versions. | Provided email flow Steps 3–5; SPEC S17 | Build 25; signature method decision |
| 27 | Funder-submission legal gate | A deal cannot be dispatched to funders until current signed Mandate and Authority/Consent documents are present; owner overrides require typed reason and audit. | Smart Documentation Checklist; SPEC S17 | Build 26 |
| 28 | Seven-year secure retention and expiry alerts | Signed legal documents are held privately for seven years; mandate-duration expiry produces owner tasks and alerts without deleting records. | User requirement; POPIA/legal retention | Legal retention confirmation; Build 22 |
| 29 | Paperwork-driven task automation | Missing, sent, awaiting signature, countersign, expiry, and renewal states create/assign owner tasks with links to the exact client/deal/document. | Smart Documentation Checklist; Tasks scope | Builds 22 and 26–28 |
| 30 | Smart Documentation Checklist UI | Client/deal pages show both legal documents, required operating documents, signature/verification status, blockers, expiry, and the next action. | Smart Documentation Checklist; SPEC S6/S17 | Builds 22–29 |

## Wave 4 — Contractor/lead-referrer operations, automation, and reporting

| # | Proposed build | User-visible outcome | Canonical basis | Dependency / gate |
|---:|---|---|---|---|
| 31 | Contractor 17-document checklist | Each contractor has the canonical legal, identity, tax, financial, BEE, and contractor-specific requirements with missing/rejected/current status. | ONBOARDING 17 Required Forms | Build 2; migration |
| 32 | Contractor verification and activation gate | Only the owner verifies documents; activation requires the signed service agreement and all mandatory verified items, while training remains post-activation. | ONBOARDING Stages 4–6; CONTRACTOR | Build 31 |
| 33 | Contractor service-agreement lifecycle | Versioned agreement generation/upload, signature evidence, dates, renewal/replacement, and secure storage are visible in owner and contractor views. | CONTRACTOR Feature 2; ONBOARDING | Attorney-approved template; Builds 31–32 |
| 34 | Contractor mini-HR and status controls | Owner manages screening/interview notes, suspension, reinstatement, deactivation, reasons, and compliance status with complete audit history. | CONTRACTOR Feature 1; ONBOARDING mini HR | Builds 31–33 |
| 35 | Contractor reimbursement engine | Monthly petrol/airtime/data reimbursement uses the current level or owner-approved override and remains separate from commission. | CONTRACTOR Features 3–4; Roadmap Sprint 3 | Accountant confirmation; migration |
| 36 | Reimbursement approval, statement, and EFT flow | Contractor sees monthly reimbursement status; owner approves, pays, attaches evidence, and reports it independently of commission. | CONTRACTOR portal/owner dashboard | Builds 2, 13, 35 |
| 37 | Lead-referrer agreement and role onboarding | A lead referrer receives the independent-contractor agreement, accepts/signs it, completes required profile fields, and is activated with least-privilege access. | Lead Referrer Agreement + Build Phase docs | Attorney-approved agreement; migration if role differs from partner |
| 38 | Lead-referrer and partner training content wave | Publishes approved, versioned training for lead referrers and partners, including the updated funder counts and FNC contact details; completion is tracked. | Lead Referrer Training; Contractor Training; TRAINING | Owner-approved content; no invented funder data |
| 39 | Assessment, certification PDF, and QR verification | Question bank, pass rules, retake locks, certificate generation, and public verification are built on the existing training skeleton. | TRAINING assessment/certification; Roadmap Sprint 5 | Build 38; content and pass marks approved |
| 40 | Reports v2 money and operations pack | Owner reporting adds sector, conversion/velocity, cash-flow projection, payable ageing, contractor reimbursements, and scheduled report delivery. | Roadmap E7; SPEC R3–R5 | Waves 1–3 stable; metric definitions approved |

## Non-build actions — tracked but not counted in the 40

- Enable Supabase leaked-password protection (owner dashboard configuration; AUDIT F3).
- Set deliberate funder short codes for Business Partners and Better Banc (owner data entry; AUDIT F6).
- Complete the remaining funder appetite scores using verified owner information; do not invent scores.
- Obtain attorney approval for the Mandate Letter, Authority/Consent Form, contractor service agreement, and lead-referrer agreement.
- Confirm accountant/SARS treatment for VAT, contractor invoices, reimbursements, and withholding before production payment use.
- Confirm email sender domain and approved funder billing contacts.

## Tonight's safe execution order

The queue contains 40 builds, but they must not be merged as one batch. Begin with Builds **1, 2, 4, 7, 16, 17, and 18** as independent ready items. After their reviews and migrations are complete, continue through Builds **3, 5, 6, and 8–15**. Paperwork and legal builds **21–39** remain queued until their stated legal/content gates are satisfied. Build 40 comes after the money and paperwork data models are stable so its metrics do not have to be rewritten.

## Queue status legend

- **Ready:** scope exists and no external decision is presently identified.
- **Dependency:** build starts only after named earlier builds are merged/applied.
- **Gate:** owner, attorney, accountant, or architecture decision is required before implementation.
- **Complete:** PR merged, migration applied if applicable, and smoke test passed. A pushed branch or open PR is not complete.

## Queue extension — Role agreements and online signing (Builds 41–55)

Owner instruction dated 2026-08-09 expands Builds 33 and 37 into a shared, production-grade Partner, Contractor and Lead Referrer agreement system. The controlling specification is `FNC-ROLE-AGREEMENTS-AND-E-SIGNING-BUILD-RULES-2026-08-09.md`.

> **Build 37 absorption note (2026-08-09):** Build 37's legal/signing infrastructure is
> now effectively absorbed into Builds 41–55 — the shared invitation → agreement-pack →
> online-signature → countersignature → activation machinery supports the Lead Referrer
> as one of the three roles from day one. The **Lead-Refer-specific** work that is NOT
> covered by 41–55 is handled by the Builds 56–57 extension below: the commission-engine
> extension (Build 56) and Doctor's read-only "My Network" visibility (Build 57).

| # | Build | Status / dependency |
|---:|---|---|
| 41 | Legal template registry and versioning | Ready after current-main reconciliation |
| 42 | Role agreement-pack mapping | Build 41 |
| 43 | Owner role invitation case | Build 42 |
| 44 | Secure invitation delivery and verification | Build 43; verified sender |
| 45 | Invitee legal identity and capacity | Build 43 |
| 46 | Document review and e-sign consent UI | Builds 41–45 |
| 47 | Immutable signature evidence service | Build 46 |
| 48 | Executed PDF and signature certificate | Build 47 |
| 49 | Private agreement storage and RLS | Builds 47–48 |
| 50 | FNC countersignature workflow | Builds 47–49 |
| 51 | Server-enforced role activation gate | Builds 42–50 |
| 52 | Agreement expiry, renewal and re-signing | Builds 41–51 |
| 53 | Role portal `My Agreements` | Builds 49–52 |
| 54 | Owner agreement operations and audit | Builds 43–53 |
| 55 | Cross-role agreement smoke/security harness | Builds 41–54 |

These are fifteen independent builds, not one PR. Exact legal templates remain gated until the Owner publishes the approved execution versions. Claude may build dependency-cleared platform foundations but may not invent missing Partner/Contractor wording or alter legal/commercial terms.

## Queue extension — Lead Referrer commission engine and Doctor's My Network view (Builds 56–57)

Owner instruction dated 2026-08-09 adds the Lead-Refer-specific work that the shared
Builds 41–55 signing infrastructure does not cover. Both builds are governed by
`docs/lead-referrer-role.md` and `docs/FNC-CONSOLIDATION-DOC-2026-08-09.md` §2.3–2.5,
whose decisions are LOCKED — do not re-litigate them. One logical build per PR; do not
renumber any existing build.

| # | Build | User-visible outcome | Canonical basis | Dependency / gate |
|---:|---|---|---|---|
| 56 | Lead Refer commission engine extension | The commission engine reads `sourced_by_lead_refer_id` on deals, applies Path A (FNC-direct, no partner attribution) vs Path B (Bright Destiny, auto-attributes Doctor) correctly, calculates Lead Refer earning as tier % of Doctor's earning (L1=25 / L2=35 / L3=40 / L4=50) on both PO and non-PO deals, records the Lead Refer payment as sourced from Thapelo's personal residual (not FNC retention, not Doctor's earning), and enforces the constraint that Lead Refer earning must never exceed Doctor's. Includes progression tracking against closed-deal thresholds (L1=0–9, L2=10–24, L3=25–49, L4=50+). | `docs/lead-referrer-role.md` §Commission + §Tier ladder; `FNC-CONSOLIDATION-DOC-2026-08-09.md` §2.4; `TIERS.md` | Build 2 (payment profile), Build 7 (contractor cascade pattern), and `docs/lead-referrer-role.md` merged; migration |
| 57 | Doctor's My Network view (Path B Lead Refers) | Doctor's partner portal shows a READ-ONLY "My Network" surface listing Lead Refers attributed to his channel (`sourced_via_partner_id` = Doctor), their aggregate lead volume, pipeline-stage counts, and his pool growth attributable to their sourced deals. POPIA-safe: no client PII, no view of the Lead Refer's FNC contract / NDA / compensation schedule / earnings / payment profile / banking. Doctor cannot manage, discipline, deactivate, or reassign Lead Refers from this surface. | `docs/lead-referrer-role.md` §Doctor's "My Network" view; `FNC-CONSOLIDATION-DOC-2026-08-09.md` §2.5 | Build 56; RLS proof of same-role isolation |
