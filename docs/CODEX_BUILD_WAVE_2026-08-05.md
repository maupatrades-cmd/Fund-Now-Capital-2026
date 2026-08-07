# Codex build wave — 2026-08-05

This ledger separates local code, PR review, owner merge, Supabase apply, and
smoke-test status. Nothing is production truth until every applicable gate is
explicitly recorded.

## Status legend

- **LOCAL COMMITTED** — code exists only on its branch.
- **PR OPEN (DRAFT)** — pushed with a Vercel preview, but automated review
  skipped until the PR is marked ready.
- **PR REVIEW** — ready and awaiting Greptile/CodeRabbit plus owner review.
- **MERGED** — owner merged; this does not mean its migration is live.
- **APPLIED** — migration was dry-run, applied, and structurally verified.
- **SMOKE-TESTED** — owner completed the feature workflow successfully.

## Wave inventory

| Build | Branch | Commit | Status / canonical boundary |
|---|---|---:|---|
| Partner invoice reliability | `codex/partner-invoice-reliability` | `d4d0bcb` | PR #133 **MERGED** at `ee97476`; Greptile 5/5, no inline threads, Vercel Ready; no migration; canonical C4 follow-up |
| Owner terms admin | `codex/owner-terms-admin` | `8843c36` | PR #134 **MERGED**; migration **APPLIED 2026-08-07** and structurally verified |
| Deal soft archive | `codex/deal-archive` | `c3fca7d` | PR #135 **MERGED**; migration applied and verified |
| Owner task queue | `codex/general-tasks-queue` | `bd30b89` | PR #136 **MERGED**; migration applied and verified |
| Repayment tracker | `codex/repayment-tracking` | `4ffe0d7` | PR #137 **MERGED**; migration **APPLIED 2026-08-07** and structurally verified |
| Global search v1 | `codex/global-search` | `4267a47` | PR #138 **MERGED** |
| Repeat client v1 | `codex/repeat-client` | `e449ff6` | PR #139 **MERGED** |
| Owner command centre v1 | `codex/owner-home` | `291b6e0` | PR #140 **MERGED** |
| Data-quality worklist v1 | `codex/data-quality` | `b68f556` | PR #141 **MERGED** |
| Package readiness | `codex/deal-package-readiness` | `3fdd851` | PR #142 **MERGED** |
| Printable package cover | `codex/deal-package-cover` | `4e1bb24` | PR #143 **MERGED** |
| Contractor pipeline | `codex/contractor-pipeline` | `5f5cbfd` | PR #144 **MERGED** |
| Doctor pipeline | `codex/doctor-pipeline` | `c028ed1` | PR #145 **MERGED** |
| Package dispatch log | `codex/deal-package-dispatch` | `577a53c` | PR #146 **OPEN**; final stale-draft fix carried by smoke-readiness work; migration remains unapplied until merge |
| Portal pipeline guidance | `codex/portal-pipeline-guidance` | `89a1840` | PR #147 **MERGED** |
| Record deal funding | `agent/record-deal-funding` | `cf842b8` | PR #151 **MERGED**; no migration and no automatic live-data mutation |

## Migration apply order after review and owner merge

Apply each immediately after its own PR merge, never as one blind batch:

1. ✅ `20260805100000_owner_terms_admin.sql` — applied and verified
2. ✅ `20260805110000_deal_archive.sql` — applied and verified
3. ✅ `20260805120000_owner_tasks.sql` — applied and verified
4. ✅ `20260805130000_repayment_tracking.sql` — applied and verified
5. ⏳ `20260805140000_deal_package_dispatches.sql` — apply only after its repaired code is merged

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

## Static audit checkpoint — 2026-08-05

No migration has been applied and no feature in this wave is marked production
ready. The first repository-to-canonical-doc review identified these proposed
fixes, which must be approved and resolved before merge:

1. **Terms evidence integrity:** a non-current Terms version can currently be
   edited even if users already accepted it. Historical accepted wording must
   remain immutable; only never-published, never-accepted drafts may be edited.
2. **Repayment semantics:** the recorder accepts a partial amount but closes the
   instalment to further writes. The product must either require full payment or
   add an append-only payment ledger that deliberately supports partials.
3. **Package contents:** the printable cover currently lists every current,
   active client document. It must not present unaccepted/unverified or expired
   documents as submission-ready, and the final E3 design still requires a
   reproducible source-version snapshot.
4. **Merge sequencing:** several branches modify the same shared route,
   navigation, dashboard, or Deal Detail files. Review can run in parallel, but
   merges must be ordered with a rebase and full check after each earlier merge;
   the 15 branches are not safe for a blind bulk merge.

GitHub status was confirmed through the read-only GitHub integration. The owner
marked PRs #134–#147 ready through GitHub CLI, enabling automated review.

## Automated review checkpoint — 2026-08-05 23:55 SAST

PR #133 passed Greptile 5/5 and Vercel, then was merged as `ee97476` on
2026-08-06 SAST. PR #134 passed Greptile 5/5 and was merged as `096306d`;
its Terms migration remains unapplied. PRs #135–#147 remain open. Greptile completed its first pass
on all 15. Valid findings were fixed and pushed on nine branches; those commit
hashes are recorded in the inventory. Vercel and CodeRabbit reran against the
fix commits, while remaining Greptile rereviews must complete before further
merges. PR #135's restore-history finding was rejected: the existing `deals`
activity trigger records changed fields plus before/after archive values, so a
second RPC audit insert would duplicate the event.

No migration has been applied. PRs #133 and #134 were merged on 2026-08-06
SAST; all other wave PRs remain open.
