# Fund Now Capital — agreed Sales Coordinator specification

Saved 2026-10-06, Africa/Johannesburg. Retention only; do not begin implementation from this file.

## Contract alignment before implementation

Align with the Sales Coordinator employment contract Schedule 2 and the agent agreement, including its Schedule 2. These documents have not yet been provided or reviewed. Obtain the exact documents before implementing contractual rules; do not invent checklist requirements, qualifying-week rules, Team Leader targets or precedence between conflicting clauses.

The requirements below supersede the earlier assistant proposal, particularly assigned-only intake and helping clients complete applications.

## Access and responsibilities

- Central intake access to every submission from all three channels: direct agents; Teams comprising Team Leaders and their consultants; referral partners. No bulk export or deletion.
- Staff and agents must never fill in, edit or fix any client document. Coordinator may request documents and flag missing items only.
- Complete means all required documents received. Verified means genuine, and only the Founder may mark Verified.
- Complete affects the R100 submission fee and qualifying weeks. Every Complete mark must be audit-logged and reversible by the Founder.
- Coordinator may set New → Documents incomplete → Complete → With Founder.
- Only Founder may set Submitted to funder, Approved, Declined, Closed.
- Coordinator may archive as withdrawn, duplicate or lapsed, with a mandatory reason. Founder may reverse archival.

## Submission data

- Channel required: direct agent, Team (with Team Leader), or referral partner.
- Record all introducing parties for later commission allocation. Coordinator records attribution but never sees commission amounts or splits.
- Funding-type document checklists: PO finance, invoice finance, asset finance, working capital. Exact requirements come from Schedule 2 of the agent agreement.
- Automatically flag a client already registered by someone else or submitted within the last six months. First complete submission wins.

## Automations

- Follow-up tasks on stalled submissions every three working days.
- Lapse alerts at 30 days without a complete submission, or six months without approval.
- Weekly check-in task per Team Leader.
- Reminder to update each referral partner every two weeks.
- Daily pipeline summary to Founder at 16:30 (Africa/Johannesburg).
- Friday report on agents, Team Leaders and partners.
- Red flag button immediately alerts Founder to suspected fraud or altered documents.

## Dashboard

- Each agent's Complete submissions this week against a target of five.
- Each Team's monthly progress against its Team Leader targets.
- Deals waiting on Founder: With Founder queue.
- Work queues for intake, missing documents, follow-ups and appointments.

## Never visible to coordinator

- Commission amounts, splits, payouts.
- Bank details and ID documents.
- Funder contact details and terms; funder name only is allowed.
- Partner commercial terms.
- Agent Code issuing.

## Approved batch order

Smoke-test every batch before starting the next. Three to four items per batch.

1. Coordinator role and backend-enforced permissions; status workflow with Founder-only steps; channel and introducing parties; audit log.
2. Funding-specific document checklists; duplicate check; coordinator dashboard and work queues.
3. Calendar and booking access with four separate permissions (see availability, create bookings, change bookings, manage others' bookings); Team Leader and partner reminders.
4. Automated follow-ups; lapse alerts; daily and Friday reports; red flag button.

## Implementation considerations (not substitutes for contract wording)

- Show received/missing indicators for restricted documents without exposing their contents.
- Audit Complete and reversals with actor, timestamp, reason and checklist evidence. Flag affected submission fees and qualifying-week calculations for reconciliation.
- Keep archive and duplicate history; do not delete competing submissions. Enforce first-complete ordering consistently under concurrent updates.
- Calendar availability must not reveal private event details; changes must respect delegated authority.
- Smoke tests must exercise backend denials, sensitive-data exclusion, completion and archive reversals, duplicate ordering, dashboard counts, booking scope, scheduling and duplicate-alert prevention.
- Clarify working-day/holiday definition, Team Leader targets, qualifying weeks, reversal effects on first-complete priority, and unresolved scheduling details from the contracts or the owner before dependent implementation.

## Delivery context

This is a future specification, not a deployed feature. Existing deployment Batch 2 remains locally prepared; GitHub write attempts returned HTTP 403 (Resource not accessible by integration). See FNC-batch-2-status-2026-10-05.md for that separate work. The coordinator's four batches are distinct from the earlier deployment batches.
