# Client Mandate and Authority Workflow

Status: operational design approved on 2026-08-06; legal wording remains subject to South African attorney approval.

## Required documents

Every new funding deal requires:

1. Client-signed Mandate Letter.
2. Client-signed Authority and Consent Form.
3. FNC-countersigned Mandate Letter.

These are pre-submission requirements and form part of the Smart Documentation Checklist.

## Workflow

1. Client expresses interest in funding.
2. CRM creates a task to prepare the authority pack.
3. Owner selects the success-fee percentage for the specific deal.
4. CRM generates both branded, versioned PDFs using client and deal information.
5. An authorised owner, assigned partner/doctor or assigned contractor sends the pack using the approved email template.
6. CRM records recipient, sender, send timestamp, template versions and delivery status.
7. Client signs and returns both documents.
8. FNC countersigns the Mandate Letter.
9. Owner verifies both signed documents.
10. CRM marks the deal authorised for funder engagement.

No funder engagement or submission may occur before step 10.

## Success-fee control

- The success fee is stored against the deal, not globally against the client.
- Only the owner selects or changes the fee.
- Partners, contractors and Lead Referrers cannot quote or alter the fee.
- The generated mandate displays `success_fee_percent` and its written-word equivalent.
- Generating/sending freezes the fee and template version for that mandate.
- A fee change requires a newly generated and newly signed mandate; an issued or signed file is never overwritten.

## Status model

`not_generated` -> `generated` -> `sent` -> `client_signed` -> `fnc_countersigned` -> `verified`

Exceptional states: `expired`, `rejected`, `superseded`, `cancelled`.

## Tasks and reminders

| Event | Task |
|---|---|
| Client interested | Generate and send Mandate and Consent pack |
| Pack sent | Follow up for signatures |
| Outstanding after 3 days | First reminder |
| Outstanding after 7 days | Escalated reminder |
| Client documents returned | Review signed documents |
| Client-signed Mandate received | FNC countersignature |
| Both documents complete | Owner verification |
| Verified | Begin funder engagement |
| Approaching expiry | Renew authority pack |

## Access boundaries

- Owner: select fee, generate, send, verify, countersign and override with a recorded reason.
- Assigned partner/doctor or contractor: generate/send an owner-approved fee version and view only their attributable deal.
- Lead Referrer: cannot generate, send, view or handle mandate documents; handover occurs before this workflow.

## Storage, audit and retention

- Use the existing private Supabase document storage and `documents` version model.
- Record generation, sending, signature, upload, verification, rejection, download, expiry and override events.
- Preserve the issued template version and both signed versions.
- Operational retention target: seven years from the approved closure/termination event, subject to the final legal retention schedule.
- Do not implement automatic deletion until legal approval defines the trigger, exceptions and hold process.

## Master template

The controlled generator is `scripts/generate_client_mandate.py` and its review artifact is `output/pdf/FNC_Client_Mandate_Master.pdf`.

The master uses the FNC logo and branded WS-Empire-style layout, with a 12-month term, configurable success fee, non-circumvention, POPIA, electronic-signature and both-party signature provisions. It must retain the attorney-approval warning until legal sign-off.
