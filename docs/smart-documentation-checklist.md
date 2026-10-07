# Smart Documentation Checklist

Status: planned; specification locked on 2026-08-06. No production migration has been applied.

## Purpose

Generate a deal-specific paperwork checklist from reusable requirement layers. The checklist must reuse the existing `documents` repository, verification, versioning, expiry alerts, notifications, activity history, deal submissions and Tasks. It must not create a second client-document repository.

## Requirement layers

The final checklist is the union of:

1. Core FICA requirements.
2. Entity requirements: company, close corporation, trust, sole proprietor, partnership, school, church, NGO, government entity or SOE.
3. Funding-product requirements: working capital, purchase-order finance, invoice discounting/factoring, trade finance, asset finance, property finance, contract/cession finance, solar/renewable energy and bridge finance.
4. Sector requirements: mining, transport/logistics, construction and professional services.
5. Funder requirements.
6. Conditional rules, including deal-size thresholds, used assets, property ownership, government contracts and special-project flags.

Requirements must be normalized and reusable. Do not copy the complete FICA list into every funder/product/entity combination.

## Core FICA categories

- Company registration evidence: current CIPC records, founding statement for a CC, or trust deed for a trust.
- Proof of business address, normally not older than three months.
- Company letterhead.
- Current CSD report where applicable.
- SARS tax PIN and tax-compliance confirmation.
- Proof of bank account.
- Certified identity documents for directors, shareholders, members or trustees.
- Proof of personal address.
- Director identity-verification selfie where required.

The detailed deal, sector and special-entity lists are sourced from the Documentation Requirements Reference Guide supplied on 2026-08-06 and must be represented as owner-managed template items rather than hard-coded UI arrays.

## Quality and verification rules

- PDF is the default accepted client-facing format.
- Required pages must be present, legible and signed or certified where required.
- FICA evidence must be date-checked against its validity rule.
- A document may be rejected for age, illegibility, missing pages, missing certification, wrong entity, address mismatch, signature discrepancy or suspected alteration.
- Only a current, accepted and unexpired document may satisfy a submission requirement.
- Existing valid client documents should be auto-matched by document type and applicable period.
- Replacement uploads create new versions; signed or verified historical versions are never overwritten.

## Checklist lifecycle

1. Deal created or materially updated.
2. Owner selects one or more funders/submissions.
3. An idempotent reconciliation function evaluates the rule layers.
4. Duplicate requirements are consolidated while retaining the owner-only funder associations.
5. Existing verified documents are matched.
6. Missing paperwork generates assigned collection work.
7. Uploaded paperwork enters owner verification.
8. Rejection or expiry reopens the collection work.
9. When every required item is verified, the deal becomes ready for submission.
10. Submission freezes the applicable checklist/template-version snapshot.

## Paperwork-driven Tasks

| Event | Task | Default assignee |
|---|---|---|
| Checklist generated | Collect outstanding paperwork | Responsible contractor/partner; otherwise owner |
| Document uploaded | Verify document | Owner or approved operations verifier |
| Document rejected | Obtain replacement | Responsible contractor/partner |
| Document expires | Obtain renewal | Responsible contractor/partner |
| Missing after 3 days | Follow up | Current assignee |
| Missing after 7 days | Escalate | Current assignee plus owner notification |
| Checklist complete | Review submission package | Owner |
| Funder requests an additional item | Obtain additional paperwork | Responsible contractor/partner |

Automated tasks require an idempotency key so reminders or cron retries cannot create duplicates. The current `owner_tasks` table should be extended; it must not be replaced.

## Submission gate

Funder engagement and submission must be blocked in a database write-through RPC when:

- the client Mandate or Authority and Consent Form is incomplete;
- a required checklist item is missing;
- a linked document is rejected or expired; or
- the selected template version is no longer valid for the submission.

An owner override requires a reason, timestamp, actor and immutable activity entry. UI-only validation is insufficient.

## Visibility

- Owner: complete template, checklist, document, verification and real-funder visibility.
- Partner/doctor and contractor: only their attributable client/deal records and permitted document types.
- Lead Referrer: no client-document upload or access after handover.
- Real funder identity and funder economics remain owner-only. Safe aliases may be used on non-owner surfaces.

## Template population order

1. Centrafin Standard Company.
2. Centrafin School/Church.
3. Centrafin Solar Equipment.
4. Spartan Standard.
5. Genfin Standard after requirements are confirmed.
6. Merchant Capital/Lula Working Capital.
7. Sourcefin Invoice Discounting.
8. PrefCap Working Capital.
9. AAA Consortium PO Finance.
10. Remaining panel, sectors and special entities.

Draft or incomplete templates must not be activatable.

## Deferred

- Client self-service portal.
- OCR and AI document intelligence.
- Advanced analytics.
- Automatic document deletion. Retention deletion is prohibited until the approved legal retention schedule exists.
