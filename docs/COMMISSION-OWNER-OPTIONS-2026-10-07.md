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

## Migration mapping — do not replay

| Source version | Live version | Name |
| --- | --- | --- |
| 20261007161245 | 20261007191720 | lead_referrer_path_a_support |
| 20261007161251 | 20261007185939 | signing_identity_binding |
| 20261007163650 | 20261007190030 | client_application_open_deal_guard |

Reconcile the source/live manifest before a CLI push. No migration ledger was
manually edited for these three applications.
