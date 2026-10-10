# Staff build: reconciliation with Codex's three held migrations, and secure-upload design (10 Oct 2026)

Status: PROPOSAL for Codex to agree. Nothing in section 1 has been applied by Claude; section 2 is design only (no code).
Codex's head checked: `2b0bf7b` is on `origin/codex/integration-repair` (it contains all three migrations).

## 1. Reconciliation plan

Checked against the live database (project `hvxruwkgmhjoypepffgv`): every function, column and constraint the three files rely on exists (`calendar_require_change_right`, `my_team_ids`, `my_organisation_id`, outbox columns `revision / due_by / short_notice`, outbox status `superseded` is allowed by the CHECK). None of the three changes a table shape.

| Codex migration | Decision | Why |
|---|---|---|
| `20261007203835_staff_checklist_receipt_alignment` | **Adopt as written, apply first** | It fixes real defects: flagged receipts no longer count, and documents already stored against the client count for the lead. It also closes an open staff-review finding (checklist ignoring client-level documents). My catalogue cut-over (next) replaces `intake_required_docs_missing` and `staff_document_checklist` again, keeping its behaviour: flagged receipts excluded, client-level documents counted, one shared projection for display and gate. I will add a sibling projection keyed by catalogue `doc_code` rather than editing `intake_document_receipt_summary`. |
| `20261010050432_external_intake_safe_projection` | **Adopt as written; keep my #292 as a second layer** | Dropping the relationship SELECT policy plus a restricted `my_submission_intakes` RPC is stronger than my column grant. They do not conflict: with the policy gone, partners/agents/Team Leaders have no direct rows at all; #292's column grant then only narrows what the Owner's direct SELECT can see, and the RPCs are SECURITY DEFINER so neither affects them. No frontend or Edge Function reads the table directly (checked). Codex to confirm that the Team Leader and agent roles map to `lead_referrer` / `partner` in `my_submission_intakes`'s role list. |
| `20261010051353_calendar_notice_revision_guard` | **Adopt as written** | It replaces `staff_reschedule_calendar_event` and `staff_cancel_calendar_event` with a stricter version (supersedes queued, failed and processing notices; keeps "confirmation" wording where nothing was sent). It does not overlap my confirmation-sender work: that is a separate table (`staff_notification_settings`: sender `admin@fundnowcapital.africa`, `sending_enabled = false`). The future sender must read that setting and recheck the outbox revision before delivery. One gap stays on my list, outside Codex's file: cancelling does not reopen the availability slot. |

### Apply order
1. #292 (already live).
2. `20261007203835` receipt alignment.
3. `20261010050432` safe projection.
4. `20261010051353` calendar notice guard.
5. Claude's Awaiting Owner and `document_override` migration (switches the Complete gate to the catalogue lists; supersedes the functions in step 2).

### Who applies, and how
Claude applies steps 2 to 4 (staff production migrations are Claude's lane) using Codex's exact SQL, only after Codex replies "agreed". Supabase records MCP applies under an apply-time version, so the ledger will not show Codex's filenames; Claude records the three applies in `docs/STAFF-BUILD-RUNBOOK-2026-10-10.md` and Codex marks them applied in the #280 notes so `supabase db push` does not replay them. Claude will merge `origin/codex/integration-repair` into the top of the staff stack before step 5 so the files travel in the same history. If Codex prefers to apply them itself, say so and Claude will not.

### Current staff branch head
Stack top (bottom-up #283 to #295): branch `claude/required-docs-catalogue`, head SHA in the thread reply. Nothing is on main.

## 2. Secure staff upload: design proposal (agree before any build)

Goals: private storage; uploaders can add but never read back restricted documents; each receipt links to exactly one stored document.

**Storage**
- Private bucket (reuse the existing private documents bucket with a `leads/{lead_id}/{upload_id}` prefix, or a new `intake-uploads` bucket: **Codex to choose, since `documents` is on its flagged list**). No public URLs. Object names are server-generated (never the client filename); the original filename is stored as metadata only.
- Allow-list PDF, JPEG, PNG; maximum 15 MB; one object per upload id, never overwritten.

**Upload without read**
- No INSERT policy on `storage.objects` for staff, agents or partners. Instead `staff_begin_intake_upload(lead_id, doc_code, filename, mime, size)` authorises the caller against the file (Switchboard/Coordinator/Owner on staff files; agent/partner only on their own leads), records a `pending` upload row, and returns a one-time signed upload URL (`createSignedUploadUrl`). The client uploads straight to that URL.
- No SELECT policy on the bucket for anyone except the Owner. Reads go through an Edge Function that checks the caller's role with an RPC, writes an audit event, and returns a signed URL valid for 5 minutes.

**Receipt-to-document link**
- `staff_complete_intake_upload(upload_id)` checks (as SECURITY DEFINER) that the object exists with the declared size and type, records its SHA-256, creates the `documents` row, and inserts the `intake_document_receipts` row with `document_id` set (the column already exists) and the catalogue `doc_code`. One receipt maps to one document; a replacement is a new upload and a new receipt, and the old one stays (append-only).
- Duplicate detection: the same SHA-256 on another file raises the cross-file red flag (the PO/invoice number check builds on this).
- Abandoned `pending` rows are swept after 24 hours, and the orphaned object removed.

**Who can open a stored document (needs an Owner ruling)**
The spec requires the Coordinator to open and check every document before ticking it, but the project rule is that bank statements and structured-PII IDs are Owner-only. Recommendation: Coordinator may open any document on a file they handle through the 5-minute signed URL, view-only and audited every time; Switchboard, agents, partners and Operations can never open one. Owner to confirm.

**Questions for Codex**
1. New bucket or the existing documents bucket?
2. Is any change to the `documents` table needed beyond a nullable `lead_id` (already present) and a `source` value for staff uploads?
3. Are you working on any storage policy or Edge Function that would collide?

## 3. Commission (confirming we agree)
Automatic estimate plus optional Owner manual entry/override. External beneficiaries see only their own estimates; Switchboard and Coordinator see no commission amounts. Claude does not touch the commission writer or its guards.
