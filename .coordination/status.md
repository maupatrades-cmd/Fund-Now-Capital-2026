# Agent Coordination Status

## OLD CC 1 — C2.2 Backend
- Session started: 2026-07-22 23:42 SAST
- Task: commission_records reshape + write_commission_record RPC + funded-transition trigger
- PR #80 OPEN (C2.2 migration) — Macroscope Medium resolved by 1746d1f, awaiting final re-review; not applied to live yet. Two fixes pushed (freeze earned split on incidental updates + companion submission-funded trigger).
- PR #81 OPEN (docs only, SPEC.md S7B) — funder rate structure future work (Merchant Capital + Flow48) + Polokwane address 75→73 correction. Zero code/schema change.
- Files touched: supabase/migrations/20260722190000_c2_2_commission_records_reshape.sql (#80); SPEC.md (#81, S7B + S16.3)
- Tables/RPCs affected: commission_records (reshape), deals + deal_funder_submissions (funded triggers), write_commission_record (NEW), commission_records_recompute (partner-aware + frozen), notify_commission_paid (inert, re-point is C2.3)
- Blocked on: none (waiting on Macroscope + owner merge on #80/#81)
- Cross-lane note for NEW CC 1/2: I do NOT touch funders billing columns, CIPC data, or frontend. #81 flags (but does NOT edit) the send-notification-email footer 75→73 Marshall St as a deferred TODO — whoever next touches that template should apply it. C2.2 keeps commission_records.status NAMED `status` (retyped to commission_state enum) so useDashboard.ts keeps resolving.
- Do NOT touch (from other agents): reserved for their protected files
- Last update: 2026-07-23 00:12 SAST

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
