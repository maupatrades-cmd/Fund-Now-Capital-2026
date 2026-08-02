# Fund Now Capital — Locked Commission Tier Structures

## Document Purpose

Canonical reference for Fund Now Capital's referral partner + contractor
commission tier structures. Locked business truth — cannot be modified in
code or UI without owner (Thapelo Maupa) approval + audit log entry.

## LOCKED ARCHITECTURE

**Every deal has ONE attribution — mutually exclusive:**
- `Direct_FNC` (Thapelo Maupa direct — owner keeps 100%)
- `FNC_Contractor` + contractor_id (FNC's direct team)
- `Bright_Destiny_Partner` + Doctor's referral_partner_id
- `Bright_Destiny_Sub_Agent` + sub_agent_id (Phase later)

**Commission engine reads attribution + FNC gross → applies correct structure.**

**Which structure applies per attribution:**
- `Bright_Destiny_Partner` → **Section 1** (40/60 split + tier % applied to pool)
- `FNC_Contractor` → **Section 2** (flat rand lookup, NO split)
- `Direct_FNC` → **Section 3** — Thapelo keeps 100% (no split, no partner payout)

**No mixed deals. No overlapping payouts.**

## Section 1: Referral Partner Commission (Doctor + future partners)

**Applies when: deal.attributed_to_type = 'Bright_Destiny_Partner'**

**The 40/60 split is a REFERRAL PARTNER rule only — it does NOT apply to
contractors (see Section 2):**
- 40% FNC company retention (stays with FNC as company revenue)
- 60% partner pool
- Partner's tier % applied to the 60% pool; owner share = pool − partner share

**Doctor's tier structure — % of 60% partner pool:**

| FNC Gross Commission | Doctor's % of Partner Pool |
|---------------------|---------------------------|
| R0 – R80,000 | 29% |
| R80,001 – R150,000 | 30% |
| R150,001 – R500,000 | 33% |
| R500,001+ | 25% |
| All PO deals | 40% flat |

Band lookup is contiguous: each band covers amounts up to and including its
upper bound; the next band starts strictly above it. No rounding, no gaps.

**Real math example:**
- Pollen deal, R400k facility → R140k finance charge → R14,000 FNC gross
- FNC 40% retention = R5,600 stays with FNC
- Partner pool = R8,400 (60%)
- Doctor's tier (R0-R80k band) = 29% × R8,400 = R2,436 to Doctor
- Thapelo's owner share = R8,400 - R2,436 = R5,964

## Section 2: Direct FNC Contractor Commission

**Applies when: deal.attributed_to_type = 'FNC_Contractor'**

- Contractor commission = flat rand lookup from the tier table based on FNC gross
- **NO 40/60 split applies**
- FNC pays the contractor directly from gross commission
- FNC retains whatever remains after the contractor payout

**Contractor tier — flat rand amount based on FNC gross:**

| FNC Gross Commission | Contractor Commission |
|---------------------|----------------------|
| R0 – R1,999 | R300 |
| R2,000 – R7,999 | R1,500 |
| R8,000 – R17,999 | R3,000 |
| R18,000 – R28,999 | R5,600 |
| R29,000 – R42,999 | R6,200 |
| R43,000 – R64,999 | R6,800 |
| R65,000 – R84,999 | R8,800 |
| R85,000 – R99,999 | R12,000 |
| R100,000 – R129,999 | R22,000 |
| R130,000 – R169,999 | R30,000 |
| R170,000 – R199,999 | R41,000 |
| R200,000 – R249,999 | R49,000 |
| R250,000 – R299,999 | R63,000 |
| R300,000 – R499,999 | R82,000 |
| R500,000 – R749,999 | R95,000 |
| R750,000 – R999,999 | R105,000 |
| R1,000,000+ | Case by case — Thapelo manual entry |

Band lookup is contiguous: each band covers amounts up to and including its
upper bound; the next band starts strictly above it. No rounding, no gaps.

**Small deals (Path A):** the flat R300 minimum applies even when it exceeds
a 40% retention floor. FNC absorbs the retention hit as contractor loyalty cost.

**Real math examples:**
- R14,000 gross Pollen deal: contractor (R8,000-R17,999 band) gets R3,000 flat; FNC keeps R11,000
- R2,000 gross deal: contractor gets R1,500 flat; FNC keeps R500 (accepted retention hit)
- R300 gross deal: contractor gets R300 flat; FNC keeps R0 (rare edge case, revisit if deals under R750 become common)
- Note: if deals with FNC gross under R750 become common, revisit this rule

**Contractor commissions are IN ADDITION to:**
- Petrol/airtime/data reimbursements (per Progression Level: Base R7,000 →
  Level 3 R14,500)
- Weekly Airtime Bonuses (Phase 3)
- Star Producer Bonuses (Phase 3)
- Milestone Badges (Phase 3)

## Section 3: Direct FNC (Thapelo Only)

**Applies when: deal.attributed_to_type = 'Direct_FNC'**

- No partner/contractor share
- Thapelo (as owner) receives full FNC gross
- No split needed — owner IS the 100%

## Locking Rules

- **Only Thapelo Maupa can modify tier structures**
- **Every tier change writes an entry to audit_log with:**
  - Old tier snapshot
  - New tier snapshot
  - Reason for change
  - Timestamp + owner user_id
- **UI dropdowns for tiers are DISABLED for all non-owner users**
- **Backend RPC that writes tier changes requires is_owner() + typed OVERRIDE confirmation**

## Payment Timing

**Payment triggered when: FNC receives commission payment from funder.**

- Doctor payments: per Bright Destiny Referral Agreement dated 28 April 2026 (banked in SPEC S8)
- Contractor payments: within 5-7 business days of FNC receiving from funder
- Direct FNC: immediate to Thapelo (owner is FNC)

## R1M+ Tier Handling

**When FNC gross ≥ R1,000,000:**

- Doctor's percentage bracket 25% still applies
- Contractor tier = "Case by case (Thapelo manual entry)"
- CRM UI must show clear input for owner to enter contractor's amount manually
- Manual entry writes audit_log entry with owner justification
