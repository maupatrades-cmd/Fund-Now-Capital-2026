# Product Decisions - 2026-08-06

This index records the features and rules added during the 2026-08-06 planning session.

## Added specifications

- [Smart Documentation Checklist](smart-documentation-checklist.md)
- [Client Mandate and Authority Workflow](client-mandate-workflow.md)
- [Lead Referrer Role](lead-referrer-role.md)
- [Role-based Training Programs](training-programs.md)

## Locked decisions

- Paperwork requirements generate Tasks and use the existing document/versioning system.
- Deal submission is database-gated on verified, current paperwork.
- The Mandate Letter and Authority and Consent Form are mandatory before funder engagement.
- The owner selects the client-mandate success fee per deal; the generated document must not hard-code 1.5%.
- Assigned partners/contractors may send an owner-approved mandate; Lead Referrers may not.
- Signed documents are versioned and retained; automatic deletion remains blocked pending legal policy.
- `lead_referrer` is a separate, restricted CRM role and does not inherit contractor access.
- Lead Referrers submit structured lead information and do not handle client documents in the initial release.
- Real funder identities and funder economics remain owner-only.
- Training uses the current network description: 49+ active funders, plus 7 venture-capital and 8 private-equity relationships.
- The current FNC contact number is 071 208 5218.
- Lead Referrer, Contractor and Partner/Doctor each receive a role-specific training track; short owner-approved YouTube lessons may be included.

## Pending decisions and external approvals

- Attorney approval: Mandate, Authority and Consent Form, Lead Referrer Service Agreement, NDA, POPIA/operator wording and retention trigger.
- Accountant approval: personally funded non-PO Lead Referrer commission treatment.
- Owner approval: Lead Referrer Base/L1/L2 rates, progression thresholds and bonus values.
- Product decision: timing of the client upload portal and e-signature provider.

## Repository artifacts

- `scripts/generate_client_mandate.py`
- `output/pdf/FNC_Client_Mandate_Master.pdf`

The PDF remains an operational master for review, not an activated production contract.
