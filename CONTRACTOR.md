# Fund Now Capital — Contractor Management Module (Phase 1)

## Document Purpose

Canonical reference for Fund Now Capital's contractor management module — the
system that manages FNC's direct independent contractors (not referral partners
like Doctor). Locked business truth.

## Real Business Context

FNC's direct contractors are independent contractors — not employees. They:
- Bring in leads directly (not through Bright Destiny)
- Are compensated through petrol/airtime/data reimbursements + commission tiers
- Progress through skill levels (Base → Level 3)
- Sign a Service Agreement (attorney-drafted, per South African contractor law)
- Handle their own tax (SARS provisional taxpayer status)
- Are visible on FNC's BEE Level 1 EME affidavit as suppliers, not staff

## Phase 1 Scope — 8 Features

### Feature 1: Contractor Records & Onboarding

- New table: `contractors` (id, legal_name, id_number, contact_email, contact_phone,
  physical_address, bank_details, sars_tax_number, bee_status, service_agreement_url,
  service_agreement_signed_at, service_agreement_version, current_level, current_status,
  created_at, activated_at, suspended_at, suspension_reason, deactivated_at)
- Application workflow: applicant fills form → screening → interview → agreement
  signing → onboarding → activation
- Status stages (aligned with the full ONBOARDING.md workflow): `applicant`, `screening`, `interview_scheduled`, `agreement_pending`, `document_collection`, `active`, `suspended`, `deactivated`, plus `rejected` as a terminal state (activation follows document verification; training is post-activation and optional — see ONBOARDING.md Stage 6)
- `suspended` is temporary and reversible: `active` → `suspended` → back to `active`
  (owner reinstates) or → `deactivated`. Suspended contractors cannot log in.
  Suspension and reinstatement require a reason and write to audit_log
- Only owner (Thapelo) can transition status
- Every transition writes to audit_log

### Feature 2: Service Agreement Lifecycle

- Attorney-drafted Service Agreement template (versioned)
- NDA + Non-solicitation + Non-compete clauses embedded
- Contractor signs before activation
- Signature captured via document upload (PDF with contractor's signature)
- Agreement version + signed date recorded on contractor record
- Real: this is the legal foundation — no active contractor without a signed agreement

### Feature 3: Progression System (Level Base → Level 3)

- Level Base: R7,000/month reimbursement (petrol + airtime + data)
- Level 1: R9,500/month
- Level 2: R12,000/month
- Level 3: R14,500/month
- Progression criteria:
  - Number of leads submitted
  - Number of deals funded
  - Total FNC gross generated
  - Certification completion (training module)
- Owner-controlled progression (Thapelo approves each level-up)

### Feature 4: Reimbursements

- Monthly petrol/airtime/data reimbursement based on current level
- Paid via EFT on 1st of month
- Real: this is NOT commission — it's contractor operating expense reimbursement
- Configurable per-contractor override (if Thapelo wants to boost a specific contractor)
- Real: reimbursements are BEFORE any commission calculation

### Feature 5: Locked Commission Tiers

- Contractor commission = flat rand lookup based on FNC gross for the deal
- Full tier table lives in `TIERS.md`
- Payment triggered when FNC receives commission payment from funder
- Paid within 5-7 business days of FNC receiving
- Commissions are IN ADDITION to reimbursements

### Feature 6: Weekly Airtime Bonuses (Phase 3, banked here)

- Additional airtime bonus paid weekly for high-performers
- Criteria: number of qualified leads submitted that week
- Real: incentive layer on top of monthly reimbursement

### Feature 7: Star Producer Bonuses (Phase 3, banked here)

- Quarterly bonus for top-producing contractors
- Criteria: total FNC gross generated in the quarter
- Bonus amount: percentage of the top contractor's FNC gross contribution
- Real: recognition + retention mechanism

### Feature 8: Milestone Badges + Gamification (Phase 3, banked here)

- Achievement badges: first lead, first funded deal, R100k FNC gross, R500k FNC gross, etc.
- Real: visible on contractor's portal profile
- Real: motivational, not financial

## Real Coexistence with Existing Money Engine

**Contractors integrate with the existing C2 money engine:**

- Contractor's deal → `deal.attributed_to_type = 'FNC_Contractor'` + contractor_id
- Deal funds → `commission_records` written with `gross_commission_amount` (from picker)
- Contractor commission = TIERS.md lookup based on `gross_commission_amount`
- Contractor commission written to a new table: `contractor_commissions` (mirrors
  `commission_records` structure for referral partners)
- Payable when FNC receives from funder → same cascade pattern as commission_records

## Real Onboarding Documents Required

See `ONBOARDING.md` for the full 17-form list. Highlights:
- Signed Service Agreement
- ID document
- Proof of address
- SARS tax number (provisional taxpayer registration)
- Banking details (proof of account)
- BEE affidavit or Level certificate (if applicable)

(Training completion is **not** an onboarding document — training is post-activation
and optional; see ONBOARDING.md Stage 6 and TRAINING.md.)

## Contractor Portal

- Login via same auth system as owner + referral partners (`referral_partner` role or new `contractor` role)
- Contractor sees:
  - Their own submitted leads + statuses
  - Their own referred deals + Potential/Confirmed earnings (per picker + tier)
  - Their current level + progression progress
  - Their earning history
  - Training modules + certification status
  - Milestone badges + achievements
- Contractor NEVER sees:
  - Other contractors' data
  - Real funder names (anonymized per fictional name mapping)
  - Owner's real FNC gross calculation

## Owner (Thapelo) Contractor Management Dashboard

- List all contractors with status
- View each contractor's:
  - Applications + interview notes
  - Service Agreement version + signed date
  - Progression history
  - Reimbursement history
  - Commission history
  - Performance metrics (leads, deals, FNC gross)
- Actions:
  - Approve/reject applications
  - Progress contractor level
  - Update reimbursement level
  - Suspend or deactivate contractor
  - Adjust commission entries (with typed OVERRIDE + reason)

## Standing Rules

- Only owner (Thapelo) can create, modify, or delete contractors — with one
  explicit exception: the public `/apply` form creates the initial `contractors`
  record with status `applicant` (see ONBOARDING.md Stage 1); every other
  create/modify/delete is owner-only
- Every contractor status transition writes to audit_log
- Every payment (reimbursement, commission, bonus) written to audit_log
- Contractor commission calculation is idempotent + lock-protected at DB layer
- Belt-and-braces DEFINER + grant matrix on any new RPC
- Real POPIA compliance: contractor personal data (ID, banking) encrypted at rest
- Real POPIA compliance: contractor sees only own data
- Real legal foundation: no active contractor without signed Service Agreement + SARS registration
