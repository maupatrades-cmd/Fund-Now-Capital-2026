# Fund Now Capital — Contractor Product Knowledge Training Module

## Document Purpose

Canonical reference for Fund Now Capital's Product Knowledge Training Module —
the mandatory training program every contractor completes as part of onboarding
and ongoing progression. Locked business truth.

## Real Business Context

Contractors represent Fund Now Capital in the market. They speak to real
business owners, present real funding products, and gather sensitive client
information. Poor product knowledge results in:
- Misrepresented funding terms (legal risk)
- Missed qualification of clients (lost deals)
- Missed fraud warning signs (real financial risk)
- POPIA / FICA violations (regulatory risk)
- Damage to FNC brand reputation

Real: training is not optional. It is the foundation of contractor competence
and legal protection.

## Training Philosophy

- **Gamified** — points, badges, levels, leaderboard (real motivation)
- **Progression-gated** — training unlocks reimbursement-level progression (see below); it does NOT gate activation or lead submission
- **Continuous** — annual mandatory refreshers, module updates as products change
- **Certified** — passing assessment issues a "Certified FNC Contractor" credential
- **Auditable** — every module completion, assessment attempt, score written to audit_log

## 6 Training Modules

### Module 1: Fund Now Capital Overview

- FNC company history, mission, values
- FNC's role as a broker (not a lender)
- Real business model: introduction to how FNC earns
- Ethics and code of conduct

### Module 2: Funder Products

- Types of business funding available through FNC:
  - Merchant Cash Advance (MCA)
  - Invoice Discounting
  - Invoice Factoring
  - Purchase Order (PO) Finance
  - Working Capital Loans
  - Asset-Backed Finance
- Contractor learns real product mechanics: how each product works, what documents
  a client needs, typical rates, typical facility sizes, funder preferences
- **Fictional funder names used throughout training** (per anonymization pool from SPEC S1)
- Real: contractor never sees real funder names in training or in the CRM

### Module 3: Client Qualification

- How to identify a qualified lead:
  - Business type FNC funds vs doesn't fund
  - Minimum trading history requirements
  - Revenue thresholds
  - Industry restrictions
  - Legal entity requirements (Pty Ltd, sole proprietor, CC)
- Warning signs of unqualified leads (early elimination saves everyone time)
- Real: contractor learns to pre-qualify before submitting to CRM

### Module 4: POPIA & FICA Compliance

- POPIA (Protection of Personal Information Act) fundamentals
- Contractor's responsibility handling client personal data
- Consent requirements before collecting client information
- FICA (Financial Intelligence Centre Act) requirements
- KYC (Know Your Customer) checks
- Fraud warning signs contractor must escalate to Thapelo
- Real: contractor signs POPIA + FICA acknowledgments as part of module completion

### Module 5: Sales Skills

- Real conversation frameworks for approaching business owners
- Building trust with clients
- Objection handling
- Real: this is skill-building, not scripts

### Module 6: FNC CRM System Training

- How to log in to the contractor portal
- How to submit a new lead
- How to upload client documents
- How to track lead / deal status
- How to view Potential/Confirmed earnings
- How to view training + certification status
- How to view reimbursement + payment history

## Assessment Engine

### Assessment Structure

- Multiple choice + short answer questions
- Question pool per module (contractor sees random subset each attempt)
- Timed assessment (typically 30-45 min per module)
- Minimum passing score: 80%
- Real: assessments are open-book for reference material but time-limited

### Retake Logic

- Failed attempt (below 80%): can retake after 24-hour wait
- Second failed attempt: 48-hour wait
- Third failed attempt: manual review by Thapelo before allowing further retakes
- Real: retake logic prevents cheating attempts, ensures real learning

### Real Certification

- Passing all 6 modules + final combined assessment = "Certified FNC Contractor"
- Certification issued as PDF credential with QR verification code
- Certification date + version stamped on contractor record
- Certification visible on contractor's public profile (portal)

## Gamification

### Points System

- Complete a module: +100 points
- Pass an assessment first try: +200 points
- Complete all modules within 14 days of activation: +500 bonus points
- Weekly leaderboard among active contractors

### Badges

- **First Module** — completed first training module
- **Fast Learner** — completed all 6 modules within 14 days
- **Perfect Score** — 100% on any assessment
- **Compliance Champion** — 100% on POPIA + FICA modules
- **Product Expert** — 100% on Funder Products module
- **Certified FNC Contractor** — passed final combined assessment
- **Annual Refresher** — completed annual mandatory refresher on time

### Levels

- Level 1: First module completed
- Level 2: 3 modules completed
- Level 3: All 6 modules completed
- Level 4: Certified (passed final assessment)
- Level 5: Annual refresher completed (returning certified contractor)

## Progression Gates

Training supports contractor development — it does NOT gate activation or lead
submission. Contractors are activated after document verification (see
`ONBOARDING.md` Stage 5) and can submit leads + earn commission immediately.

- **Modules 1-3:** Strongly recommended for competence + fraud detection. NOT
  blocking activation or lead submission.
- **Modules 4-6 + certification:** Required for Level 2 reimbursement progression.
- **Annual refresher:** Required for maintaining Level 2+ status. Not blocking
  Level 1 or below.

## Content Management

### Content Delivery

- Training content stored in Supabase Storage as versioned assets
- Text, images, video (real: mobile-friendly for contractors in the field)
- Content updates versioned (real: contractors trained on Version 1.0 don't
  need to re-take when Version 1.1 lands, but material changes trigger refresher)

### Content Ownership

- Owner (Thapelo) writes and maintains all training content
- Real: ~80-120 hours of content development effort for initial 6 modules
- Real: content is separate from engineering — CRM builds the platform, Thapelo
  fills it with real product knowledge

### Content Approval

- All content changes require Thapelo's explicit approval
- Version bumps require justification (why change, what's different)
- Content changes written to audit_log

## Assessment Question Bank

- Owner (Thapelo) maintains question bank per module
- Questions can be added, retired, or modified
- Each question has: correct answer, distractors, difficulty rating,
  associated module + section
- Questions randomly sampled per attempt (prevents memorization)
- Real: question bank grows over time as Thapelo identifies knowledge gaps

## Portal Views

### Contractor Portal (What They See)

- Current module they're on
- Progress bar per module (% complete)
- Assessment status per module (not attempted / passed / failed / retake available)
- Overall certification progress
- Earned badges + levels
- Leaderboard position
- Annual refresher due date (once certified)

### Owner Dashboard (What Thapelo Sees)

- Training progress per contractor
- Assessment scores + attempt history
- Content management (add/edit/version modules)
- Question bank management
- Certification pipeline (contractors close to passing)
- Refresher pipeline (contractors due for annual refresher)
- Aggregate metrics (average time to certification, average scores, failure hotspots)

## Real Integration with CRM

- Training platform lives inside the contractor portal (not a separate system)
- Uses same auth, RLS, notification framework as rest of CRM
- Progress + certification data stored in Supabase (`contractor_training_progress`,
  `assessment_attempts`, `certifications`)
- Real: no third-party LMS dependency

## Standing Rules

- Only owner (Thapelo) can write/edit training content
- Only owner (Thapelo) can add/retire assessment questions
- Every module completion, assessment attempt, certification issue written to audit_log
- Real: assessment integrity — no way for contractor to see correct answers
  before assessment, no way to modify their own scores
- Belt-and-braces DEFINER + grant matrix on any new RPC
- Real: certification is legal protection — a certified contractor represents
  FNC with documented, verified product knowledge
- Real: content quality is contractor competence — Thapelo owns content quality
