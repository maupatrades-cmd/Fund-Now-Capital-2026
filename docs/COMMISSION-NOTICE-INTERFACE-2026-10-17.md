# Commission notice interface for Claude

Owner decisions on 17 October 2026 permit Coordinator commission assistance for agents, sub-agents, Team Leaders and partners. Enabled Administrators receive the same safe read projection.

## Ownership and shared reference

Codex owns allocation amounts, approvals and immutable notices. Claude owns Coordinator → Administrator → Owner queries, routing steps and staff screens. Claude's routing record references `commission_notice_id`; do not create a second financial ledger or snapshot table. This migration creates no routing table.

## RPC contract

- `owner_issue_commission_notice(p_entry_id uuid, p_expected_amount numeric) → uuid`: active Owner only. Issues a snapshot from an approved manual ZAR agent, Team Leader or organisation allocation. Sub-agents use their profile identity within agent allocations. The expected amount must exactly match the effective allocation; non-finite and fractional-cent inputs fail. Draft, void, paid and external-payee sources cannot issue new notices. Reconciliation, flags and outstanding drafts are checked under the existing deal lock. Repeating the call for the same revision returns the same notice ID.
- `staff_commission_notices_for_deal(p_deal_id uuid)`: published revisions for one deal.
- `staff_commission_notice(p_commission_notice_id uuid)`: one published snapshot. Unknown IDs return an empty set only after authorization succeeds.

Read RPCs require an active Owner or an active Coordinator/Administrator profile with a matching enabled `staff_access` row. They do not rely on nullable legacy role helpers. Ordinary agents, sub-agents, Team Leaders, partners, clients, Reception, disabled staff and missing/mismatched staff access are denied. Beneficiary self-service is not exposed here.

The projection contains only `commission_notice_id`, `client_name`, `deal_reference`, `beneficiary_kind`, `beneficiary_profile_id`, `beneficiary_organisation_id`, `beneficiary_name`, `commission_amount`, `currency` (ZAR), `issued_at`, and `is_current`. Recipient identity metadata prevents misdelivery. It exposes no FNC gross, split, tier, funder, success fee, percentage, basis, private reason, bank details or ID document.

## History, corrections and dispatch

Snapshots are immutable historical allocation notices, not proof of payment. Corrections use existing Owner adjustment/approval controls followed by a new notice. Prior notice IDs remain for history. `is_current=false` if the adjustment revision changes, the deal no longer reconciles, a draft remains or an open flag blocks the deal. Restoring an old amount does not revive an old revision. Payment can preserve a previously issued unchanged allocation notice; the notice does not record or authorize payment.

Re-read before displaying or sending a current notice and require `is_current=true`. A later change cannot recall an already sent notice; Claude's delivery history must retain the exact notice ID and route any replacement separately. No direct snapshot-table or commission-ledger grants are added. Owner issuance is audited without copying private financial terms into event payloads.

## Owner screen

The Deal Detail Owner manual-commission panel provides issuance and history. The Owner confirms the exact amount. Issuance does not send a notice or create routing. The interface fails closed until its migration exists and refreshes cached notices after allocation changes. History reads page past server row caps using stable timestamp/notice-ID ordering. Staff screens remain Claude's work.

## Explicit limitations

Only approved manual allocations are supported. Automatic `commission_records`, invoice bridging, beneficiary delivery, HR proof sharing and settlement remain separate work. Do not derive automatic allocations from notices or mark payments paid because a notice was forwarded or acknowledged. Administrator read access grants no amount-writing or Owner issuance authority.

Claude provisions the Administrator role/access row. This migration changes no `profiles.role`, `is_owner()`, staff helper, audit helper, document storage, staff booking function or Claude routing table.

## Verification

`tests/sql/commission-notice.test.mjs` runs the actual migration against isolated PostgreSQL and imports the actual existing Owner reconciliation/effective-amount/Owner-requirement functions. It covers negative authorization, total/currency reconciliation, zero-value drafts, deal-scoped flags, exact amounts, response allowlist, retry idempotence, immutable history, revision changes, payment preservation and revoked access. No real client/payment data is written. Live migration and authenticated Owner/staff acceptance are release tasks.

`tests/commission-notice-command.test.mjs` exercises actual client hooks with injected auth/database boundaries: exact-amount issuance, session changes, ambiguous results, user-specific caches and complete history under server caps. Production build, TypeScript, targeted lint and repository contract checks are required before publication. The Owner panel received a separate read-only audit; its identified history-pagination gap was fixed and regression-tested.
