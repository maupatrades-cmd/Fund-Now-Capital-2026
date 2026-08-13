# Claude Code Session — Build Status & Collision-Avoidance (2026-08-12)

**Audience:** codex and any other build agent working this repo in parallel.
**From:** the Claude Code session on branch `claude/file-instructions-review-itj232` (+ per-build `claude/build-*` branches).

## Why this exists

Multiple agents are building the legal-documents / e-sign / onboarding wave at the
same time. Earlier today a **concurrent migration APPLY** caused the live Supabase
migration ledger and the actual schema to **diverge** — both this session and a
codex session applied the same migrations (#204–#206), creating duplicate ledger
entries and a mid-replay window where objects appeared/disappeared between reads.
This doc exists so that does not happen again.

## HARD RULE — migration application (read this first)

- **Only ONE actor applies migrations to the live Supabase project
  (`hvxruwkgmhjoypepffgv`) at a time.**
- This Claude session has been the applier this session. **Codex: do NOT apply
  migrations to live concurrently, and do NOT `reset`/`rebase`/replay the live
  project.** If a migration needs applying, route it through the owner so a single
  actor applies, in filename order.
- After any apply, the applier verifies ledger-vs-schema (objects actually exist),
  because a divergence is silent.

## Already APPLIED to live — do NOT re-apply

The full 2026-08-12 wave is applied + verified on live:

- codex **#203–#211** + role-task constraints validate (**#155205**)
- e-sign backend **#200** (`20260812090000` schema + `20260812090100` rpcs) —
  ⚠️ this is the **pre-fix** version; the 4 review-finding fixes are in **#214**.
- role-document-requirements **#201** (`20260812093000`)
- legal source-asset registry + 5 private buckets + clause-source map **#218**
  (`20260812210000`)

## This session's PRs / migrations IN FLIGHT — do not duplicate these builds

| PR | Build | Migration | State |
|---|---|---|---|
| **#214** | e-sign backend RPC fixes (4 findings) | `20260812200000` | open — needs owner merge → then I apply |
| (new) | client mandate success-fee model | `20260812220000` | open |
| #218 | source-asset registry + buckets | `20260812210000` | **merged + applied** |

## Migration filename lane

This session's legal-wave migrations use `20260812` timestamps: `090000`, `090100`,
`093000` (#201), `200000`, `210000`, `220000`. **Codex: choose non-overlapping
timestamps** to avoid filename collisions on future migrations.

## What I'm building next — claim before duplicating

Legal-wave machinery, in the audit-map order
(`docs/legal/AUDIT-MAP-LEGAL-ESIGN-WAVE-2026-08-12.md`):

- ✅ e-sign backend (#200 + #214 fix)
- ✅ role-document-requirements (#201)
- ✅ source-asset registry + buckets (#218)
- ✅ success-fee model (in flight)
- ⏭ **NEXT: deterministic PDF renderer (spec PR 6)**, then the client legal package (PR 8).

**If codex is also doing legal-wave builds, claim yours (here or via the owner) so we
don't both build the renderer / client package.**

## Blocked on content

The **6 approved source PDFs are NOT in the repo**. Every content-bearing step
(ingestion, real render, role/client packages) is blocked until they are uploaded to
the private `legal-source-approved` bucket. The registry (#218) is seeded to
hash-verify them on upload.

---

*Coordinate/relay via the owner.*
