# Claude to Codex coordination note (10 Oct 2026)

Written at the Owner's request so the two lanes do not clash. Claude owns the staff build (Switchboard, Sales Coordinator) and is the only operator applying its migrations to Supabase project `hvxruwkgmhjoypepffgv`. Codex owns signing, Path-A, reward payroll, commission-writer guards, CI and deployment reconciliation. Claude does not edit those.

## Stack of draft PRs (merge bottom-up; none is on main)
#283 SC1 lists, then #284 to #291 (SC2 to SC7, doc chasers, Batch 4 queues, runbook), then:
- #292 `20261010060000_intake_restricted_columns.sql`: column-level SELECT grant on `submission_intakes` for `authenticated` (internal columns hidden from partners, agents, Team Leaders).
- #293 `20261010061000_staff_confirmation_sender.sql`: `staff_notification_settings` (sender admin@fundnowcapital.africa, sending off), `owner_set_confirmation_sender`.
- #294 `20261010062000_sc9_qualifying_files_and_kpis.sql`: `staff_qualifying_files`, `staff_coordinator_kpis`; UI on the staff Home page.
- #295 `20261010070000_required_docs_catalogue_schema.sql` and `...070100_required_docs_catalogue_seed.sql`: new tables `doc_catalogue`, `doc_lists`, `doc_list_versions`, `doc_list_items`, `doc_entity_rules`; functions `doc_effective_list`, `staff_doc_lists_overview`, `staff_doc_list_detail`, `owner_confirm_doc_list`, `owner_edit_doc_item`; `/settings/document-rules` rebuilt on them.

## Applied live already (staff lane)
Batches 1 to 3 (`20261007090000` to `20261007110000`), SC1 to SC7 (`20261007180000` to `20261007231000`), `20261007240000_doc_chase_reminders` (cron `staff-document-chasers`), `20261007250000_staff_assignable_staff`, and the four 10 Oct migrations above. Codex's migrations (`20261007161245`, `...161251`, `...161254`, `...163650`) and `owner_commission_editor` were not touched.

## Building next (Claude)
1. Awaiting Owner status and `document_override` Founder Decision task (new tables for per-file document status, override requests and file list-version pinning; changes `intake_required_docs_missing` and `staff_set_intake_status` to read the new catalogue lists; extends `staff_tasks` kinds and `intake_workflow_status`).
2. Website-lead assignment: handler (staff) and consultant (in-house, agent, Team Leader, partner) with accept/decline; no commission effect.
3. Cross-file PO and invoice number check (red-flag flag).
4. Generated required-documents email (no send until the email domain is linked).

## Tables and objects Claude will touch
`submission_intakes` (status enum value and assignment columns), `staff_tasks`, `staff_audit_events` (writes only), `intake_document_receipts` and new `intake_*` tables, `doc_*` tables above, `answer_desk_items`, the staff RPCs and `src/pages/staff/*`, `src/components/staff/*`, `src/hooks/useStaffDesk.ts`, `src/pages/DocumentRulesPage.tsx`, `src/hooks/useDocLists.ts`.

## Left to Codex (Claude will not edit)
Signing and identity binding, Path-A commission support, `commission_records` / `write_commission_record` and any commission-writer guard, reward payroll (`r100`), PR #280 integration, CI and deployment, `crm_integration_settings`. Owner-only manual commission entry stays as built. The secure staff upload path is not started: it needs a design agreed with Codex first (storage bucket and policy for staff uploads, and how a receipt links to a stored document).

## Please tell Claude
- If any Codex change renames or changes `profiles.role`, `is_owner()`, `staff_actor_role()`, `staff_audit_write`, or the `documents` table, as the staff RPCs depend on them.
- Before #280 merges to main, so the migration order and the staff PRs can be merged in a safe sequence.
