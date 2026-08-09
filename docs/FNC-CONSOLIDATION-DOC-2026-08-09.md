# Fund Now Capital — Master Consolidation Document

**Consolidation date:** 2026-08-09
**Prepared for:** commit to the `Fund-Now-Capital-2026` repository as a canonical reference before Wave 0 recovery and Wave 1 build kick-off.
**Status:** Owner-signed consolidation of every locked business, legal, product, and engineering decision as of this date. Supersedes prior interpretations only where explicitly stated. Where this doc references another canonical MD, that MD remains authoritative for its scope.
**Owner:** Thapelo Maupa
**Legal entity:** Fund Now Capital (Pty) Ltd, CIPC 2026/066284/07

---

## Purpose of this document

This is a single reference that pulls together everything currently governing the Fund Now Capital CRM build so that any agent — Claude Code, codex, or any successor — begins with the same complete picture the owner has.

It does NOT replace the individual canonical MDs. It POINTS to them, records the owner-locked decisions that live between them, and closes the gaps where a decision exists in owner memory / chat history but not yet in the repository.

Precedence when reading this document:

1. Current explicit owner instruction (chat, ticket, verbal).
2. Attorney-approved and accountant-approved decisions (once published).
3. `ROADMAP.md`, `SPEC.md`, `CLAUDE.md` in the repo.
4. Role-specific canonicals: `TIERS.md`, `CONTRACTOR.md`, `ONBOARDING.md`, `PICKER.md`, `TRAINING.md`, and (once created) `docs/lead-referrer-role.md`.
5. `AUDIT.md` after current-code verification.
6. This consolidation document.
7. Build ledgers and older handoffs.

If any two sources conflict, the higher-numbered source loses. Never invent a compromise. Record the conflict and pause the affected build for owner decision.

---

## 1. Canonical documents currently in force

### 1.1 Repository canonicals (authoritative for their scope)

| Doc | Scope |
|---|---|
| `ROADMAP.md` | Master phase / build order |
| `SPEC.md` | Functional contracts, workflows, data rules, privacy rules, deferred decisions (S1–S17) |
| `CLAUDE.md` | Engineering, migration, money, security, PR rules for any AI agent |
| `AUDIT.md` | Current security / control findings (verify each against current code — some entries stale) |
| `TIERS.md` | Locked commission tier rules |
| `CONTRACTOR.md` | Contractor role, operations, payment, progression |
| `ONBOARDING.md` | Contractor onboarding, 17-document requirements |
| `PICKER.md` | Funder / rate / success-fee picker principles |
| `TRAINING.md` | Training, assessment, certificates, role-learning scope |

### 1.2 Coordination and queue documents (current)

| Doc | Purpose |
|---|---|
| `CLAUDE-CODE-FNC-MASTER-HANDOFF-2026-08-09.md` | Master execution handoff — waves of up to 15 independent builds, checkpoint rules, definition of done |
| `FNC-40-BUILD-QUEUE-2026-08-07.md` | Current numbered delivery queue (extended to 57: Builds 41–55 Role Agreements, plus Builds 56–57 Lead Refer commission engine + Doctor's My Network view) |
| `FNC-ROLE-AGREEMENTS-AND-E-SIGNING-BUILD-RULES-2026-08-09.md` | Rules for Partner / Contractor / Lead Referrer agreement infrastructure (Builds 41–55) |
| `FNC-15-PR-SMOKE-TEST.md` | Existing merged-wave regression coverage |
| `docs/CODEX_BUILD_WAVE_2026-08-05.md` | Prior 15-build ledger |

### 1.3 Documents referenced but NOT yet in the repository (must be created before dependent builds fire)

| Doc | Blocks builds | Content required |
|---|---|---|
| `docs/lead-referrer-role.md` | 37, 38, 42, 44, 51 | Consolidated Lead Refer role, dual-path model, locked commission, tier progression, activation gates. Draft in Section 4 of this document; extract to a repo-owned file once approved. |
| Owner-published Partner Referral Agreement execution copy | 42, 43, 46, 50 | Attorney-approved final wording, uploaded via Build 41 template registry |
| Owner-published Contractor Services Agreement execution copy | 33, 42, 43, 46, 50 | Attorney-approved final wording |
| Owner-published Lead Referrer Independent Contractor Agreement execution copy | 37, 42, 43, 46, 50 | Attorney satisfied 2026-08-09; owner tightening permitted; upload via Build 41 |
| Owner-published Mandate Letter template | 23, 25, 27 | Attorney-approved |
| Owner-published Authority and Consent Form template | 24, 25, 27 | Attorney-approved |

### 1.4 Owner-drafted legal starting-point documents

| Doc | Status |
|---|---|
| `lead-referrer-service-agreement.md` (drafted 2026-08-04) | Attorney satisfied per owner (2026-08-09), further tightening permitted; final execution copy pending owner publication |
| `lead-referrer-nda.md` (drafted 2026-08-04) | Same status as above |

---

## 2. Business, product, and legal decisions LOCKED (do not re-litigate)

Every item in this section is owner-decided and must not be re-flagged, re-argued, or re-litigated by any agent. When an agent's finding lands on any of these, the correct response is: acknowledge the item is locked, cite this document, move on.

### 2.1 Commission engine — the truth (per `TIERS.md`)

**Baseline (unchanged):**

- FNC gross X → 40% company retention → 60% partner pool
- Doctor's tier % of pool by FNC gross band: R0–80k = 29%; R80k–150k = 30%; R150k–500k = 33%; R500k+ = 25%
- Purchase Order (PO) deals: Doctor gets 40% flat of gross (not tiered)
- FNC Contractor: flat rand lookup by deal size (R300 through R105k across bands; R1M+ manual). No 40/60 split.
- Direct FNC (Thapelo sourced): Thapelo 100%
- Contractor progression: Base R7k → L1 R9.5k → L3 R14.5k monthly reimbursement per `CONTRACTOR.md`

**Locked commission rules — never recalculate:**

- The locked tier / rate / amount at the authoritative event remains historical truth. No client-side mutation may recalculate an already-locked commission.
- Corrections use append-only reversal / replacement records, never overwrite settled history.
- Partner / contractor / owner / FNC amounts must always reconcile to the same deal / invoice / payment chain.

### 2.2 The "50% split" partner-facing communication convention

- Doctor's portal / partner-facing UI displays commission framing as **"50% split"**.
- The backend uses the correct tiered math (29 / 30 / 33 / 25 / 40) per `TIERS.md`.
- This is **intentional partner communication** matching how Doctor understands the relationship. It is a locked owner call.
- This is **NOT a POPIA issue**, NOT a privacy leak, NOT a data-integrity failure.
- **DO NOT re-flag, DO NOT re-argue, DO NOT propose changing it.** Any agent that catches this pattern must accept it as locked and move on.

### 2.3 Lead Refer role — LOCKED (2026-08-09)

**Existence and purpose:**
A new first-class role in the CRM, distinct from Owner, Partner, and Contractor. Lead-sourcing agents whose duty is to submit qualified leads into the FNC pipeline. Least-privilege.

**Two entry paths (both sign to FNC directly):**

- **Path A — FNC-direct Lead Refer:** sourced by FNC / Thapelo directly, no partner attribution
- **Path B — Bright Destiny Lead Refer:** sourced via Doctor's Bright Destiny network, but the legal contract is still Lead Refer ↔ FNC

Both paths sign the same Lead Referrer Independent Contractor Agreement and NDA. Doctor is NOT a signatory to either path's contract.

**What Lead Refers can do:**

- Log into the FNC platform
- Submit structured leads (limited form)
- See their own leads and pipeline stage
- See their own statements and earnings
- Access training modules and gamification (badges, tier progression, leaderboard)
- Follow up in early qualification stage

**What Lead Refers CANNOT do:**

- Represent themselves as an FNC employee, officer, or agent
- Contact funders under any circumstances
- Communicate with clients directly after lead handover
- Negotiate commercial terms, quote fees, or make binding representations
- Access FNC email systems, banking, funder portals
- See another Lead Refer's records
- See FNC internal retention, gross figures, or funder identity where anonymised
- Handle client documents or funds

**Attribution model (data):**
Every Lead Refer profile records `sourced_via_partner_id`:

- `null` → Path A (FNC-direct)
- Doctor's `profiles.id` → Path B (Bright Destiny)

Every lead / deal submitted by a Lead Refer records:

- `sourced_by_lead_refer_id` → the Lead Refer's `profiles.id`
- `referral_partner_id` → auto-set from `sourced_via_partner_id` at lead-creation time (null for Path A; Doctor for Path B)

**Rule:** a Path B Lead Refer's leads always attribute to Doctor as `referral_partner_id`, regardless of who the underlying end-client is. This is by design — it avoids gaming (Lead Refers under-reporting their sourcing channel) and matches the operational reality that Doctor invested in bringing them into FNC.

### 2.4 Lead Refer commission — LOCKED

**Formula (both PO and non-PO deals):**
Lead Refer's earning = **X% of Doctor's earning on that deal**, where X depends on the Lead Refer's current tier.

**Money source:**
Lead Refer commission is paid from **Thapelo's personal residual on the deal**. It is NOT deducted from FNC's 40% retention. It is NOT deducted from Doctor's earning. It is Thapelo's personal underwriting of the Lead Refer program.

**Doctor's commission — UNTOUCHED:**
Doctor receives his full tier % (or 40% flat on PO) whether a Lead Refer is on the deal or not. There is no 4% deduction, no share reduction, no impact of any kind on Doctor's earning from the presence of a Lead Refer. Owner will communicate to Doctor verbally that Doctor "contributes" to the Lead Refer program — this is an owner-decided communication choice and is not to be re-flagged.

**FNC's retention — UNTOUCHED:**
FNC keeps its full 40% retention regardless of whether a Lead Refer is on the deal. The Lead Refer cost does not flow through FNC's P&L.

**Tier ladder — LOCKED (2026-08-09):**

| Tier | % of Doctor's earning | Closed-deal threshold |
|---|---|---|
| Level 1 | 25% | 0 – 9 closed |
| Level 2 | 35% | 10 – 24 closed |
| Level 3 | 40% | 25 – 49 closed |
| Level 4 | 50% | 50+ closed |

Level 1 is day-one entry. There is no separate Base tier below Level 1.

**Worked example — R14,000 gross non-PO deal, R0–80k band:**

- FNC retention (40%): R5,600 → untouched
- Doctor's earning (17.4% of gross): R2,436 → untouched
- Thapelo's residual before Lead Refer: R5,964

Lead Refer take from Thapelo's residual:

- L1: R2,436 × 25% = R609 → Thapelo net R5,355
- L2: R2,436 × 35% = R853 → Thapelo net R5,111
- L3: R2,436 × 40% = R974 → Thapelo net R4,990
- L4: R2,436 × 50% = R1,218 → Thapelo net R4,746

**Worked example — R3,750 gross PO deal (Doctor flat 40%):**

- FNC retention (40%): R1,500 → untouched
- Doctor's earning (40% flat of gross): R1,500 → untouched
- Thapelo's residual before Lead Refer: R750

Lead Refer take from Thapelo's residual:

- L1: R1,500 × 25% = R375 → Thapelo net R375
- L2: R1,500 × 35% = R525 → Thapelo net R225
- L3: R1,500 × 40% = R600 → Thapelo net R150
- L4: R1,500 × 50% = R750 → Thapelo net R0

**Notes on the PO worked example:**

- At Level 4, Thapelo's PO residual is fully consumed by the Lead Refer payment. This is by owner design.
- The Lead Refer's take never exceeds Doctor's take on any deal (Level 4 maxes at 50% of Doctor). This preserves Doctor's status as the primary earner in the chain.

**Constraint (system-enforced):** Lead Refer's earning must never exceed Doctor's earning on the same deal. Given the tier ceiling at 50%, this constraint is inherently satisfied by the formula. Any future tier change must preserve this constraint.

### 2.5 Doctor's "My Network" view — LOCKED

Path B Lead Refers appear in Doctor's own portal under a "My Network" (or equivalent name) surface. Access is **READ-ONLY**.

**Doctor sees:**

- Which Lead Refers are attributed to his channel
- Their aggregate lead volume (counts, pipeline stages) — POPIA-safe, no client PII
- His pool growth attributable to their sourced deals

**Doctor does NOT see:**

- The Lead Refer's private FNC contract, NDA, or signature evidence
- The Lead Refer's compensation schedule or earnings
- The Lead Refer's payment profile, banking details, tax details
- Any Lead Refer's client-facing PII
- Any other partner's Lead Refers

Doctor cannot manage, discipline, deactivate, or reassign a Lead Refer. Only the Owner can perform mini-HR actions on Lead Refers.

### 2.6 Funder display-name convention

- Doctor's portal / partner-facing UI displays fictional funder names (e.g. Rachel = Merchant Capital, Marcus = other) rather than real funder identities.
- Backend records the real funder identity. Real names appear only on owner-facing surfaces and outbound funder-facing surfaces.
- This is a locked partner-facing convention. Do not re-flag as a privacy issue.

### 2.7 Cache and role isolation

- Cache keys must include the authenticated user ID.
- Same-role users cannot access each other's records via RLS or via cached state.
- Partner and contractor RLS must prove same-role cross-user isolation, not merely role isolation.
- POPIA activity-log redaction is required for sensitive client / contact fields.

### 2.8 Money-mutation rules

- Every money mutation is server-side, lock-protected, idempotent, numeric-safe, and auditable.
- No client-side mutation may be the only enforcement for invoicing, payment, settlement, payout evidence, or duplicate prevention.
- EFT proof, payment reference, payer, amount, and timestamp are immutable after settlement. Corrections use reversal / replacement records.
- Contractor payable rule: 5–7 business days from FNC receipt of funder payment.

---

## 3. Legal work — status and gates

### 3.1 Attorney-approved status (as of 2026-08-09)

| Document | Status | Blocking builds |
|---|---|---|
| Lead Referrer Independent Contractor Agreement | Attorney satisfied per owner; owner-tightening permitted; execution copy publication pending | 37, 42, 43, 46, 50 |
| Lead Referrer NDA | Same as above | 42, 46, 50 |
| Partner (Doctor) Referral Agreement | Existing `Referral_Agreement.docx` referenced; attorney review status per owner | 42, 43, 46, 50 |
| Contractor Services Agreement | Attorney-approved template pending owner publication | 33, 42, 43, 46, 50 |
| Client Mandate Letter | Attorney-approved template pending owner publication | 21, 22, 23, 25, 27 |
| Authority and Consent Form (POPIA / multi-funder) | Attorney-approved template pending owner publication | 22, 24, 25, 27 |

### 3.2 The mandatory build rule (from Role Agreements Rules Section 1)

Claude Code may build document, invitation, signature, storage, gate, audit, and renewal machinery. Claude Code MUST NOT invent or silently change legal clauses, commission rates, allowance amounts, restraint periods, notice periods, tax / VAT treatment, payment-source rules, or renewal periods.

Only templates explicitly marked `published/approved` by the owner may be issued in live invitations. Draft templates may be previewed but never sent for signature.

If approved wording is absent for a role's pack, that pack sits in `draft_blocked`. Do not manufacture legal wording to unblock the build.

### 3.3 Accountant / SARS gates (pending)

- VAT treatment for contractor, Lead Refer, and Partner commissions
- Contractor invoice VAT handling
- Reimbursement (petrol / airtime / data) tax treatment
- Withholding rules for commission payouts
- Independent-contractor classification reality-test alignment (CCMA / SARS)

No production payment path may go live before accountant sign-off on the applicable rule.

### 3.4 Owner non-build actions (tracked)

- Enable Supabase leaked-password protection (AUDIT F3)
- Set deliberate funder short codes for Business Partners and Better Banc (AUDIT F6)
- Complete remaining funder appetite scores using verified owner information — no invented scores
- Confirm email sender domain and approved funder billing contacts

---

## 4. `docs/lead-referrer-role.md` — draft content

The following block is the intended content for `docs/lead-referrer-role.md`. It is extracted from this consolidation document. Committing it to the repo as its own file will unblock Builds 37, 38, 42, 44, and 51.

```markdown
# Lead Referrer Role — Fund Now Capital

**Status:** Owner-locked as of 2026-08-09. Any change requires new owner instruction and a version bump.

## Purpose

Lead-sourcing agents whose duty is to submit qualified leads into the FNC pipeline. Least-privilege independent contractors to FNC.

## Two entry paths

- **Path A — FNC-direct Lead Refer:** sourced by FNC / Thapelo directly, no partner attribution.
- **Path B — Bright Destiny Lead Refer:** sourced via Doctor's Bright Destiny network. The legal contract is Lead Refer ↔ FNC in both paths; Doctor is NOT a signatory to either.

## Attribution

- `profiles.sourced_via_partner_id`: null (Path A) or Doctor's profile id (Path B). Captured at invitation time from the "introducing channel" field.
- `leads.sourced_by_lead_refer_id`: the Lead Refer's profile id.
- `leads.referral_partner_id`: auto-set from `sourced_via_partner_id` at lead-creation time.
- Rule: a Path B Lead Refer's leads always attribute to Doctor, regardless of underlying end-client.

## Scope

Lead Refers CAN:

- Log in to the FNC platform
- Submit structured leads
- See their own leads and pipeline stages
- See their own statements and earnings
- Access training modules and gamification
- Follow up in early qualification

Lead Refers CANNOT:

- Represent themselves as an FNC employee, officer, or agent
- Contact funders
- Communicate with clients after lead handover
- Negotiate commercial terms, quote fees, or make binding representations
- Access FNC email, banking, or funder portals
- See another Lead Refer's records
- See FNC internal retention, gross figures, or funder identity where anonymised
- Handle client documents or funds

## Commission

Formula (both PO and non-PO): Lead Refer earns X% of Doctor's earning on that deal.

Money source: Thapelo's personal residual on the deal. NOT from FNC's retention. NOT from Doctor's earning.

Doctor's earning: UNTOUCHED regardless of Lead Refer presence.

FNC's retention: UNTOUCHED regardless of Lead Refer presence.

## Tier ladder

| Tier | % of Doctor's earning | Closed-deal threshold |
|---|---|---|
| Level 1 | 25% | 0 – 9 closed |
| Level 2 | 35% | 10 – 24 closed |
| Level 3 | 40% | 25 – 49 closed |
| Level 4 | 50% | 50+ closed |

Level 1 is day-one entry.

Constraint: Lead Refer's earning must never exceed Doctor's on the same deal.

## Doctor's "My Network" view (Path B only)

READ-ONLY for Doctor. Aggregate view of his attributed Lead Refers, their lead volume, and his pool growth from their deals. Doctor does NOT see the Lead Refer's contract, NDA, compensation schedule, earnings, payment profile, banking, or client-facing PII. Doctor cannot manage, discipline, deactivate, or reassign Lead Refers.

## Legal pack (per `FNC-ROLE-AGREEMENTS-AND-E-SIGNING-BUILD-RULES-2026-08-09.md`)

1. Lead Referrer Independent Contractor / Service Agreement
2. Lead Referrer NDA and confidentiality terms
3. POPIA Operator and security acknowledgement
4. Published Lead Referrer commission schedule assigned to the individual (references this document's tier ladder)
5. Lead handover, no-authority, no-funder-contact and platform-use acknowledgement
6. Mandatory training and assessment (see `TRAINING.md`)

Owner publishes execution copies via Build 41 (Legal template registry). No live invitations issue until pack is published.

## Onboarding and activation

- Owner invites Lead Refer via Team administration.
- Path (A or B) chosen at invite time via "introducing channel".
- Invitee reviews and signs pack per Role Agreements Rules Sections 5–7.
- FNC countersigns where required (per Role Agreements Rules Section 7).
- Activation gated: signed pack + verified identity + published commercial schedule + mandatory training complete.
- Server-enforced RPC gate (Build 51).

## Termination and expiry

Per `FNC-ROLE-AGREEMENTS-AND-E-SIGNING-BUILD-RULES-2026-08-09.md` Section 9. Termination revokes access and preserves evidence. Historical records remain immutable.
```

---

## 5. Current build state — verified as of 2026-08-09

### 5.1 Wave 0 — pending completion (7 branches pushed, none merged)

Per `FNC-40-BUILD-QUEUE-2026-08-07.md` live progress ledger:

| Build | Branch | State |
|---|---|---|
| 1 | `codex/partner-invoice-eligibility` | Draft PR + browser smoke pending |
| 2 | `codex/shared-payee-payment-profile` | Draft PR + migration apply pending |
| 4 | `codex/funder-invoice-dispatch-ledger` | Draft PR + migration apply pending |
| 7 | `codex/contractor-payable-cascade` | Draft PR + migration apply pending |
| 16 | `codex/sole-trader-pii-warning` | Draft PR + browser smoke pending |
| 17 | `agent/partner-owner-assigned-visibility` | Draft PR + migration apply pending |
| 18 | `codex/portal-lead-document-recovery` | Draft PR + browser smoke pending |

### 5.2 Wave 0 completion checklist

For each of the 7 branches:

1. Confirm draft PR exists (create if missing)
2. Confirm PR targets current `main` and contains exactly one logical build
3. Wait for and address Greptile / Macroscope / reviewer findings
4. Owner approves, merges
5. Apply migration (Builds 2, 4, 7, 17) in chronological order after merge
6. Run migration verification assertions
7. Deploy verified
8. Browser smoke test per role
9. Update ledger

### 5.3 Build sequencing after Wave 0

Wave 1: Builds 3, 5, 6, 8–15 (money loop closure) — dependencies met once Wave 0 completes.

Waves 2+: Waves 21–30 (paperwork) gated on attorney templates. Builds 31–40 (contractor / lead-refer operations, reporting). Builds 41–55 (Role Agreements + e-signing infrastructure) — gated where published templates required.

Build 37 is now effectively absorbed into Builds 41–55. Its Lead-Refer-specific work (role, sourcing attribution, commission engine extension, Doctor's My Network view) needs explicit slot(s) within or alongside the 41–55 wave. Recommended slotting:

- 41–50: build the shared agreement / signing infrastructure with Lead Refer as one of three roles supported from day one
- Add a Lead-Refer-specific commission engine extension build (either extend Build 7 or open a new build, e.g. Build 56) covering `sourced_by_lead_refer_id` on deals + engine handling Path A / Path B + tier calculation
- Add Doctor's My Network view as an owner-side build (either extend an existing partner surface or open a new build, e.g. Build 57)

---

## 6. Handover and continuity

### 6.1 Standing rule for any coordinating Claude Code / codex / successor agent

Read the canonical documents in the precedence order stated in this document's opening.

Reconcile current `main`, migrations, GitHub PRs, deployment, and live schema before writing code.

Work in controlled waves of up to 15 independent builds per wave per the master handoff.

Do NOT re-litigate any decision in Section 2 of this document.

Do NOT invent legal, money, funder, or commercial decisions. Pause and mark GATED if approval is required.

At every wave boundary: stop for Greptile fixes, conflict resolution, merges, migration application, deployment, and cross-role smoke tests.

### 6.2 Definition of done for any build

A build is complete ONLY when all applicable items are true:

- Canonical requirement and verified gap documented
- Independent branch and PR exist
- Diff contains only intended scope
- Lint, TypeScript / build, tests pass
- Security / privacy review passes
- Reviewer findings resolved
- PR merged
- Migration applied in order (if applicable)
- Live assertions pass
- Deployment healthy
- Manual role-specific smoke test passes
- Cross-role leak test passes
- Ledger and canonical status markers updated

A local commit, pushed branch, open PR, merged PR, or applied migration alone is NOT completion.

### 6.3 If this document becomes stale

Any material change to a Section 2 lock, or the addition of a new lock, requires a new dated version of this document. The previous version remains historical truth. Reference by owner instruction date.

---

## 7. Immediate next actions (owner-set)

1. Commit this consolidation document to the repository at `/docs/FNC-CONSOLIDATION-DOC-2026-08-09.md`.
2. Extract Section 4's content into a standalone `/docs/lead-referrer-role.md` file in the same commit.
3. Reference this consolidation document from `ROADMAP.md`, `SPEC.md`, and `CLAUDE.md` so future agents load it first.
4. Owner uploads execution copies of published legal templates via the legal-template registry once Build 41 is live.
5. Fire Claude Code with the master handoff (`CLAUDE-CODE-FNC-MASTER-HANDOFF-2026-08-09.md`) to recover the 7 pending branches (Wave 0) and progress the queue.

---

*End of consolidation document. Version 1.0 — 2026-08-09.*
