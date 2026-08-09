# Lead Referrer Role — Fund Now Capital

**Status:** Owner-locked as of 2026-08-09. Any change requires new owner instruction and a version bump.

> Extracted from `docs/FNC-CONSOLIDATION-DOC-2026-08-09.md` Section 4. That consolidation document remains the authoritative source for the locks recorded here.

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
