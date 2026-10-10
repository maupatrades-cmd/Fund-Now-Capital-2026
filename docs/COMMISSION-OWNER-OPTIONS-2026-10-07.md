# Commission options — Owner decision, 7 October 2026

Automatic calculation remains available. Manual entry and override are Owner
options, not a replacement for the engine. This supersedes earlier manual-only
wording in the staff editor proposal and coordination notes.

Agents, Team Leaders and referral partners may see only their own estimates,
labelled “Estimate—subject to Owner approval.” They cannot see other parties'
splits or FNC margins. Switchboard and Sales Coordinator see no commission figures.
Only the Owner controls final amounts, approval, overrides and payouts.

## Delivery status

Path-A calculation, signing identity binding and application write protection
have been applied live. The Path-A assertion fixture was corrected to populate
shares explicitly from the existing calculator: current recompute deliberately
skips rows with no funder submission. Live assertions passed with fixtures rolled
back. No real commission or payment was created.

Manual entries and automatic records still use separate ledgers. A shared
authoritative approval/invoicing/payment path, protection against duplicate
payment across the ledgers, and estimate-only backend/UI projections remain
unfinished. Do not describe this as a completed override workflow or activate
the legacy payroll dates until they are aligned with the contracts.

## Manual payment recheck — 10 October

`20261010071407_owner_commission_payment_recheck.sql` rechecks the whole deal
before marking a manual entry paid: the total must still reconcile, no open
commission flags may remain, and every draft must be approved. Flag creation,
resolution, adjustment and payment now take the same per-deal advisory lock as
approval and draft editing. Existing Owner authorization and audit events remain.

The isolated PostgreSQL regression passes for a flag raised after approval,
an adjustment that breaks reconciliation, a new zero-value unapproved draft,
denial of payment to staff/beneficiaries, and successful Owner payment after
resolution. Multi-session concurrency has not been exercised by this test.
This migration has not been applied to production. Cross-ledger payment
protection is provided by the separate migration below.

## Payment route protection — 10 October

`20261010095939_commission_payment_route_guard.sql` reserves one payment route
per deal at the first recorded payment: automatic or manual. Further payments
through the other ledger are rejected by database triggers. Multiple manual
beneficiaries on the same deal remain possible. Calculations, manual drafts and
approval do not themselves claim a route.

The reservation is private and immutable. A reversal does not release it:
reversing an accounting entry does not establish that money was recovered.
Existing settled/paid history, including reversed rows with payment timestamps,
is imported; contradictory history aborts migration installation. The migration
locks both ledgers while importing history and installing the triggers.

Regression tests cover both directions, historical conflicts, rollback of the
route claim and associated state changes, and the actual Owner manual-payment
RPC. The invoice rollback fixture is synthetic; full invoice-RPC and concurrent
multi-session acceptance remain outstanding. This is not a bank-payment service
and does not stop a human making a duplicate EFT outside the CRM.

Not applied live. The unified override/approval/invoice UI, own-estimate-only
projections and contractual reward dates remain unfinished. A deal with an
existing payment cannot switch routes through this safeguard.

## Migration mapping — do not replay

| Source version | Live version | Name |
| --- | --- | --- |
| 20261007161245 | 20261007191720 | lead_referrer_path_a_support |
| 20261007161251 | 20261007185939 | signing_identity_binding |
| 20261007163650 | 20261007190030 | client_application_open_deal_guard |

Reconcile the source/live manifest before a CLI push. No migration ledger was
manually edited for these three applications.
