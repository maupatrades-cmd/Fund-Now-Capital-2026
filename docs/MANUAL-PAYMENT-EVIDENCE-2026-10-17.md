# Manual commission payment evidence

This release records a completed external transfer for one approved allocation.
It does not send an EFT, generate an invoice, settle an existing invoice or
activate R100 payroll.

## Database contract

Apply `20261017185316_manual_commission_payment_evidence.sql` after merging the
reviewed release. It depends on the live Owner commission editor, payment
recheck and cross-ledger route guard. Do not replay their older filenames.

`owner_record_commission_payment(entry_id, expected_amount, currency,
payment_reference, proof_path)` requires Owner authentication. It takes the same
deal advisory lock used by allocation changes, checks exact positive amount and
currency, verifies an uploaded proof exists in the Owner/allocation path, and
calls the existing approved/reconciled/no-flags/no-drafts payment function. The
existing route trigger rejects a deal already paid through the automatic ledger.
Payment status, evidence and audit inserts succeed or roll back together.

`owner_commission_payments` stores one immutable amount/currency/reference/proof
snapshot per entry. An exact repeat returns the same snapshot without a second
payment/audit insert; a different payload is rejected. Later allocation
adjustments do not rewrite the paid amount. Existing historical payments are not
backfilled with invented amounts or proof.

The legacy two-argument `owner_mark_commission_entry_paid` becomes an internal
implementation: its API EXECUTE grant is revoked. Existing allocation screens do
not call it. No shared staff helpers or document tables change.

## Proof storage

New private bucket: `commission-payment-proofs`. Owner-only INSERT/SELECT, no
authenticated UPDATE/DELETE. Restrictive policies preserve this protection even
if a future permissive policy is broad. Supabase privileged service/admin access
is outside these app-level policies. Accepted proof: PDF, PNG or JPEG, 1 byte to
10 MB. Object paths contain Owner ID, entry ID and random filename; original
filenames are not stored. RPC checks stored MIME/size metadata as well as path.

Uploads and SQL transactions cannot be atomic together. A rejected or ambiguous
command may leave an unlinked private proof object; it cannot mark an allocation
paid without the SQL checks. No automatic deletion/overwrite is attempted.
Any future privileged orphan cleanup needs an explicit retention policy and
must exclude linked evidence. Proof files remain Owner-only.

## UI and failure handling

Payouts exposes Record completed payment only after evidence loads, for approved
entries without an entry-level flag. Server checks remain authoritative for
whole-deal flags, reconciliation, drafts and route. Owner confirms a completed
transfer and provides its reference and proof. A synchronous in-flight guard,
disabled mutation retries and session binding prevent accidental repeated or
cross-account commands. Any error requires closing, refreshing and reviewing
payment history. Private caches refresh after every attempt.

The queue distinguishes original allocation, current adjusted allocation and
recorded payment amount. Older paid entries show that proof is unavailable here.
Until the migration is applied the evidence query fails closed and the payment
action remains disabled; existing allocation review still works.

## Verification and remaining work

Verified locally: TypeScript, Vite build, targeted lint, repository contract
preflight; 15 client/CI regressions; real migration exercised against isolated
PostgreSQL with the existing commission workflow and route guard. Regression
checks include stale but reconciled amounts, invalid currency/metadata/size,
Owner-only table/proof access, broad-policy resistance, exact retries, immutable
history after adjustments and cross-ledger rollback. These are synthetic tests,
not a multi-session concurrency benchmark or live Storage service acceptance.

After merge: apply this migration using the normal migration tool; check grants,
RLS, bucket limits and advisors, then test an authenticated disposable workflow
in a controlled test environment. Never create real transfer evidence for a
smoke test. No production payment has been created during development.

Remaining: invoice/settlement integration for manual allocations, bank-transfer
execution (if ever requested), and the separately held R100 eligibility work.
Do not count this feature as an invoice being paid or payroll being activated.
