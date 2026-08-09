# Fund Now Capital — Role Agreements and Online Signing Build Rules

**Owner instruction date:** 2026-08-09  
**Status:** Approved product workflow; exact legal template text remains version-controlled and must match the Owner/attorney-approved source.  
**Applies to:** Referral Partner/Doctor, Contractor, and Lead Referrer onboarding.

## 1. Mandatory Claude rule

When the Owner invites a Partner, Contractor, or Lead Referrer, the CRM must assign the correct approved agreement pack. The invitee must review and sign every required document online before the account can become active or perform role work. If FNC countersignature is required, activation remains blocked until it is complete. The fully executed document and signature evidence must be stored against that person's CRM record and be downloadable by authorised parties.

Claude may build document, invitation, signature, storage, gate, audit and renewal machinery. Claude must not invent or silently change legal clauses, commission rates, allowance amounts, restraint periods, notice periods, tax/VAT treatment, payment-source rules or renewal periods.

Only a template explicitly marked `published/approved` by an authorised Owner may be issued. Draft templates may be previewed but never sent for signature.

## 2. Source and approval control

- The supplied Lead Referrer Independent Contractor Agreement is the current source document. The Owner reports that counsel is satisfied and permits further tightening.
- Do not automatically remove an old “draft for attorney review” warning. The Owner must upload or publish the exact execution copy and its approval metadata.
- Contractor and Partner execution copies must likewise be Owner-published before live invitations can issue them.
- If approved wording is absent, build the workflow and registry but leave that role pack in `draft_blocked`. Do not manufacture missing contract text.
- Each published template records document type, role, legal entity, title, version, effective date, jurisdiction, status, approver, approval time, source filename, SHA-256 content hash and superseded version.

## 3. Required packs

### Partner / Doctor

1. Referral Partner or Introducer Agreement.
2. Confidentiality / NDA terms.
3. POPIA data-processing acknowledgement or Operator Agreement where factually required.
4. Published commission/commercial annexure assigned to that partner.
5. Platform acceptable-use and information-security acknowledgement.

Optional approved annexures may cover brand/trading name, sub-agents/channels, and funder-contact authority.

### Contractor

1. Independent Contractor / Services Agreement.
2. Confidentiality / NDA terms.
3. POPIA Operator and security acknowledgement where the contractor processes information for FNC.
4. Published commission, tier, allowance and reimbursement schedule assigned to that contractor.
5. Code of conduct, systems-use and information-security acknowledgement.
6. Canonical onboarding documents and verification.

Optional approved annexures may cover equipment, FNC email/account use, and travel/reimbursements.

### Lead Referrer

1. Lead Referrer Independent Contractor / Service Agreement.
2. Lead Referrer NDA and confidentiality terms.
3. POPIA Operator and security acknowledgement.
4. Published Lead Referrer commission schedule assigned to the individual.
5. Lead handover, no-authority, no-funder-contact and platform-use acknowledgement.
6. Mandatory training and assessment required by `docs/lead-referrer-role.md`.

Lead Referrers remain least-privilege. They submit structured leads and receive safe high-level status after handover. They may not handle client documents in the initial approved role scope, contact funders, quote terms, bind FNC, or see another user's economics.

## 4. Agreement hardening checklist

These are attorney review points, not permission for Claude to invent substantive wording:

1. Correct legal names, registration details, addresses, signatory authority and capacity.
2. Clear services, exclusions, handover point and absence of authority to bind FNC.
3. The real working arrangement must match the contractor label; a label alone is not proof of independent-contractor status.
4. Commission schedule precedence, calculation source, immutable snapshot, earned/payable events, approval, dispute window, tax/VAT responsibility, reversal and clawback triggers.
5. Clawbacks tied to defined events, evidence and notice; no arbitrary deletion of earned or settled records.
6. POPIA roles, authorised purpose, confidentiality, security safeguards, sub-operator controls, breach notification, return/deletion and audit cooperation.
7. Confidential information, permitted disclosures, legally compelled disclosure and survival.
8. Separate rights in work product from data-subject rights in personal information.
9. Restraint/non-solicitation stays within exact attorney-approved scope and is never broadened by defaults.
10. Suspension, remediation, termination, accrued rights, access removal and return of property/data.
11. Notices, domicilium, dispute process, governing law, severability, waiver, whole agreement and precedence.
12. Electronic execution, counterparts, consent, signature attribution and final-copy delivery.
13. Material amendments require a new published version and re-signature; historical copies remain immutable.

Legal reference points for counsel and implementation review: Electronic Communications and Transactions Act 25 of 2002; POPIA sections 19–22; Labour Relations Act section 200A and the factual employment-relationship tests.

## 5. Owner invitation flow

1. Owner opens Team or role administration.
2. Owner chooses `Invite Partner`, `Invite Contractor`, or `Invite Lead Referrer`.
3. Owner enters legal/full name, email, mobile, legal entity/trading name where applicable, role, introducing channel and start date.
4. System displays exact pack, versions, commercial schedule and gates.
5. Owner previews documents but cannot edit published legal text inside an invitation.
6. System sends a single-use, expiring secure link and stores only its cryptographic token hash.
7. Owner sees delivery, opened, identity-completed, signed, countersigned, expired, revoked and activated states.
8. Safe resend expires/revokes the old token or records an explicit retry; it never duplicates the person or obligation.

## 6. Invitee signing flow

1. Invitee verifies control of the invited email/mobile channel.
2. Invitee completes required identity/contact data and signing capacity.
3. Each document shows title, version and effective date and is downloadable before signature.
4. Required acknowledgements cover electronic signing consent, reading/understanding, identity/capacity accuracy and each schedule/annexure.
5. Signature evidence includes the configured typed/drawn signature, legal name, capacity, UTC timestamp plus displayed SAST, server-side hashed IP evidence, user-agent/device evidence, template version and document hash.
6. Never store raw IP evidence generated by the browser. Sensitive evidence is generated server-side and access-controlled.
7. Unpublished, superseded, changed or hash-mismatched documents cannot be signed.
8. Signed versions lock and route to FNC countersignature where required.
9. The signer receives/downloads the final executed PDF and signature certificate.

## 7. Countersignature and activation

- Only an authorised FNC signatory countersigns.
- Countersigning references rather than mutates the invitee's original signature/evidence.
- Activation is server-enforced and blocked until all applicable items pass: identity verification, current documents/annexures signed, countersignature, onboarding documents, training/assessment, active commercial schedule, and no suspension/revocation/expiry.
- The activation RPC is idempotent, auditable and concurrency-safe.

## 8. CRM storage and privacy

- Templates and executed instances are separate.
- Final PDFs use a private Supabase Storage bucket and non-guessable paths.
- Relational metadata includes checksum, size, MIME type, version, status and retention category.
- Never expose identity numbers, tax/bank details, raw tokens, raw IPs or agreement text in notifications, analytics, URLs or activity summaries.
- Authorised Owners see the full record; signers see/download only their own copies.
- Same-role users cannot access each other's agreements, schedules, signatures or evidence.
- Introducing Partners do not inherit access to a Lead Referrer's private FNC agreement or compensation schedule.
- RLS, Storage policies and server-side checks must prove same-role cross-user isolation.
- Signed records are append-only. Corrections use void/supersede/reissue relationships.
- Retention follows the published FNC category schedule and legal holds; do not hard-code seven years for every role document without approval.

## 9. Renewal and termination

- Support no-expiry, fixed-expiry, renewal-window and event-driven re-sign rules.
- Send configurable reminders to signer and Owner.
- Material amendments create a new published version and re-sign obligation.
- Distinguish `current`, `expiring`, `expired`, `superseded`, `revoked`, `terminated` and `legal_hold`.
- Apply approved expiry consequences server-side without deleting the account/history.
- Termination revokes authorised access/sessions, preserves evidence and settles outstanding rights through approved agreement and money-engine rules.

## 10. Minimum relational model

- `legal_document_templates`
- `legal_document_template_versions`
- `role_agreement_pack_versions`
- `role_agreement_pack_items`
- `onboarding_invitations`
- `person_agreement_requirements`
- `agreement_executions`
- `agreement_signatures`
- `agreement_evidence_events`
- `agreement_delivery_attempts`
- `agreement_status_events`
- private Storage objects for generated/executed PDFs

Do not use one mutable JSON record as source of truth. Required controls include document hashes, guarded transitions, signature order, idempotency, expiry/revocation, append-only evidence, least-privilege grants, RLS, indexes and auditable server-side mutations with no anonymous mutation path.

## 11. Fifteen independent Claude builds

Each item is one logical branch and PR. Reconcile current code first and mark duplicates/stale items rather than rebuilding.

| Build | Title | Outcome | Dependency |
|---:|---|---|---|
| 41 | Legal template registry/versioning | Owner uploads, reviews, publishes and supersedes hashed templates. | Architecture approved |
| 42 | Role agreement-pack mapping | Versioned Partner, Contractor and Lead Referrer packs. | 41 |
| 43 | Owner role invitation case | One tracked invitation with assigned pack. | 42 |
| 44 | Secure invitation delivery/verification | Single-use link, verification, revocation and safe resend. | 43, verified sender |
| 45 | Invitee legal identity/capacity | Controlled capture without PII leakage. | 43 |
| 46 | Review and e-sign consent UI | Per-document review, download and acknowledgements. | 41–45 |
| 47 | Immutable signature evidence | Server attribution, hashes, timestamps and append-only evidence. | 46 |
| 48 | Executed PDF/signature certificate | Branded final PDF and execution certificate. | 47 |
| 49 | Private agreement storage/RLS | Signer-own and authorised-Owner access with leak tests. | 47–48 |
| 50 | FNC countersignature | Authorised countersign, completion and final delivery. | 47–49 |
| 51 | Server role-activation gate | Access blocked until all applicable requirements pass. | 42–50 |
| 52 | Expiry, renewal and re-signing | Alerts, versions, renewals and approved access consequences. | 41–51 |
| 53 | Role portal `My Agreements` | Each role views/downloads only its copies. | 49–52 |
| 54 | Owner agreement operations/audit | Queue, resend, revoke, supersede, legal hold and evidence export. | 43–53 |
| 55 | Cross-role smoke/security harness | End-to-end flow plus RLS/tamper tests. | 41–54 |

Do not stack dependent PRs unless the Owner explicitly authorises it. Build only dependency-cleared work.

## 12. Minimum smoke test

For each role: Owner invites a synthetic user; confirm correct published pack; open invite; verify identity; download documents; prove missing acknowledgements block signature; sign; confirm hashes/evidence; prove activation remains blocked while countersignature or another gate is pending; Owner countersigns; complete remaining gates; activate; sign in as the role; download `My Agreements`; sign in as another same-role user and prove direct URL/API access fails; supersede the template and prove the historical copy is unchanged; issue re-signing and verify the approved access consequence; confirm no raw token/IP/identity/bank/agreement content leaks.

## 13. Definition of done

Approved template controls, correct packs, secure invitation, signer verification, immutable evidence, countersignature, private final PDF, server activation gate, renewal/supersession, cross-user isolation, reviewed/applied migrations, healthy deployment, exact-action smoke test and updated canonical ledger are all required.

## 14. Legal implementation note

This is a product/control specification, not a substitute for attorney advice. The CRM executes exact approved templates and preserves evidence. Substantive wording changes return a template to `draft/legal_review` until an authorised Owner publishes the approved execution copy.
