# Agent Coordination Status

## OLD CC 1 — C2.2 Backend
- Session started: 2026-07-22 23:42 SAST
- Task: commission_records reshape + write_commission_record RPC + funded-transition trigger
- PR: not opened yet
- Files touched: supabase/migrations/*_c2_2_*.sql
- Tables/RPCs affected: commission_records (reshape), deals (add trigger only), write_commission_record (NEW), commission_records_recompute + notify_commission_paid (reconcile)
- Blocked on: none
- Do NOT touch (from other agents): reserved for their protected files
- Last update: 2026-07-22 23:42 SAST

## NEW CC 1 — Funder Billing Details Prep
- Session: not yet started
- Task: populate legal_name/billing_address/company_registration/vat_registration/accounts_email on funders rows for contracted funders
- Blocked on: owner providing real details per funder
- Last update: N/A

## NEW CC 2 — Data Hygiene
- Session started: 2026-07-22 (Data Hygiene Sweep) — INVESTIGATION COMPLETE, no data changed
- Task: CIPC correction drafts + Brighton/Flow48 audit + sequence check + test residue scan
- Files touched: scratchpad/mama-mabase-cipc-correction.sql (draft only). No production data changed.
- Do NOT touch (from other agents): commission_records, funders (OLD CC 1 + NEW CC 1 own these)
- Findings:
  1. CIPC — ALREADY CORRECTED today 2026-07-22 20:03:52 UTC (201989387807 → 2019/893878/07,
     direct DB update, actor null). Draft is now a guarded confirm/no-op pending CIPC-portal value.
  2. Brighton Capital + Flow48 — both is_contracted=true, flipped 2026-07-21 ~22:20–22:22 UTC as part
     of a BATCH of 9 funders all flipped that evening (Sourcefin, Bridgement, Merchant Capital,
     Better Banc, GenFin, Business Partners, Pollen Finance + these 2). Seeded 2026-07-13 19:32:49.
     NO activity_logs exist for the flip — funders table has ZERO activity logging (0 rows entity_type=funder).
     Only trace is updated_at. Owner decision needed: were all 9 intended as contracted?
  3. Sequences — funder_invoices_seq = 32, is_called=false → next invoice #32 (CONFIRMED, matches expectation).
     deals_reference_seq = 10, is_called=true → next DEAL-011 (gaps from deleted test deals, expected).
     Only these 2 sequences exist in public schema.
  4. Test residue — CLEAN. 0 hits in all live tables (clients/leads/deals/documents/call_logs/notifications/
     contacts/partners). No B3.2 Test Lead, no C1.2 UI Smoke, no smoke residue. All 3 deals/2 leads/1 call_log
     are real. All docs + submissions attach to real parents, zero orphans. Only footprints are 10 immutable
     activity_logs DELETE rows from the 2026-07-17 cleanup (correct — audit truth, do not purge).
- Blocked on: owner CIPC portal lookup (likely no-op) + Brighton/Flow48/batch-of-9 contracted decision
- Last update: 2026-07-22 (sweep complete)
