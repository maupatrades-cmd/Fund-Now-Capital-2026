# Agent Coordination Status

## OLD CC 1 — C2 Backend (C2.2 + C2.3 live; C2.4 in review — closes C2)
- Session started: 2026-07-22 23:42 SAST
- C2.2 + C2.3: MERGED + APPLIED TO LIVE + verified (commission_records ledger + funder-invoice cascade + COMMISSION_PAID on settled + P0002 stubs). Supporting PRs #80/#81/#82/#83 all merged. commission_records still 0 rows (no genuine funding yet — see DEAL-001 note).
- C2.4: PR #86 OPEN — bonus_records table + add_bonus/void_bonus/transition_bonus_record + settle/unsettle P0002 stubs + lockstep bonus cascade on funder_invoices + settled-immutability trigger + BONUS_PAID event (2 files: enum-add + main). Validated in rollback; NOT applied to live yet (awaiting Macroscope + owner merge). Closes the C2 money backbone.
- Docs PR #87 OPEN — CLAUDE.md DEAL-001 correction (Funded stage but not genuinely funded).
- Files: supabase/migrations/2026072721000{0,1}_c2_4_*.sql (#86); CLAUDE.md (#87)
- LIVE STATE (verified 2026-07-27): 11 contracted funders (NEW CC 1 flipped 2 more since my earlier "9"). commission_records + bonus_records lifecycle wired, 0 real rows.
- Cross-lane note for NEW CC 1/2: I do NOT touch funders billing columns, CIPC data, or frontend. C2.3/C2.4 defer the MISMATCH + BONUS_PAID frontend notification mappings (new notification_event_type + src/lib/notifications.ts label/icon — NEW CC 2's lane). #81's 75→73 Marshall St email-template fix still a deferred TODO.
- Do NOT touch (from other agents): reserved for their protected files
- Last update: 2026-07-27 (Mon) — C2.4 PR #86 + docs PR #87 opened; live is 11 contracted funders

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
