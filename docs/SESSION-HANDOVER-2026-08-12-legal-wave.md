# Fund Now Capital — Session Handover (2026-08-12) — Legal-Documents / E-Sign / Onboarding Wave

**For:** the next Claude Code / codex session.
**Repo:** `maupatrades-cmd/fund-now-capital-2026` · default branch `main`.
**Supabase project:** `hvxruwkgmhjoypepffgv`.

## 0. Read first (canonical, in precedence order)
`docs/FNC-CONSOLIDATION-DOC-2026-08-09.md` (owner-signed master — read FIRST), `CLAUDE.md`, `SPEC.md`, `ROADMAP.md`, `TIERS.md`, `CONTRACTOR.md`, `ONBOARDING.md`, `PICKER.md`, `TRAINING.md`, `docs/lead-referrer-role.md`.
This wave's spec: **`FNC-CANONICAL-LEGAL-DOCUMENTS-ESIGN-ONBOARDING-SPEC-2026-08-12`** (owner-provided; **not committed to the repo** — request it from the owner).
This wave's map: **`docs/legal/AUDIT-MAP-LEGAL-ESIGN-WAVE-2026-08-12.md`** · coordination: **`docs/CLAUDE-SESSION-BUILD-STATUS-2026-08-12.md`**.

## 1. HARD RULE — migrations (read before touching the DB)
- **Exactly ONE actor applies migrations to the live project at a time.** A concurrent apply on 2026-08-12 diverged the migration ledger from the actual schema (duplicate ledger rows + a mid-replay window). It was reconciled; do not repeat it.
- No local Postgres and **no Supabase preview branch** (a from-scratch replay dies on the pre-existing `20260802043750_fix_a_rpc_grants_hardening`). Migrations self-verify via **rollback-on-failure assertion blocks** applied directly to live via `mcp__Supabase__apply_migration`. **After every apply, verify ledger-vs-schema** (objects actually exist) — divergence is silent.

## 2. Applied to live this session (verified) — the legal-wave DB layer
| Build | PR | Migration(s) | Notes |
|---|---|---|---|
| E-sign evidence backend | #200 | `20260812090000` + `090100` | agreement instances + signing state machine + magic-link `signature_requests` + append-only ledgers |
| E-sign 4-bug fix | #214 | `20260812200000` | multi-signer gating, no decline-after-sign, no expire-of-signed, idempotency lock |
| Role-document-requirements | #201 | `20260812093000` | role activation packages + resolver; **16 seed rows** |
| Source-asset registry + 5 buckets + clause map | #218 | `20260812210000` | **6 approved-PDF hashes seeded (pending)**; `register_legal_source_asset` hash-verifies uploads |
| Client mandate success-fee model | #220 | `20260812220000` | `deal_success_fees` + set/freeze/summary RPCs |
| Codex wave | #203–#211, #155205 | `20260812003625…155205` | partner-view invoker, attribution lock, doc-req tasks, role tasks, calendar/bookings, reminders, dispatch-gate, reward-readiness, invoice-health |

**Live business rows: 0** — agreement_instances 0, deal_success_fees 0, legal_source_assets 6 (all `pending`), role_document_requirements 16. Real client data unchanged (Mama Mabase, Fepa Sechaba, NRL Bakwena).

## 3. Built, PR open — NOT merged/deployed
- **#222 — PDF renderer** (`supabase/functions/generate-legal-document-pdf`). Deterministic multi-page A4, pdf-lib, `X-Webhook-Secret`. **Not deployed** — after merge, deploy + ensure `WEBHOOK_SECRET`. Machinery only (renders `content_markdown`; real clauses arrive with ingestion).
- **#221 — coordination doc** (docs-only, ready to merge).

## 4. THE blocker — content is gated on the 6 approved PDFs
The **six approved source PDFs are NOT in the repo.** Nothing content-bearing can proceed until the owner uploads them to the private **`legal-source-approved`** bucket; then `register_legal_source_asset` hash-verifies each against the seeded §2 hash (`verified` / `mismatch`+alert). **Never invent legal wording** (spec §1.6 + CLAUDE.md). Only after the PDFs land: ingestion → template versions → client/role packages.

## 5. Next builds (audit-map §7 order)
1. **Deploy #222** (after merge); optional `pg_net` RPC wrapper for previews (mirror `invoke_generate_invoice_pdf`).
2. **Owner document studio UI** (spec PR 12) — over the Build-41 registry + e-sign backend.
3. **Invitee/client signing UI** (spec PR 13).
4. **Delivery / retention / reminders** (spec PR 14) — **GATED on the email sender domain**.
5. **Content PRs**: asset ingestion (spec PR 1 content step) + client/role packages (PRs 8–11) — **GATED on the 6 PDFs**.
6. **E2E smoke harness** (spec PR 15).

## 6. Owner-decision gates still open
- **6 approved PDFs** (content).
- **Accountant/SARS VAT sign-off** — no live charging/payment path may go live (success-fee, contractor reimbursement).
- **Email sender domain + funder billing contacts** — delivery flows (queue Builds 5/6/25, spec §10).
- **§4.2 sub-referrer money — RULED:** the 2026-08-12 spec **§4.2 supersedes** consolidation §2.4 — the Bright-Destiny sub-lead-referrer is deducted from **Bright Destiny's (Doctor's) share** (12–22%), not Thapelo's residual. Encode this in the Lead-Refer commission engine (Build 56 / PR #198) when it's built. **Doctor's earning is therefore reduced by a sub-referrer** under the new ruling.

## 7. Standing rules (from CLAUDE.md — do not drift)
- One logical build per PR → draft PR → wait for CodeRabbit/Gitar → **propose → owner-approve → fix** (even nitpicks) → **owner merges** → **single actor applies migration** → verify.
- Money server-side, `numeric(14,2)`; partner/contractor surfaces show their take only (S7C); funder anonymisation on partner surfaces.
- Migrations on populated tables: `NOT VALID` + `CREATE INDEX CONCURRENTLY` + `VALIDATE`. Every mutation checks its returned row (RLS fails silently).
- Attribution footer on every GitHub comment. Never push to a branch other than the one you're building.

---
*This session's branches: `claude/file-instructions-review-itj232` (e-sign + fix, merged), `claude/build-legal-source-assets` (#218, merged), `claude/build-success-fee-model` (#220, merged), `claude/build-legal-pdf-renderer` (#222, open), `claude/coordination-status` (#221, open), `claude/build-role-document-requirements` (#201, another session).*
