# Codex build wave — 2026-08-05

This ledger separates local code, PR review, owner merge, Supabase apply, and
smoke-test status. Nothing is production truth until every applicable gate is
explicitly recorded.

## Status legend

- **LOCAL COMMITTED** — code exists only on its branch.
- **PR REVIEW** — pushed and awaiting Greptile/CodeRabbit plus owner review.
- **MERGED** — owner merged; this does not mean its migration is live.
- **APPLIED** — migration was dry-run, applied, and structurally verified.
- **SMOKE-TESTED** — owner completed the feature workflow successfully.

## Wave inventory

| Build | Branch | Commit | Status / canonical boundary |
|---|---|---:|---|
| Partner invoice reliability | `codex/partner-invoice-reliability` | `d4d0bcb` | LOCAL COMMITTED; canonical C4 follow-up |
| Owner terms admin | `codex/owner-terms-admin` | `562cdbb` | LOCAL COMMITTED; deferred owner UI for terms framework |
| Deal soft archive | `codex/deal-archive` | `8d55664` | LOCAL COMMITTED; ROADMAP Deferred Polish semantics |
| Owner task queue | `codex/general-tasks-queue` | `05b45eb` | LOCAL COMMITTED; business-operations first slice |
| Repayment tracker | `codex/repayment-tracking` | `8fde87a` | LOCAL COMMITTED; owner-only servicing first slice |
| Global search v1 | `codex/global-search` | `a29ca4b` | LOCAL COMMITTED; bounded `ilike`, not final F1 full-text search |
| Repeat client v1 | `codex/repeat-client` | `6418b9f` | LOCAL COMMITTED; no canonical D8 `parent_deal_id` yet |
| Owner command centre v1 | `codex/owner-home` | `291b6e0` | LOCAL COMMITTED; not full S10 vision horizons |
| Data-quality worklist v1 | `codex/data-quality` | `a3b701e` | LOCAL COMMITTED; read-only F9 first slice |
| Package readiness | `codex/deal-package-readiness` | `ef7f8aa` | LOCAL COMMITTED; manual E3 bridge |
| Printable package cover | `codex/deal-package-cover` | `9da570f` | LOCAL COMMITTED; browser PDF, not server-versioned E3 package |
| Contractor pipeline | `codex/contractor-pipeline` | `5f5cbfd` | LOCAL COMMITTED; D2 portal slice |
| Doctor pipeline | `codex/doctor-pipeline` | `c028ed1` | LOCAL COMMITTED, STACKED on Contractor Pipeline |
| Package dispatch log | `codex/deal-package-dispatch` | `71989c6` | LOCAL COMMITTED; manual E3 audit bridge |
| Portal pipeline guidance | `codex/portal-pipeline-guidance` | `89a1840` | LOCAL COMMITTED, STACKED on both pipeline branches |

## Migration apply order after review and owner merge

Apply each immediately after its own PR merge, never as one blind batch:

1. `20260805100000_owner_terms_admin.sql`
2. `20260805110000_deal_archive.sql`
3. `20260805120000_owner_tasks.sql`
4. `20260805130000_repayment_tracking.sql`
5. `20260805140000_deal_package_dispatches.sql`

For each: verify timestamp uniqueness; run a non-persisting `BEGIN`/`ROLLBACK`
dry-run; inspect RLS, grants, role gates, audit writes and assertions; apply;
reload PostgREST; then run that feature's smoke test.

## Validation gate before merge

1. Greptile/CodeRabbit findings triaged and owner-approved fixes committed.
2. `npm ci`, `npm run build`, and `npm run lint` green on the branch.
3. Migration security and timestamp checks green.
4. Portal cache isolation, caller scoping, fictional funder names, PII and money
   presentation rechecked.
5. Written feature-specific smoke test prepared.

## Initial verification limitation

The isolated Codex bundle clone had incomplete Node dependencies (`tsc` was not
available). Initial commits received structural review and `git diff --check`,
but not a successful TypeScript/Vite/oxlint run. They remain review candidates,
not production-approved code, until this gate passes in the real repository.
