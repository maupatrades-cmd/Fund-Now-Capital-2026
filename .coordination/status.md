# Agent Coordination Status

## OLD CC 1 — C2 Backend (C2.2 done, C2.3 in review)
- Session started: 2026-07-22 23:42 SAST
- C2.2: PR #80 MERGED + APPLIED TO LIVE + verified; hotfix PR #82 MERGED (repo↔live reconciled); docs PR #81 (SPEC S7B) MERGED. commission_records ledger live, 0 rows.
- C2.3: PR #83 OPEN — funder-invoice state cascade (earned→outstanding→payable, void→earned+unlink), per-record transition_commission_record (advisory-locked, idempotent), COMMISSION_PAID re-pointed to status→settled, payment_received_date dropped, settle/unsettle stubs (raise P0002 for C4), COMMISSION_MISMATCH_ON_INVOICE_VOID activity_log. Validated in rollback; NOT applied to live yet (awaiting Macroscope + owner merge).
- Files touched: supabase/migrations/20260722190000_c2_2_*.sql (#80/#82, merged); SPEC.md (#81, merged); supabase/migrations/20260727120000_c2_3_commission_state_triggers.sql (#83)
- Tables/RPCs affected (C2.3): funder_invoices (cascade trigger), commission_records (transition/notify triggers, dropped payment_received_date), transition_commission_record + stub_settle/unsettle (NEW)
- Blocked on: owner merge of #83. Then I apply to live + report.
- Cross-lane note for NEW CC 1/2: I do NOT touch funders billing columns, CIPC data, or frontend. C2.3 defers the COMMISSION_MISMATCH owner push-notification (would need a new notification_event_type enum + frontend mapping — NEW CC 2's lane). #81's 75→73 Marshall St email-template fix is still a deferred TODO for whoever next touches that template.
- Do NOT touch (from other agents): reserved for their protected files
- Last update: 2026-07-27 (Mon) — C2.3 PR #83 opened

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
