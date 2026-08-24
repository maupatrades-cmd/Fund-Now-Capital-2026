# FNC canonical outstanding-build register

**Repository baseline:** `1a1c543` · **audited:** 2026-08-24 · **production evidence cutoff:** 2026-08-15

> Live-state claims older than the cutoff must be reverified; repository presence is not proof of deployment.

This register answers what remains without treating a committed file, merged PR or old planning checkbox as proof of a working production feature. Machine-readable source: `docs/build-register.json`.

## Status summary

| Status | Count | Meaning |
|---|---:|---|
| built_repository | 0 | Implementation and automated source evidence are on main; live deployment and role smoke may still be required. |
| partial | 5 | Some implementation exists, but an identified user-visible or verification slice remains. |
| in_review | 2 | A PR exists outside main and must be reviewed, fixed and merged before deployment. |
| verification_required | 7 | Repository implementation exists, but the last production audit found drift or no current live proof exists. |
| gated | 2 | Implementation depends on an explicit business, legal, accounting or architecture ruling. |
| missing | 2 | No implementation evidence was found for the scoped outcome. |

## Coverage map

| ID | Area | Status | PR | Outcome | What remains |
|---|---|---|---:|---|---|
| ROLE-ONBOARDING | Team and access | verification_required | #258 | Owner invites partner, contractor, direct lead referrer or partner-linked sub-agent; invitee changes the temporary password. | Confirm the migration and both Edge Functions are live, then execute owner-to-each-role login and password-change smoke tests. |
| CALENDAR-BOOKING | Calendar | partial | #257 | Owner calendar, shared availability, booking decisions, client confirmation and task creation. | Run the committed manual smoke for standalone bookings, presentation-hour enforcement, owner acceptance, task linkage and client email delivery. |
| PARTNER-SUBAGENT-DIRECTORY | Partner operations | verification_required | #263 | Partner sees only its attributed sub-agents and operational roll-up; owner retains global oversight. | Apply through the single migration actor, then prove same-partner visibility and cross-partner denial with real role sessions. |
| LEAD-REFERRER-PIPELINE | Lead referrer operations | verification_required | #262 | Lead referrer has own leads and a role-safe operational pipeline. | Apply through the single migration actor and smoke direct and partner-linked lead-referrer sessions, including cross-user denial. |
| CLIENT-PORTAL-CORE | Client portal | partial | — | Client can access profile, application, progress, documents, messages, meetings and legal-readiness surfaces. | Run a real magic-link client session end to end; confirm live RPCs, private storage, messages, booking and mobile rendering. The committed test is source-level only. |
| CLIENT-OFFERS | Client portal | in_review | #260 | Owner publishes client-safe funding offers and client compares, accepts or declines with immutable evidence. | Resolve the main-branch conflict, complete bot review, merge, apply its migration through the single actor and run offer-decision smoke tests. |
| REPOSITORY-DRIFT-GUARD | Release safety | in_review | #261 | CI-friendly guard detects frontend RPC or Edge Function references with no committed server source. | Merge PR 261, then add its npm command to required CI checks. It does not replace live deployment verification. |
| CONTRACTOR-APPLICATION | Contractor portal | verification_required | — | Public contractor application submits and owner screens or rejects it. | The 2026-08-15 production audit found the RPCs and Edge Function absent live. Reverify; if still absent, deploy/apply reviewed artifacts and smoke /apply plus Team review controls. |
| CONTRACTOR-COMPLIANCE | Contractor portal | verification_required | — | Contractor progression and required-document checklist operate end to end. | The 2026-08-15 production audit found these objects absent live. Reverify, apply if required, and add role UI/browser smoke coverage for upload, owner verification and progression. |
| CLIENT-SECURE-DOCUMENTS | Client portal | verification_required | — | Client document workspace uploads and registers private documents safely. | The 2026-08-15 audit found both document RPCs absent live. Reverify, apply if needed, and run upload/download plus another-client denial tests. |
| LEGAL-TEMPLATE-CONTENT | Legal and e-sign | gated | — | Approved source PDFs become published versioned templates for client and role agreements. | Verify approved PDF hashes and source status, ingest exact approved content, publish template versions and confirm the chosen client-agreement projection. Do not invent legal wording. |
| AGREEMENT-EXECUTION | Legal and e-sign | partial | #246 | Invitee/client reviews, consents, signs, receives an executed PDF and appears ready in the relevant portal. | Complete approved-template ingestion, deploy/verify renderer and signing dependencies, then smoke dispatch, signature, countersignature, executed artifact, portal projection and cross-role denial. |
| PAPERWORK-TASK-AUTOMATION | Tasks and documents | partial | — | Funding-product/funder requirements create assigned, linked paperwork tasks and block incomplete submissions. | Audit product/funder rule coverage against canonical requirements, expose role-appropriate task actions, and smoke automatic creation, reassignment, completion and submission blocking. |
| R100-REWARD | Rewards | verification_required | — | R100 locks once for an eligible fully documented submission and follows cutoff/payment rules. | Verify live objects and test direct lead referrer, partner-linked sub-agent and contractor paths: incomplete, rejected, approved/submitted, duplicate, 22nd cutoff and 25th/30th payout cases. |
| LEAD-REFERRER-COMMISSION | Money | gated | — | Direct and partner-linked lead-referrer earnings use approved Path A/Path B bases without leaking private figures. | Record the final Path-A base ruling in canonical docs, reconcile any forward fix, then apply and run arithmetic, cap and privacy tests before exposing earnings. |
| MONEY-LIFECYCLE-SMOKE | Money | partial | — | Funded deal through funder invoice, receipt, payable, partner/contractor invoice and settlement is repeatably proven. | Run the harness in a controlled environment plus browser role smoke; prove retries, rejections, reversals, duplicate prevention, payment evidence and no private gross leakage. |
| SYSTEM-CROSS-ROLE-SMOKE | Release safety | missing | — | Repeatable owner, client, partner, contractor, direct lead-referrer and sub-agent journey with denial assertions. | Build a controlled E2E harness covering authentication, attribution, calendar, documents, legal gates, offers, rewards, money and cross-tenant isolation without production test pollution. |
| PHASE-EF-AUTOMATION-GOVERNANCE | Later roadmap | missing | — | Email sync, form autofill, nurture/AI assistance, POPIA rights, backup/restore and advanced analytics. | Split into independent builds only after operational drift and cross-role smoke blockers close. External integrations require provider and security decisions. |

## Recommended build and verification order

1. **CLIENT-OFFERS** — Resolve the main-branch conflict, complete bot review, merge, apply its migration through the single actor and run offer-decision smoke tests.
2. **REPOSITORY-DRIFT-GUARD** — Merge PR 261, then add its npm command to required CI checks. It does not replace live deployment verification.
3. **ROLE-ONBOARDING** — Confirm the migration and both Edge Functions are live, then execute owner-to-each-role login and password-change smoke tests.
4. **PARTNER-SUBAGENT-DIRECTORY** — Apply through the single migration actor, then prove same-partner visibility and cross-partner denial with real role sessions.
5. **LEAD-REFERRER-PIPELINE** — Apply through the single migration actor and smoke direct and partner-linked lead-referrer sessions, including cross-user denial.
6. **CALENDAR-BOOKING** — Run the committed manual smoke for standalone bookings, presentation-hour enforcement, owner acceptance, task linkage and client email delivery.
7. **CONTRACTOR-APPLICATION** — The 2026-08-15 production audit found the RPCs and Edge Function absent live. Reverify; if still absent, deploy/apply reviewed artifacts and smoke /apply plus Team review controls.
8. **CONTRACTOR-COMPLIANCE** — The 2026-08-15 production audit found these objects absent live. Reverify, apply if required, and add role UI/browser smoke coverage for upload, owner verification and progression.
9. **CLIENT-SECURE-DOCUMENTS** — The 2026-08-15 audit found both document RPCs absent live. Reverify, apply if needed, and run upload/download plus another-client denial tests.
10. **CLIENT-PORTAL-CORE** — Run a real magic-link client session end to end; confirm live RPCs, private storage, messages, booking and mobile rendering. The committed test is source-level only.
11. **LEGAL-TEMPLATE-CONTENT** — Verify approved PDF hashes and source status, ingest exact approved content, publish template versions and confirm the chosen client-agreement projection. Do not invent legal wording.
12. **AGREEMENT-EXECUTION** — Complete approved-template ingestion, deploy/verify renderer and signing dependencies, then smoke dispatch, signature, countersignature, executed artifact, portal projection and cross-role denial.
13. **PAPERWORK-TASK-AUTOMATION** — Audit product/funder rule coverage against canonical requirements, expose role-appropriate task actions, and smoke automatic creation, reassignment, completion and submission blocking.
14. **R100-REWARD** — Verify live objects and test direct lead referrer, partner-linked sub-agent and contractor paths: incomplete, rejected, approved/submitted, duplicate, 22nd cutoff and 25th/30th payout cases.
15. **LEAD-REFERRER-COMMISSION** — Record the final Path-A base ruling in canonical docs, reconcile any forward fix, then apply and run arithmetic, cap and privacy tests before exposing earnings.
16. **MONEY-LIFECYCLE-SMOKE** — Run the harness in a controlled environment plus browser role smoke; prove retries, rejections, reversals, duplicate prevention, payment evidence and no private gross leakage.
17. **SYSTEM-CROSS-ROLE-SMOKE** — Build a controlled E2E harness covering authentication, attribution, calendar, documents, legal gates, offers, rewards, money and cross-tenant isolation without production test pollution.
18. **PHASE-EF-AUTOMATION-GOVERNANCE** — Split into independent builds only after operational drift and cross-role smoke blockers close. External integrations require provider and security decisions.

## Evidence index

### ROLE-ONBOARDING

- Dependencies: none
- Repository evidence: `src/pages/TeamPage.tsx`, `src/pages/ChangePasswordPage.tsx`, `supabase/migrations/20260816202433_team_lead_referrer_onboarding.sql`, `supabase/functions/admin-invite-user/index.ts`, `supabase/functions/change-user-password/index.ts`, `tests/team-onboarding.test.mjs`

### CALENDAR-BOOKING

- Dependencies: ROLE-ONBOARDING
- Repository evidence: `src/pages/OwnerCalendarPage.tsx`, `src/components/calendar/SharedBookingCalendar.tsx`, `src/hooks/useOwnerCalendar.ts`, `tests/calendar-booking-rules.test.mjs`, `docs/ROLE-ONBOARDING-CALENDAR-MANUAL-SMOKE-2026-08-24.md`

### PARTNER-SUBAGENT-DIRECTORY

- Dependencies: ROLE-ONBOARDING
- Repository evidence: `src/pages/PartnerNetworkPage.tsx`, `src/hooks/usePartnerSubagentOperations.ts`, `supabase/migrations/20260824210000_partner_subagent_operations.sql`, `tests/partner-subagent-operations.test.mjs`

### LEAD-REFERRER-PIPELINE

- Dependencies: ROLE-ONBOARDING
- Repository evidence: `src/pages/lead-referrer/LeadReferrerLeadsPage.tsx`, `src/pages/lead-referrer/LeadReferrerPipelinePage.tsx`, `src/hooks/useLeadReferrerOperations.ts`, `supabase/migrations/20260824095543_lead_referrer_operational_pipeline.sql`, `tests/lead-referrer-operations.test.mjs`

### CLIENT-PORTAL-CORE

- Dependencies: none
- Repository evidence: `src/pages/client/ClientHomePage.tsx`, `src/pages/client/ClientApplicationPage.tsx`, `src/pages/client/ClientDocumentsPage.tsx`, `src/pages/client/ClientMessagesPage.tsx`, `tests/client-portal-smoke.test.mjs`, `docs/testing/CLIENT-PORTAL-SMOKE-HARNESS.md`

### CLIENT-OFFERS

- Dependencies: CLIENT-PORTAL-CORE
- Repository evidence: `src/pages/client/ClientOffersPage.tsx`

### REPOSITORY-DRIFT-GUARD

- Dependencies: none
- Repository evidence: none on main (PR evidence only)

### CONTRACTOR-APPLICATION

- Dependencies: REPOSITORY-DRIFT-GUARD
- Repository evidence: `src/pages/PublicApplyPage.tsx`, `src/hooks/useApplications.ts`, `supabase/functions/apply-submit-application/index.ts`, `supabase/migrations/20260803140200_contractor_application_rpcs.sql`

### CONTRACTOR-COMPLIANCE

- Dependencies: ROLE-ONBOARDING, REPOSITORY-DRIFT-GUARD
- Repository evidence: `src/hooks/useContractorProgression.ts`, `supabase/migrations/20260804130100_contractor_progression.sql`, `supabase/migrations/20260810230000_contractor_document_checklist.sql`

### CLIENT-SECURE-DOCUMENTS

- Dependencies: CLIENT-PORTAL-CORE, REPOSITORY-DRIFT-GUARD
- Repository evidence: `src/pages/client/ClientDocumentsPage.tsx`, `supabase/migrations/20260812193636_client_portal_secure_documents.sql`, `tests/client-portal-smoke.test.mjs`

### LEGAL-TEMPLATE-CONTENT

- Dependencies: REPOSITORY-DRIFT-GUARD
- Repository evidence: `src/pages/LegalStudioPage.tsx`, `src/hooks/useLegalStudio.ts`, `supabase/functions/ingest-legal-source-asset/index.ts`, `docs/legal/TEMPLATE-SYSTEM-RECONCILIATION-2026-08-14.md`

### AGREEMENT-EXECUTION

- Dependencies: LEGAL-TEMPLATE-CONTENT, ROLE-ONBOARDING
- Repository evidence: `src/pages/AgreementSigningPage.tsx`, `src/pages/AgreementDetailPage.tsx`, `src/hooks/useAgreementSigning.ts`, `supabase/functions/generate-legal-document-pdf/index.ts`

### PAPERWORK-TASK-AUTOMATION

- Dependencies: CLIENT-SECURE-DOCUMENTS
- Repository evidence: `supabase/migrations/20260812003740_document_requirement_tasks.sql`, `supabase/migrations/20260812003805_role_task_management.sql`, `src/hooks/useOwnerTasks.ts`

### R100-REWARD

- Dependencies: PAPERWORK-TASK-AUTOMATION, AGREEMENT-EXECUTION
- Repository evidence: `supabase/migrations/20260810075057_complete_document_r100_reward.sql`, `supabase/migrations/20260812004005_reward_legal_readiness.sql`

### LEAD-REFERRER-COMMISSION

- Dependencies: PARTNER-SUBAGENT-DIRECTORY, LEAD-REFERRER-PIPELINE
- Repository evidence: `supabase/migrations/20260810240000_lead_referrer_commission_engine.sql`, `docs/lead-referrer-role.md`, `docs/HANDOVER-LEGAL-LANE-2026-08-12b.md`

### MONEY-LIFECYCLE-SMOKE

- Dependencies: REPOSITORY-DRIFT-GUARD
- Repository evidence: `supabase/tests/money_lifecycle_smoke.sql`, `src/hooks/useInvoices.ts`, `src/hooks/usePartnerInvoices.ts`, `src/hooks/useContractorInvoices.ts`

### SYSTEM-CROSS-ROLE-SMOKE

- Dependencies: CLIENT-OFFERS, R100-REWARD, LEAD-REFERRER-COMMISSION, MONEY-LIFECYCLE-SMOKE
- Repository evidence: `docs/ROLE-ONBOARDING-CALENDAR-MANUAL-SMOKE-2026-08-24.md`, `docs/testing/CLIENT-PORTAL-SMOKE-HARNESS.md`

### PHASE-EF-AUTOMATION-GOVERNANCE

- Dependencies: SYSTEM-CROSS-ROLE-SMOKE
- Repository evidence: `ROADMAP.md`, `SPEC.md`

## Update rule

Edit `docs/build-register.json`, run `npm run build-register`, and commit both files. Never promote an item to production-complete using repository evidence alone: record current live object/deployment checks and the exact role smoke result first.

