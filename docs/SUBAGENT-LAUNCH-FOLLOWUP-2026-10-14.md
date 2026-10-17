# Sub-agent launch follow-up

The sub-agent role maps to `lead_referrer`; its portal can capture leads. It does
not yet provide the client-document upload available in the contractor portal.
Do not treat contractor testing as sub-agent acceptance.

This change preserves a signing link through login and mandatory password change.
Only local `/sign/<URL-safe token>` paths are accepted as return destinations.
The signed-out password-change guard and both form handlers use the same helper.
Functional helper tests, route wiring checks and the TypeScript build pass.
Live authenticated browser acceptance is still outstanding.

## Release audit — 17 October 2026

The PR296 release failure was an outdated onboarding assertion requiring the old
literal password-change redirect. The assertion now checks the mandatory-change
branch, validated destination and router-state transfer together. The invitation
flag and server-side password verification checks remain in place.

After that correction, all 38 cross-role source contracts, 17 targeted release,
signing and payroll checks, and all 15 isolated PostgreSQL regressions passed.
The signing destination tests include invalid/external destinations and ordinary
portal login. These are local results; GitHub CI must pass on the published
correction before merging. Browser acceptance remains outstanding.

No payroll migration was applied during this audit. Its activation hold below
still applies. No staff migration or document-catalogue function was changed.

The R100 calendar follow-up migration uses the 15th of the following SAST lock
month, includes locks after the old 22nd cutoff, and rejects payment before that
month ends. It follows `20261007161254_r100_reward_payroll_workspace.sql`.
Both payroll migrations remain unapplied. Do not activate them until the earning
source is reconciled with confirmed completeness, client-wide six-month
uniqueness and the applicable contract. A delayed legacy lock can still shift
the due month later than contractual completion. Team Leader remuneration has
different terms and is unchanged.

PR280 is merged at c5795e97224aa08e5df000d4b8ed6cb69ff4dc6b and deployed on
Vercel production. Public login and JavaScript asset requests returned 200; the
bundle contains the production Supabase project and no build-placeholder URL.
That does not establish authenticated role journeys.

The merged contact updates were deployed on 14 October: generate-invoice-pdf v7
and send-notification-email v16. Unauthenticated POST probes returned 401 for
both; no invoice was generated or email sent by these probes.

Staff PRs #283–295 remain with Claude. Review found catalogue/Complete-gate
mismatch, premature funder-submission wording, a reschedule open-slot bypass,
an incorrect send-back KPI value and incomplete included-list version pinning.
Resolve those and recheck the current heads before merging the staff stack.
