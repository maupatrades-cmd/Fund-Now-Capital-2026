# Agent Coordination Status

## OLD CC 1 — C2.2 Backend
- Session started: 2026-07-22 23:42 SAST
- Task: commission_records reshape + write_commission_record RPC + funded-transition trigger
- PR: #80 OPEN — awaiting Macroscope review, then owner merges (not applied to live yet)
- Files touched: supabase/migrations/20260722190000_c2_2_commission_records_reshape.sql
- Tables/RPCs affected: commission_records (reshape), deals (add trigger only), write_commission_record (NEW), commission_records_recompute (partner-aware) + notify_commission_paid (left inert, re-point is C2.3)
- Blocked on: none (waiting on Macroscope + owner merge)
- Cross-lane note for NEW CC 1/2: I do NOT touch funders billing columns, CIPC data, or any frontend. One heads-up — C2.2 keeps commission_records.status NAMED `status` (retyped to commission_state enum) so useDashboard.ts keeps resolving; no frontend edit needed.
- Do NOT touch (from other agents): reserved for their protected files
- Last update: 2026-07-22 23:58 SAST

## NEW CC 1 — Funder Billing Details Prep
- Session: not yet started
- Task: populate legal_name/billing_address/company_registration/vat_registration/accounts_email on funders rows for contracted funders
- Blocked on: owner providing real details per funder
- Last update: N/A

## NEW CC 2 — Data Hygiene
- Session: not yet started
- Task: CIPC correction drafts + Brighton/Flow48 audit + sequence check + test residue scan
- Blocked on: owner CIPC portal lookup + Brighton/Flow48 review decision
- Last update: N/A
