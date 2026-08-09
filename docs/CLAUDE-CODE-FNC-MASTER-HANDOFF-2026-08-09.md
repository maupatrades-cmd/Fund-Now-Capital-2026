# Fund Now Capital — Claude Code Master Handoff

**Handoff date:** 2026-08-09  
**Repository:** `maupatrades-cmd/Fund-Now-Capital-2026`  
**Local project family:** `<local Codex workspace>`  
**Owner:** Thapelo Maupa / `maupatrades-cmd`  
**Purpose:** Continue the full Fund Now Capital CRM build safely, in waves of 15 independent builds, until the canonical scope and verified current-system gaps are exhausted.

---

## 1. Read this first — what “15 builds” means

This is **not a request for only 15 features in total**.

The product backlog may eventually contain 100, 200, or more valid builds. Work must be delivered in controlled waves:

- One Claude Code coordinating agent owns one wave.
- One wave contains **up to 15 independent builds**.
- One build means one logical feature or repair.
- Every build gets its **own branch, commit, PR, verification, and ledger entry**.
- Never put 15 unrelated features into one branch or one PR.
- Do not stack dependent PRs unless the owner explicitly authorises stacking.
- At the end of each 15-build wave, stop for review, Greptile findings, conflict repair, merges, migrations, deployment, and smoke testing.
- Only after that checkpoint may the next wave of up to 15 builds begin.
- Continue generating subsequent waves until all canonical scope, verified gaps, security work, role parity, paperwork, training, reporting, automation, and production-readiness work is complete.

The number “15” is a **concurrency and review boundary**, not the total product scope.

---

## 2. Mandatory source of truth and precedence

Before planning or editing code, read these files completely in the current repository:

1. `ROADMAP.md` — master phase/build order.
2. `SPEC.md` — functional contracts, workflows, data rules, privacy rules, and deferred decisions.
3. `CLAUDE.md` — engineering, migration, money, security, and PR rules.
4. `AUDIT.md` — security/control findings; verify each finding against current code because some entries are stale.
5. `CONTRACTOR.md` — contractor role, operations, payment and progression rules.
6. `ONBOARDING.md` — contractor onboarding and 17-document requirements.
7. `TIERS.md` — contractor tier and locked-commission rules.
8. `PICKER.md` — funder/rate/success-fee picker principles.
9. `TRAINING.md` — training, assessment, certificates and role-learning scope.
10. `docs/CODEX_BUILD_WAVE_2026-08-05.md` — prior build ledger if present.
11. `FNC-40-BUILD-QUEUE-2026-08-07.md` — current numbered delivery queue and dependencies.
12. `FNC-15-PR-SMOKE-TEST.md` — existing merged-wave regression coverage.
13. The current `main` source, migrations, open PRs, merged PRs, deployment state, and live schema.
14. `FNC-ROLE-AGREEMENTS-AND-E-SIGNING-BUILD-RULES-2026-08-09.md` — mandatory Partner, Contractor and Lead Referrer invitation, agreement-pack, online-signing, countersignature, CRM-copy and activation rules.

Precedence:

1. Current explicit owner instruction.
2. Attorney/accountant-approved legal or money decisions.
3. `ROADMAP.md`.
4. `SPEC.md`.
5. `CLAUDE.md`.
6. Role-specific canonical documents.
7. `AUDIT.md` after current-code verification.
8. Build ledgers and older handoffs.

If documents conflict, do not invent a compromise. Record the mismatch, cite the conflicting sections, and pause that build for an owner decision.

---

## 3. Critical operating rules

### Repository safety

- Start every independent build from the latest verified `main` after required dependencies are merged.
- Use a separate worktree or clean clone per build.
- Preserve existing user code and unrelated dirty changes.
- Never use `git reset --hard`, destructive checkout commands, or broad delete commands.
- Never silently replace current working functionality with a new interpretation.
- Inspect the diff before committing.
- Do not rebuild a feature that already exists merely because an older MD says it is pending.
- Every suspected gap must be checked against current UI, hooks, migrations, RLS, RPCs, Edge Functions and recent PR history.

### PR safety

- One logical build per PR.
- Default to a draft PR until checks and review are complete.
- Include real Markdown in every PR description: what changed, why, user impact, security/privacy impact, migration impact, verification, and smoke test.
- Subscribe Greptile/review automation where configured.
- Address proposed fixes on the same branch.
- Rebase or merge current `main` into the branch only after inspecting conflicts file-by-file.
- Never choose “ours” or “theirs” across an entire conflict without understanding both sides.
- Do not merge automatically unless the owner explicitly asks.

### Database and Supabase safety

- Never apply an unreviewed migration to production.
- A schema PR must include RLS, least-privilege grants, indexes, constraints, idempotency, audit behaviour and verification assertions.
- Use new forward-only migrations; never edit a migration already applied to production.
- Database money transitions must be server-side, transaction-safe, concurrency-safe, numeric-safe, idempotent and auditable.
- Sensitive partner/contractor banking and tax information must not appear in list views, logs, notifications, reports or another role’s cache.
- Partner and contractor RLS must prove same-role cross-user isolation, not merely role isolation.
- Before marking a schema build complete: merge PR, apply migration in order, run assertions, inspect live schema, deploy, then smoke-test the user flow.

### Privacy and role isolation

- Partners/Doctors never see another partner’s leads, deals, earnings or documents.
- Contractors never see another contractor’s records.
- External portals must not expose FNC internal retention, owner share, real funder identity where anonymisation is required, private client notes, ID numbers, banking data, or legal-document internals.
- Audit snapshots and notification payloads must redact personal and financial data.
- Cache keys must include the authenticated user ID where same-role users can sign in sequentially in one browser.

### Money rules

- Never recalculate an already locked commission unless the canonical workflow explicitly creates a reversal/replacement.
- The locked tier/rate/amount at the authoritative event remains historical truth.
- No client-side mutation may be the only enforcement for invoicing, payment, settlement, payout evidence or duplicate prevention.
- Corrections use append-only reversal/replacement evidence; do not overwrite settled history.
- Partner, contractor, owner and FNC amounts must reconcile to the same deal/invoice/payment chain.

### Legal and professional-content gates

Do not invent legal clauses, success-fee options, VAT treatment, withholding rules, retention periods, signatures, pass marks, funder appetite scores, billing contacts, sender domains or verified funder data.

Pause and label the build `GATED` when attorney, accountant, owner or architecture approval is required.

---

## 4. What the previous build wave added

The earlier PR wave reported work around PRs #133–#152. Do not rely on the numbers alone; verify the features on current `main` and the live schema.

The implemented/repaired baseline includes:

- Partner invoice PDF reliability.
- Owner Terms administration and versioning.
- Deal soft archive and restore controls.
- Owner follow-up tasks.
- Repayment schedules and instalment tracking.
- Global CRM search.
- Repeat-client workflow using the existing client.
- Owner command centre/dashboard attention surfaces.
- Data-quality worklist.
- Funding-package readiness.
- Printable funding cover sheet.
- Contractor pipeline.
- Partner/Doctor pipeline.
- Funding-package dispatch logging/readiness.
- Portal pipeline guidance.
- Deal funding recording before invoice generation.
- Smoke-test readiness/schema repair.
- Partner invoices, statements, earnings and role portals already existed in the baseline.
- Public contractor applications, contractor progression, training skeletons, terms handling and reporting foundations already existed.

Important regression reference: `FNC-15-PR-SMOKE-TEST.md`.

Do not create duplicate versions of these features. Repair them only when a current failure is reproduced or a canonical requirement is demonstrably absent.

---

## 5. New work already prepared by Codex

Seven independent branches were prepared, checked and pushed to GitHub. At the last verified point, the branches existed remotely but PR creation/authentication was still being resolved. Verify GitHub before creating anything so no duplicate PR is opened.

| Queue build | Branch | Commit | What it does | Current caution |
|---:|---|---|---|---|
| 1 | `codex/partner-invoice-eligibility` | `0f1ecd4` | Defaults partner invoicing to useful payable periods and explains exclusion/eligibility states. | Browser smoke pending; no migration. |
| 2 | `codex/shared-payee-payment-profile` | `6bab9cf` | Adds secure shared partner/contractor payment-profile schema with banking/tax/verification foundations. | Migration not applied. Review RLS/grants/assertions first. |
| 4 | `codex/funder-invoice-dispatch-ledger` | `4e0f3e9` | Adds append-only invoice send attempts, retry relationships, owner queue and server delivery-result handling. | Migration not applied. Review security-definer/RPC grants carefully. |
| 7 | `codex/contractor-payable-cascade` | `5e630c7` | Advances the existing locked contractor amount to payable after the matching FNC invoice/payment chain. | Migration not applied. Must never recalculate locked commission. |
| 16 | `codex/sole-trader-pii-warning` | `c9c1ebd` | Requires explicit owner privacy confirmation before qualifying a sole proprietor whose business name may expose personal data. | Browser smoke pending; no migration. |
| 17 | `agent/partner-owner-assigned-visibility` | `f3c10ec` | Makes owner-captured work assigned to a partner visible in that partner’s own lead/deal/pipeline scope. | Migration not applied; prove cross-partner isolation. |
| 18 | `codex/portal-lead-document-recovery` | `630013b` | Lets a partner/contractor attach missing documents after a partial-success lead submission without creating another lead. Successful files are not retried. | Lint, TypeScript and production bundle passed; browser smoke pending; no migration. |

Codex also created these local coordination files:

- `FNC-40-BUILD-QUEUE-2026-08-07.md` — canonical numbered queue and live ledger.
- `FNC-15-PR-SMOKE-TEST.md` — step-by-step regression test for the earlier wave.
- `publish-ready-fnc-builds.ps1` — guarded exact-branch/exact-commit publisher for the seven prepared branches.
- `create-fnc-draft-prs.ps1` — PR helper; verify authentication and remote PR state before using it.

Do not mark these seven builds complete merely because the branches are pushed. Completion requires:

1. PR exists.
2. Review/Greptile findings resolved.
3. Checks pass.
4. PR merged.
5. Migration applied where applicable.
6. Production deployment healthy.
7. Role-specific smoke test passes.
8. Ledger updated.

---

## 6. Immediate recovery/checkpoint before new dependent work

Claude Code must begin with this checkpoint:

1. Fetch GitHub and list PRs for all seven branch names.
2. Create only missing draft PRs; never duplicate an existing open/closed PR.
3. Confirm every PR targets current `main` and contains exactly one logical build.
4. Inspect conflicts and checks.
5. Read Greptile/reviewer feedback and apply justified fixes.
6. Merge only with owner approval.
7. Apply Builds 2, 4, 7 and 17 migrations only after their PRs merge, in chronological order.
8. Run migration assertions and a production schema preflight.
9. Smoke-test Builds 1, 2, 4, 7, 16, 17 and 18.
10. Update the ledger before beginning dependent Builds 3, 5, 6 and 8.

Do not build dependent features from an unmerged branch unless the owner explicitly authorises stacking.

---

## 7. The master wave engine — continue until the full scope is exhausted

At every wave boundary, perform a fresh source-to-canonical reconciliation.

### Step A — discover candidate builds

Search all canonical documents and current code for:

- `TODO`, `deferred`, `pending`, `not started`, `partial`, `future`, `gap`, `manual`, `workaround`, `missing`, `blocked`, `docs only`, `owner decision`, `legal review`, `accountant review`, `architecture decision`.
- Broken smoke-test paths and production errors.
- Existing UI with missing database enforcement.
- Existing schema with no safe UI or user feedback.
- Role parity gaps across Owner, Partner/Doctor, Contractor, Lead Referrer and Client.
- Missing lifecycle states, retries, reversals, expiry handling and audit evidence.
- Missing notification, task, activity, report, export, PDF, email and operational follow-up surfaces.
- RLS, grants, SECURITY DEFINER, storage-policy, cache-isolation and PII leaks.
- Unapplied migrations or source/schema drift.
- Duplicate or stale queue entries that are already implemented.

### Step B — classify every candidate

Every candidate must be labelled:

- `READY` — current code proves the gap and no external decision is needed.
- `DEPENDENCY` — wait for specified builds/PRs/migrations.
- `GATED` — legal, accounting, data, sender-domain, content or architecture approval required.
- `STALE` — older document says pending but current code already implements it.
- `DUPLICATE` — overlaps another build and must be merged into that scope or removed.
- `COMPLETE` — merged, migration applied if applicable, deployed and smoke-tested.

### Step C — select the next wave of 15

Choose up to 15 `READY` items with no unresolved dependencies. Preserve canonical order and prioritise:

1. Production/schema blockers.
2. Security, privacy and cross-user isolation.
3. Money truth and invoice/payment completion.
4. Paperwork/legal gates required before funder submission.
5. Owner, partner and contractor operational parity.
6. Lead-referrer onboarding/training.
7. Reporting, automation and polish.

If fewer than 15 items are safe, build fewer than 15. Never fill the wave with invented or gated work merely to reach 15.

### Step D — produce the wave ledger before coding

For each selected build record:

- Global build number.
- Wave number and slot (1–15).
- Title.
- User-visible outcome.
- Canonical citations.
- Verified current-code gap.
- Files/tables/RPCs likely affected.
- Dependency and gate status.
- Migration required: yes/no.
- Privacy/security considerations.
- Acceptance criteria.
- Automated checks.
- Manual smoke-test instructions.
- Branch name.
- PR number/status.

### Step E — deliver each build independently

For each build:

1. Update from verified `main`.
2. Create isolated worktree/branch.
3. Reconfirm the gap still exists.
4. Implement only that scope.
5. Add migrations/tests/assertions where required.
6. Run lint, TypeScript, unit/integration tests and production build as appropriate.
7. Run role-specific browser smoke test when environment permits.
8. Inspect the diff for unrelated changes and secrets.
9. Commit and push.
10. Create a draft PR.
11. Record results in the wave ledger.

### Step F — close the wave

After all possible wave branches are ready:

1. Resolve Greptile/reviewer fixes.
2. Repair merge conflicts individually.
3. Merge in dependency order.
4. Apply migrations in chronological order.
5. Verify live schema and grants.
6. Confirm Vercel deployment is healthy.
7. Run a full owner → partner → contractor cross-role smoke test.
8. Run money, paperwork, privacy and cache-isolation regression tests.
9. Update canonical MD status markers and the master ledger.
10. Generate the next wave of up to 15.

---

## 8. Current 40-build seed queue

The current seed queue is not the final product backlog. It supplies the first 40 reconciled builds:

### Money loop and payment operations

1. Partner invoice eligibility UX — prepared.
2. Shared payee payment-profile schema — prepared.
3. Payee profile and owner verification UI — depends on 2.
4. Funder-invoice dispatch ledger — prepared.
5. Send funder invoice by email — depends on 4 and verified sender/domain.
6. Dispatch history, retry and receipt UI — depends on 4–5.
7. Contractor payable commission cascade — prepared.
8. Contractor invoice lifecycle — depends on 2 and 7.
9. Contractor invoice PDF and portal — depends on 8.
10. Owner contractor-invoice approval and EFT proof — depends on 3, 8 and 9.
11. Unified partner/contractor payout reconciliation queue.
12. Payout due dates and overdue reminders.
13. Append-only payout evidence and reversal/replacement corrections.
14. Invoice rejection and resubmission trail.
15. End-to-end money smoke-test harness.

### Security and production correctness

16. Sole-proprietor privacy confirmation — prepared.
17. Partner visibility for owner-assigned work — prepared.
18. Portal lead document recovery — prepared.
19. Partner-view RLS hardening/conversion and leak tests — architecture decision required.
20. POPIA activity-log redaction — retention/data review required.

### Client mandate, consent and smart paperwork

21. Deal-level success-fee selection and immutable snapshot.
22. Mandate and Authority/Consent document data model.
23. FNC-branded Mandate Letter generator.
24. Authority and Consent Form generator.
25. Consent-pack email and return workflow.
26. Client signature and FNC countersignature lifecycle.
27. Funder-submission legal gate.
28. Seven-year secure retention and expiry alerts.
29. Paperwork-driven task automation.
30. Smart Documentation Checklist UI.

### Contractor and lead-referrer operations

31. Contractor 17-document checklist.
32. Contractor verification and activation gate.
33. Contractor service-agreement lifecycle.
34. Contractor mini-HR, suspension, reinstatement and deactivation.
35. Contractor reimbursement engine.
36. Reimbursement approval, statement and EFT flow.
37. Lead-referrer agreement and least-privilege onboarding.
38. Lead-referrer and partner training content wave.
39. Assessment, certification PDF and QR verification.
40. Reports v2 money and operations pack.

Use `FNC-40-BUILD-QUEUE-2026-08-07.md` for full outcomes, canonical basis and gates.

---

## 9. Candidate first 15-build continuation wave

This is a **candidate**, not automatic authorisation. Revalidate dependencies and gates before coding.

Once Builds 2, 4 and 7 are merged/applied and their smoke tests pass, the likely next wave is:

1. Build 3 — payee profile and verification UI.
2. Build 5 — funder invoice email sending.
3. Build 6 — dispatch history/retry/receipt UI.
4. Build 8 — contractor invoice lifecycle.
5. Build 9 — contractor invoice PDF and portal.
6. Build 10 — owner approval, EFT proof and settlement.
7. Build 11 — unified payout reconciliation queue.
8. Build 12 — payout due dates and reminders.
9. Build 13 — append-only payout evidence.
10. Build 14 — invoice rejection/resubmission revisions.
11. Build 15 — end-to-end money smoke-test harness.
12. Build 31 — contractor 17-document checklist.
13. Build 32 — contractor verification/activation gate.
14. A newly reconciled `READY` security/privacy gap from current source.
15. A newly reconciled `READY` operational smoke-test blocker from current source.

Do not automatically substitute Builds 19–30 or 33–40 into slots 14–15 when their stated gates are unresolved. If no safe replacements exist, close the wave with 13 builds.

---

## 10. Scope expansion beyond the first 40

After the seed queue, continue mining the canonical documents and current product for additional waves. Likely expansion families include, subject to verification:

- Complete client portal and client-facing signing/return experiences.
- Follow-on/repeat-deal parent-child lineage and audited acknowledgement.
- Funder billing-contact management and delivery receipts.
- Email template versioning, bounce handling, retry queues and communication history.
- Paperwork renewal and expiring-document campaigns.
- Document classification, verification assistance and safe re-upload flows.
- Full contractor/lead-referrer onboarding case management.
- Role training authoring, content approval, assessment banks, retake policy, certificates and verification.
- Partner/contractor/lead-referrer dashboards and role-specific task queues.
- Commission disputes, payout reversals, corrections and reconciliation exports.
- Reimbursement policy versions, monthly claims, limits, approvals and reports.
- Funder appetite governance and owner-verified scoring workflows.
- Reporting definitions, scheduled delivery, exports and auditability.
- Notification preferences, escalation paths, digests and delivery monitoring.
- Search, pagination, accessibility, mobile, empty/error states and performance.
- Backup, recovery, observability, incident response and data-retention tooling.
- RLS and cross-user automated test matrices for every protected table/view/RPC/storage path.
- Migration drift detection and production schema verification.
- Vercel/Supabase environment parity and deployment smoke automation.

These are discovery areas, not permission to invent requirements. Every actual build must cite canonical scope or a reproduced current-system gap.

---

## 11. Required smoke-test format

Manual smoke tests must be written as exact user actions, for example:

1. Sign in as Owner.
2. Click the global search box.
3. Type the labelled test client’s business name.
4. Open the client.
5. Open the relevant deal.
6. Perform the new action.
7. Refresh and verify persistence.
8. Sign out.
9. Sign in as the affected Partner or Contractor.
10. Confirm the permitted record is visible and unrelated records are absent.
11. Confirm restricted funder, commission, PII and owner-only information is absent.

Use clearly labelled synthetic test records. Never change real client financial, legal or identity data during smoke testing.

Every wave closes with regression checks for:

- Owner Dashboard.
- Leads and qualification.
- Pipeline and deal detail.
- Clients and documents.
- Funders and submissions.
- FNC invoices and PDF/email flow.
- Partner invoices and earnings.
- Contractor commissions, invoices and reimbursements.
- Tasks, notifications and activity.
- Statements and reports.
- Partner/Contractor role isolation.
- No `column ... does not exist`, `relation ... does not exist`, blank page, 401/403 loop or stale-cache leakage.

---

## 12. Definition of done for one build

A build is complete only when all applicable items are true:

- Canonical requirement and verified gap documented.
- Independent branch and PR exist.
- Diff contains only intended scope.
- Lint passes.
- TypeScript/build passes.
- Tests pass.
- Security/privacy review passes.
- Greptile/reviewer fixes resolved.
- Merge conflict status clean.
- PR merged.
- Migration applied in order if applicable.
- Live assertions pass.
- Deployment is healthy.
- Manual role-specific smoke test passes.
- Cross-role leak test passes.
- Ledger and relevant canonical status markers updated.

A local commit, pushed branch, open PR, merged PR, or applied migration alone is **not** completion.

---

## 13. Required status report after every Claude Code session

Return a compact ledger containing:

| Build | Branch | Commit | PR | Checks | Review | Conflict | Migration | Smoke | Status/blocker |
|---:|---|---|---|---|---|---|---|---|---|

Also state:

- Files changed.
- Migrations added and whether they were applied.
- Canonical documents updated.
- Greptile findings addressed or pending.
- Exact PowerShell command only when owner action is unavoidable.
- Next safe build in dependency order.
- Number of builds remaining in the current 15-build wave.
- Candidate count for later waves.

Never report a PR number, merge, migration application, deployment or smoke-test pass unless it was actually verified.

---

## 14. Copy/paste instruction for the Claude Code agent

Use the following as the execution prompt:

> You are the coordinating Claude Code implementation agent for Fund Now Capital. Read `CLAUDE-CODE-FNC-MASTER-HANDOFF-2026-08-09.md` completely, then read every canonical document listed in it. Reconcile the current `main`, migrations, GitHub PRs, deployment and live schema against the documents before writing code. Continue the entire product backlog in controlled waves of up to 15 independent builds per wave. Each build must have its own clean worktree/branch, commit, draft PR, verification and ledger entry. Do not stack dependent PRs, duplicate existing features, invent legal/money/funder decisions, apply unreviewed migrations, merge without approval, or overwrite unrelated code. First recover and review the seven already-pushed branches, then select only dependency-cleared `READY` work for the next wave. At every wave boundary stop for Greptile fixes, conflict resolution, merges, migration application, deployment and full cross-role smoke testing. Continue generating later 15-build waves until all canonical scope and verified gaps are exhausted, even if the final backlog is 100–200+ builds. Keep the master MD/ledger marked after every material state change.

---

## 15. Final instruction

Move quickly, but never trade correctness for build count. Fifteen is the maximum wave size, not a quota and not the total scope. The correct system is more important than the number of PRs.

---

## 16. Mandatory role agreements and online signing wave

Read `FNC-ROLE-AGREEMENTS-AND-E-SIGNING-BUILD-RULES-2026-08-09.md` completely and add its Builds 41–55 to the reconciled global queue.

Every Partner/Doctor, Contractor and Lead Referrer invitation must receive the correct Owner-published agreement pack. The invitee signs required documents online, FNC countersigns where required, and the CRM retains an immutable hashed executed PDF plus signature evidence against the correct person. Role activation is blocked server-side until all applicable agreements, onboarding documents, training and commercial schedules are complete.

Claude may build the workflow and evidence controls but must not invent, silently tighten or alter legal/commercial wording. If the exact Partner or Contractor execution template is unavailable, leave issuance `GATED` while still building dependency-cleared registry/workflow foundations. A material legal change creates a new template version and re-sign obligation; historical executed copies remain append-only.

Use one independent branch and PR per Build 41–55. Do not stack dependent builds without explicit Owner approval.

### Additional copy/paste instruction for Claude Code

> Read `FNC-ROLE-AGREEMENTS-AND-E-SIGNING-BUILD-RULES-2026-08-09.md` in full. Reconcile it against current main, migrations and existing terms/onboarding code, then add Builds 41–55 to the global ledger. Build the Partner, Contractor and Lead Referrer invitation-to-online-signature flow in dependency order. Published template controls, correct role packs, secure signer verification, immutable signature evidence, FNC countersignature, private CRM PDF copies, same-role RLS isolation, renewal/re-signing and server-enforced activation gates are mandatory. Do not issue drafts or invent legal, commission, allowance, tax, restraint or payment terms. Missing approved execution copies remain GATED until the Owner publishes their exact versions.
