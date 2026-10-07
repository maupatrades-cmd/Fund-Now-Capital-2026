# Owner-only manual commission editor: design and conflict register

Status: **design for agreement with Codex and the Owner. No commission logic has been changed.**
Source rule (Owner clarification, 6 October 2026): the Owner personally enters commission. No automatic assignment, population, approval or change of payable commission from agreement bands, deal outcomes, membership changes or background jobs. Arithmetic totals and validation are allowed. Conflicts with the applicable agreement are flagged for Owner review, never silently changed.

## What the editor must do

- Owner-only entry, for a deal and its introducing parties: manual amounts and splits, currency, amount, basis or percentage if used, beneficiary, status, actor, time, reason for amendments.
- Split totals must reconcile before approval. No duplicate allocation to the same beneficiary for the same deal.
- Approved or paid history is preserved. Corrections are auditable adjustments, never edits.
- Approval is separate from marking a payout paid.
- Enforced in database policies and RPCs, not just the UI. Staff never see or edit amounts, splits or payouts.
- Existing historical rates and automated calculations must not overwrite Owner-entered commission.
- Does not change contractual R100 or R35 reward or salary entitlements; those keep their own evidence and review workflows.

## Proposed model (new tables only; nothing existing is altered by this part)

- `owner_commission_entries`: one row per deal and beneficiary. Columns: `deal_id`, `beneficiary_kind` (agent / team_leader / organisation / external_payee), `beneficiary_profile_id` or `beneficiary_organisation_id`, `currency` (default ZAR), `amount numeric(14,2)`, optional `basis` and `percentage`, `status` (draft / approved / paid), `approved_by`, `approved_at`, `entered_by`, `reason`. Unique active allocation per (deal, beneficiary).
- `owner_commission_adjustments`: append-only. Each row references an entry and carries a signed amount delta, reason, actor, time. Approved or paid entries can only change through an adjustment.
- `owner_commission_events`: append-only ledger of every action (reuses `staff_audit_events` with `entity_type = 'owner_commission_entry'`).
- RPCs, all `owner`-only and SECURITY DEFINER: `owner_save_commission_entry`, `owner_approve_commission_entries(deal_id)` (refuses unless the sum of entries reconciles to the Owner-stated pool total and no entry is flagged), `owner_adjust_commission_entry`, `owner_mark_commission_paid` (separate, needs payment evidence reference).
- Agreement-conflict flags are advisory: a function compares an entered amount with the applicable agreement band for information and writes a flag row. It never alters the entry.
- RLS: Owner full read. Staff roles: no policy, no grant, no projection. Agents, Team Leaders and partners: nothing until the Owner approves a presentation surface (the existing presentation policy still governs partner-facing money).

## Conflict register: where existing automation could override Owner-entered commission

These are in Codex's lane or shared. I have not edited any of them.

| # | Object | What it does today | Conflict with the Owner rule | Proposed minimal change (needs agreement) |
|---|---|---|---|---|
| 1 | `deals_write_commission_on_funded`, `submissions_write_commission_on_funded` triggers calling `write_commission_record(deal_id)` | Automatically writes `commission_records` when a deal reaches Funded with an amount funded | Auto-populates commission from the engine on a deal outcome | Skip when the deal has Owner entries (`owner_commission_entries` exists for the deal), or add an explicit per-deal `manual_commission_only` flag set on first Owner entry |
| 2 | `commission_records_recompute` and `calculate_commission()` | Recomputes the three-way split server-side on save | Overwrites a manual split on any later save | Recompute only for rows marked `source = 'engine'`; Owner rows carry `source = 'owner_manual'` and are exempt |
| 3 | `write_lead_referrer_commission`, `calculate_lead_referrer_earning`, Path-A support (Codex) | Computes Lead Referrer share from tier and owner share | Automatic assignment from bands and memberships | Same exemption flag; Path-A keeps computing an advisory figure shown beside the Owner's entry |
| 4 | `deal_commissions_apply_tier_on_lock` | Applies a tier percentage when the picker locks | Automatic band assignment | Skip for Owner-manual deals |
| 5 | `commission_cascade_on_invoice_state` and bonus cascade | Moves commission earned to outstanding to payable from funder-invoice state | Automatic state change of payable commission | Cascade may move only engine rows; an Owner entry becomes payable only by `owner_approve_commission_entries` |
| 6 | Partner and contractor invoice generators reading `commission_records` | Pull invoiceable commission | Would ignore Owner entries (or double count them) | Read through one view that prefers Owner entries when present; needs Codex review because it touches payroll and invoicing |
| 7 | Reward payroll (R100) and the R35 evidence workflow | Contractual rewards on Complete | Unchanged by this rule | None. Kept separate, as instructed |

## What I will build and when

1. Now (new files only, no shared edits): the three tables, RLS, immutability triggers, the Owner RPCs above, tests, as a separate draft PR stacked after Batch 1.
2. Only after Codex and the Owner agree rows 1 to 6: the exemption flag and the guard edits, authored by whichever side owns each function.
3. Until row 1 to 4 are agreed and applied, the automation can still write engine rows for a funded deal. The editor will show an engine row next to any Owner entry as a conflict for Owner review, and the Owner entry is the only one that approval and payout use. This is a known gap, reported rather than hidden.
