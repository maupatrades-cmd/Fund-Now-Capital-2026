# Fund Now Capital — Contractor Onboarding, Mini HR & Required Forms

## Document Purpose

Canonical reference for the contractor onboarding workflow and mini HR module.
Covers the full journey from application to activation, the 17 required forms,
document management, and ongoing HR record-keeping. Locked business truth.

## Real Business Context

Fund Now Capital onboards contractors as independent contractors (not employees).
The onboarding process must:
- Be legally compliant (South African contractor law)
- Be POPIA compliant (personal data protection)
- Produce a signed Service Agreement before activation
- Register the contractor with SARS as a provisional taxpayer
- Support BEE reporting (contractors as suppliers, not staff)
- Be auditable end-to-end

## Onboarding Workflow (6 Stages)

### Stage 1: Application

- Applicant fills online form via `/apply` route (public, no auth)
- Real: this is the FIRST time a contractor touches FNC's system
- Form captures: full name, ID number, contact info, physical address, experience,
  motivation, referral source
- Application creates a `contractors` record with status = `applicant`
- Notification to Thapelo: new application received
- Applicant receives confirmation email

### Stage 2: Screening

- Thapelo reviews application on owner dashboard
- Verifies: ID number valid, no criminal record (owner uploads external check),
  banking details plausible, prior sales/broker experience credible
- Thapelo actions: approve for interview / reject / request more info
- Status transitions: `applicant` → `screening` → `interview_scheduled` OR `rejected`
- All actions written to audit_log

### Stage 3: Interview

- Thapelo schedules interview via calendar link sent to applicant
- Interview conducted in person or via video call
- Thapelo captures interview notes in the CRM
- Post-interview actions: approve for agreement / reject / hold for further consideration
- Status transitions: `interview_scheduled` → `agreement_pending` OR `rejected`

### Stage 4: Service Agreement Signing

- System sends Service Agreement PDF to approved applicant via email
- Applicant reviews, signs (physical or digital signature), returns signed copy
- Applicant uploads signed PDF via `/apply/upload-agreement` route (public, tokenized)
- Service Agreement version and signed date recorded on contractor record
- Notification to Thapelo: signed agreement received
- Status transitions: `agreement_pending` → `document_collection`

### Stage 5: Document Collection

- Contractor uploads the 17 required forms/documents (see list below)
- Each document verified by Thapelo (approved / rejected / needs re-upload)
- Real: contractor cannot progress until all required documents are approved
- The gate means "all applicable documents": conditional documents (VAT registration,
  CIPC company registration, shareholding certificate) can be marked Not Applicable
  by the owner and do not block progression
- Status transitions: `document_collection` → `training_pending` (once all applicable docs approved)

### Stage 6: Training + Certification

- Contractor completes Product Knowledge Training modules (see `TRAINING.md`)
- Passes certification assessment (minimum 80% score)
- Certification badge added to contractor profile
- Status transitions: `training_pending` → `active`
- Contractor is now activated: can log in, submit leads, earn commission

## 17 Required Forms & Documents

### Legal & Identity (5)

1. **Signed Service Agreement** — attorney-drafted, versioned, contractor signature
2. **Signed NDA** — embedded in Service Agreement or standalone
3. **South African ID document** — front and back scan
4. **Proof of address** — utility bill / lease agreement / bank statement (not older than 3 months)
5. **Criminal record clearance** — SAPS Certificate of No Criminal Record OR AFIS check

### Tax & Financial (4)

6. **SARS provisional taxpayer registration confirmation**
7. **SARS tax reference number certificate**
8. **Banking details confirmation** — stamped bank letter or recent bank statement
9. **VAT registration certificate** (if applicable — voluntary for contractors under R1m/year)

### BEE & Compliance (3)

10. **BEE affidavit** (for EMEs — annual turnover under R10m) OR **BEE certificate** (for larger entities)
11. **Company registration (CIPC)** — if contractor operates as a Pty Ltd
12. **Shareholding certificate** — if contractor operates as a Pty Ltd

### Contractor-Specific (5)

13. **Signed FICA declaration** — FNC's KYC on contractor
14. **Signed POPIA consent** — contractor consents to FNC processing their data
15. **Emergency contact form** — next of kin details
16. **Payment mandate** — authorizes FNC to pay commissions and reimbursements to specified account
17. **Signed code of conduct** — behavioral expectations, ethics, confidentiality

## Document Verification Workflow

- Each document has statuses: `pending_upload`, `uploaded`, `under_review`, `approved`, `rejected`, `needs_re_upload`
- Thapelo reviews each document individually
- Rejection includes reason (contractor sees reason on their portal)
- Approved documents cannot be modified (immutable audit trail)
- Documents stored in Supabase Storage: `contractor_documents/{contractor_id}/{document_type}/{filename}`
- Real POPIA: sensitive documents (ID, banking, tax) encrypted at rest, access logged

## Mini HR Module

The mini HR module lives on the owner dashboard and tracks:

### Contractor Records

- Personal details (name, ID, contact, address)
- Tax details (SARS number, VAT status, provisional taxpayer status)
- Banking details (bank name, account number, branch, account holder)
- Emergency contact
- Service Agreement version + signed date
- Document verification status (all 17)
- Current progression level (Base, 1, 2, 3)
- Current status (applicant, screening, agreement_pending, active, deactivated)
- Activation date
- Deactivation date (if applicable)
- Deactivation reason (if applicable)

### Performance Records

- Total leads submitted
- Total leads qualified
- Total deals funded
- Total FNC gross generated
- Certification completion date
- Training module progress
- Milestone badges earned

### Financial Records

- Monthly reimbursement history (petrol/airtime/data by level)
- Commission history (per deal, per payment)
- Bonus history (weekly airtime bonuses, star producer bonuses)
- Real-time payable balance (what FNC owes contractor right now)
- Payment history (EFT confirmations, dates, references)

### Compliance Records

- Service Agreement version + effective date
- Annual policy acknowledgments (contractor re-signs code of conduct annually)
- Training refreshers (annual mandatory)
- Any disciplinary actions or warnings

## Deactivation Workflow

- Thapelo can deactivate contractor at any time
- Deactivation requires reason (contract violation, voluntary exit, performance, other)
- Status transitions: `active` → `deactivated`
- Deactivated contractor cannot log in
- All historical records preserved (never deleted)
- Any pending commissions paid out on next payment cycle
- Deactivation written to audit_log

## Portal Views

### Contractor Portal (What They See)

- Application status (during onboarding)
- Uploaded documents + verification status
- Training module progress + certification status
- Current level + progression progress
- Recent leads submitted + status
- Recent deals funded + Potential/Confirmed earnings
- Reimbursement schedule
- Payment history
- Milestone badges

### Owner Dashboard (What Thapelo Sees)

- List of all contractors (filterable by status, level, performance)
- Individual contractor profile with all mini HR data
- Applications in each stage (Kanban view)
- Performance leaderboard
- Payment obligations (upcoming reimbursements + commission payments)
- Compliance flags (contractors with expiring documents, missed refreshers, etc.)

## Standing Rules

- Only owner (Thapelo) can approve document verification
- Only owner (Thapelo) can transition contractor status
- Every document upload, verification, status change writes to audit_log
- Real POPIA: sensitive documents encrypted at rest, access logged
- Real legal foundation: no active contractor without all 17 documents approved
- Belt-and-braces DEFINER + grant matrix on any new RPC
- Real: mini HR is UPSTREAM of financial engine (activation gates commission earning)
