# Lead Referrer Role

Status: product architecture approved on 2026-08-06. Legal documents and unconfirmed financial rates remain blocked pending owner and attorney approval.

## Definition

`lead_referrer` is a new fourth CRM user role, separate from `owner`, `partner` and `contractor`.

A Lead Referrer is routed into FNC through an introducing partner/channel, but is onboarded, trained, tasked and paid under FNC's program. Bright Destiny is the first enabled channel; the data model must support additional introducing partners without redesign.

## Boundaries

| Capability | Lead Referrer |
|---|---|
| Complete assigned onboarding and training | Yes |
| Submit structured leads | Yes |
| View own leads and high-level status | Yes |
| Perform platform-directed early follow-up | Yes, until handover |
| View own tier, commissions, statements and badges | Yes |
| View other referrers or contractors | No |
| See partner/doctor economics | No |
| See FNC gross commission or retention | No |
| See real funder identities or contacts | No |
| Upload or handle client documents | No in the initial release |
| Generate/send client mandates | No |
| Quote fees, negotiate or bind FNC | No |
| Contact funders | No |
| Continue client contact after handover | No |

The service-agreement restriction on handling client documents controls the first build, even though an earlier build brief proposed lead attachments.

## Handover

`Lead submitted -> qualification -> accepted handover -> FNC deal team takes control -> referrer receives high-level status only -> funded event calculates commission`

After handover, a Lead Referrer cannot see internal notes, client communications, funder communications or paperwork. If contacted by the client, the referrer routes the communication to FNC.

## Portal

- Home/dashboard.
- Submit Lead.
- My Leads and safe status timeline.
- My Tasks, limited to early qualification and training.
- Training and assessment.
- Tier/progression.
- Earnings, bonuses and statements.
- Badges/achievements and opt-in anonymized leaderboard.
- Agreements, certification and notifications.

No FNC email account, laptop benefit or contractor protection allowance is attached to this role.

## Data model

Extend the relational model instead of storing one nested JSON record:

- add `lead_referrer` to `public.user_role`;
- `lead_referrer_profiles` for program status, routing and non-financial metadata;
- `lead_referrer_applications` for onboarding;
- `lead_referrer_progression` plus append-only progression events;
- versioned `lead_referrer_commission_rates`;
- `lead_referrer_commission_records` with deal/tier/rate/payment-source snapshots;
- `lead_referrer_bonus_records`;
- role-scoped training progress, certifications and milestones;
- `leads.attributed_to_lead_referrer_id` and `leads.routed_through_partner_id`.

Do not use a polymorphic `attribution_type`/`attribution_id` pair when explicit foreign keys and constraints can preserve referential integrity.

## Commission design

Locked full Level 3 calculation targets:

- PO: Lead Referrer earns 20% of FNC gross commission; Doctor remains 40%; FNC net is 40%.
- Non-PO: Lead Referrer earns 35% of Doctor's calculated tier amount; Doctor's amount remains unchanged.

The non-PO payer/accounting source must be represented separately from FNC company retention and approved by the accountant before automation.

Base, Level 1 and Level 2 rates, progression thresholds and all cash bonuses are configurable draft values. They must not be hard-coded or payable until an owner-approved, effective-dated schedule is published.

## Training

Reuse the applicable contractor modules with role-specific assignments:

1. SME finance introduction.
2. Product categories.
3. Qualification fundamentals.
4. Funder categories using fictional names.
5. Fraud prevention and escalation.
6. Lead Referrer platform/process standards.
7. Working as an FNC Lead Referrer and handover boundaries.

Passing target: 75%. Certification: `Certified FNC Lead Referrer`, valid for 12 months, with annual refresher.

The supplied Lead Referrer Training Material dated 2026-08-06 is the source curriculum. It must use the current network description of 49+ active funders, plus 7 venture-capital and 8 private-equity relationships, and the current contact number 071 208 5218. Short owner-approved videos may supplement lessons under the controls in `training-programs.md`.

## Activation gate

The account remains onboarding/inactive until:

- application approved;
- attorney-approved Service Agreement signed;
- attorney-approved NDA/confidentiality terms signed;
- required POPIA/operator acknowledgement complete;
- mandatory training and assessment passed; and
- an approved commission schedule is assigned.

## Security and privacy

- RLS and SECURITY DEFINER RPCs must explicitly gate `lead_referrer`, `auth.uid()` and active status.
- A referrer sees only their attributable leads, tasks, training, certification and earnings.
- Introducing partners see their own economics and approved channel reporting, not referrer compensation or private agreements.
- Sensitive demographic, identity, banking and tax fields require field-level access controls, encryption where appropriate, a defined purpose and retention rules.
- Leaderboards are opt-in and must not expose amounts or identifiable performance without consent.

## Build sequence

1. Role enum, profile/application foundation and RLS tests.
2. Agreement/NDA activation gate.
3. Restricted portal and structured lead submission.
4. Handover/status projection.
5. Training and certification assignments.
6. Configurable commission schedule and snapshot engine.
7. Progression, bonuses and gamification.
8. Owner reporting, compliance alerts and cross-role leakage tests.

Commission payments remain disabled until the pending rates and accounting treatment are approved.
