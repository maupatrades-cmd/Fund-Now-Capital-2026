# Owner manual payout review

PR #299 is merged at `4c508c39ac5c1e94cec69eeed0f4ad057f088e7a`.
Release CI run `39048534715` succeeded. Vercel production deployment
`dpl_9Qkg4T9rgsw1yajaj3W6YeyRM8J8` is READY on that merge commit.

The next change adds manual allocations to `/payouts`, initially filtered to
approved entries. Owners can also select drafts, recorded payments, voids or all
entries. Each allocation retains its deal link, named beneficiary, original
amount, adjusted current amount, open flag count and payment reference.

Manual allocations are not added to automatic commission/invoice totals: the
ledgers can describe the same deal. Approval alone is not payment eligibility.
Current allocation is not historical payment evidence, because paid entries
can subsequently receive adjustments. The queue does not mark payments or
generate invoice items.

All reads retain existing Owner-only RLS. The live foreign-key names used by
the payee embeds were checked. Query caches are scoped to the signed-in user,
discarded after the last observer leaves, and identity is checked before and
after fetching. Both automatic and manual queues use the tested pager which
continues past short server-capped pages. Allocation commands invalidate the
manual queue.

Audit fixes included account-specific automatic payout caches, identity
rechecks, complete pagination, and replacing the misleading claim that payable
ledger status alone means ready to pay. No tables, RPCs, staff objects or
production money records change. No migration is needed. R100 stays held.

Validation: TypeScript, Vite build, targeted lint, repository contract preflight,
six commission-input/history tests, three manual read regressions and three CI
safety tests. Authenticated browser acceptance remains outstanding.

Next settlement work must check expected amount and currency under the same
deal lock as payment, attach immutable payment evidence, and integrate manual
allocations with invoice settlement without paying the automatic ledger twice.
The current payment RPC accepts only entry ID and reference; do not expose it
as a complete invoice/evidence workflow.

Acceptance in a controlled test environment: approve a labelled disposable
allocation, open Payouts, confirm the beneficiary and exact original/current
amounts, and follow Review deal. Check all status filters, adjustments and flags.
Switch accounts and verify Owner amounts do not appear in another account.
Do not record real payments for this test.
