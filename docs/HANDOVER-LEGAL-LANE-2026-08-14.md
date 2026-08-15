# FNC — Legal-Documents / E-Sign / Role-Onboarding Lane — Handover for the next CC (2026-08-14)

**Repo:** `maupatrades-cmd/fund-now-capital-2026` (main) · **Supabase project:** `hvxruwkgmhjoypepffgv`.
**Supersedes/extends:** `docs/HANDOVER-LEGAL-LANE-2026-08-12b.md` (#229) + `docs/legal/AUDIT-MAP-LEGAL-ESIGN-WAVE-2026-08-12.md` (read both; this doc is the newer state).

---

## 0. Your lane (do not cross it)

You own **only** the FNC **legal-documents, e-signing, and role-onboarding** lane. **Codex owns the client portal** (progress / profile / meetings / messages / documents / funding-offer). Don't build in Codex's area — but see §6, there is one live cross-lane decision (template systems).

## 1. Rules (non-negotiable — unchanged)

- **NO concurrent live apply.** Migration files ship **inside PRs only**; a **single actor applies after merge — NOT you**. (A concurrent apply on 2026-08-12 diverged the live ledger; that's why.)
- One logical build per PR → draft PR → wait for CodeRabbit/Gitar → **propose → owner-approve → fix** (even nitpicks) → **owner merges**. **Never auto-apply review findings.**
- Money server-side `numeric(14,2)`; **never recompute a locked commission**; partner/contractor surfaces show their take only (S7C); funder anonymisation on partner surfaces; **never invent legal clauses, rates, amounts, or hashes**.
- Migrations self-verify with rollback-on-failure assertion blocks (house pattern). Populated-table FKs: `NOT VALID` + `CREATE INDEX CONCURRENTLY` follow-up + `VALIDATE`.
- `tsc -b` + `oxlint` clean before pushing frontend. (Run `npm install` once — deps aren't checked in.)

## 2. What THIS session (2026-08-13/14) delivered

**Merged to `main`:**
- **#231** — corrected the audit-map (money-source ruling + stale grades). *(docs)*
- **#222** — **Build 2**: deterministic legal-document PDF renderer Edge Function `generate-legal-document-pdf` (fixed 3 Gitar + 3 CodeRabbit findings incl. the executed-hash integrity boundary → deferred to Build 9).
- **#232** — **Build 3**: Authority & Consent = 7th `legal_source_assets` key (`client_authority_and_consent`, owner-verified hash `c013c5d1…306df`) + `authority_and_consent` value on the `legal_document_type` enum.
- **#236** — **Build 7**: Owner **Document Studio** (`/settings/legal-studio`) over the live template + source-asset registries.

**Open drafts (yours to carry):**
- **#237** — **Build 1** forward-fix of #198 (lead-referrer engine): Path B unchanged; **Path A recognised but GATED** (`raise PATH_A_BASE_NOT_CONFIGURED`) — **⛔ needs the owner's Path-A base ruling** before the `TODO(owner-ruling)` is completed. Never rewrites #198; `commission_records` untouched.
- **#238** — **Build 4**: PDF ingestion — Edge Function `ingest-legal-source-asset` (server-side SHA-256 → `register_legal_source_asset` → optional source-backed version) + a "Verify" button in the Studio. Ready; runs when the PDFs land + the function is deployed.
- **#239** — decision doc: **template-system reconciliation** (recommends Option 1 — legal agreements → the e-sign system; forms → Codex's official-forms system). **Owner ruling unblocks Build 8.**

## 3. Already applied to live — DO NOT rebuild or re-apply (verified against live migrations)

e-sign evidence backend **#200/#214** · role-document-requirements **#201** · source-asset registry + 5 buckets + clause map **#218** · success-fee model **#220** · legal template registry (Build 41) · terms framework · Codex client-portal wave (through `20260813…`). The Document Studio (#236) is deployed (Vercel).

## 4. ⚠️ NOT yet applied / deployed (single-actor + owner, NOT you)

1. **Apply migration `20260813000000_authority_consent_source_key.sql` (#232)** — until then the `authority_and_consent` enum value is NOT live, so the Studio's "Authority & Consent Form" template-type option errors (this is the ONLY #236 defect; it self-resolves on apply). Confirmed absent from live migrations 2026-08-14.
2. **Apply `20260810240000` (#198 / Build 56) + `20260810250000` (#199 / Build 57)** — merged, NOT applied; parked behind the Path-A ruling. When applying: #198 → #237's forward-fix → #199, in order.
3. **Deploy Edge Functions:** `generate-legal-document-pdf` (#222) and, after #238 merges, `ingest-legal-source-asset`. No new secrets (auto-injected `SUPABASE_URL`/`ANON`/`SERVICE_ROLE`; the legal PDF fn also uses the existing `WEBHOOK_SECRET`).

## 5. Money model — CONFIRMED (do not re-litigate); one detail OPEN

- CRM carves the Lead-Referrer earning from **Thapelo's residual (`owner_share`) for BOTH paths** — never Doctor's `partner_share`, never FNC retention. #198 encodes this; keep it. The 12–22 % is contract text only.
- Tier ladder L1 25 / L2 35 / L3 40 / L4 50 %. **Path B works** (tier% of Doctor's `partner_share`, carved from `owner_share`).
- **⛔ OPEN — the Path-A base.** A Direct-FNC deal has no `partner_share`. What base does the Path-A LR's tier% apply to? Candidate: `SUM(owner_share)` (Thapelo's own take). **Do NOT invent it.** #237 raises `PATH_A_BASE_NOT_CONFIGURED` until the owner confirms; the exact plug-in point + the two schema sub-questions (no-Doctor commission_records shape; `doctor_partner_id` NOT NULL) are marked `TODO(owner-ruling)` in `20260814000000_lead_referrer_path_a_support.sql`.

## 6. Open gates / rulings (surface, don't guess past)

| Gate | Blocks | Notes |
|---|---|---|
| **7 approved PDFs uploaded** to `legal-source-approved` (owner, dashboard — no upload tool) | Builds 4→5/6/9 | The single biggest unblocker. #238 verifies them once up. |
| **Path-A tier base** ruling | Build 1 (#237) | §5. |
| **Template-system reconciliation** ruling | Build 8 (signing UI) | See #239. Recommendation: Option 1. Needs Codex coordination (their `client_legal_document_readiness` re-points to read agreement state). |
| **Email sender domain** linked | Build 10 (delivery) | External. |
| **Accountant/SARS VAT sign-off** | any live charging | Model buildable; going live gated. |

## 7. The remaining builds (all buildable machinery is done)

- **Build 5** — Client legal package (NDA + Mandate w/ live `deal_success_fees` + Authority & Consent). *Gated: PDFs.*
- **Build 6** — Role onboarding packages (partner / contractor / lead-referrer / sub-referrer) — uses live `role_document_requirements`. *Gated: PDFs.*
- **Build 8** — Signing UI (draw/type/upload, consent, decline, countersign, cert) over the live e-sign backend + the **magic-link signing primitive** (audit-map graded 🔴 — greenfield). *Gated: §6 template ruling. Can start on ROLE agreements first (no Codex overlap).*
- **Build 9** — Wire template snapshots + signatures → the renderer + private storage; **own the canonical executed artifact + atomic hash commit** (the #222 CodeRabbit deferral). *Gated: PDFs.*
- **Build 10** — Delivery / retention / reminders. *Gated: email domain.*
- **Build 11** — E2E legal + e-sign smoke harness. *After the above.*

## 8. Live surfaces + key objects (quick map)

- Registry: `legal_document_templates` + `legal_document_template_versions` (versioned, publish/immutable, SHA-256) + RPCs `create_legal_document_template` / `create_legal_template_version` / `submit_legal_template_version_for_review` / `publish_legal_template_version` / `supersede_legal_template_version`.
- Sources: `legal_source_assets` (7 keys) + `register_legal_source_asset` + `legal_template_clause_sources` + 5 private `legal-*` buckets.
- E-sign: `agreement_instances` → `signature_requests` → `signature_events` (append-only) → `signature_artifacts` → `executed_document_artifacts` + `consent_records`, RPCs `create_agreement_instance` / `add_agreement_party` / `set_agreement_variables` / `send_agreement` / `open`|`resolve_signature_request` / `record_agreement_consent` / `submit_agreement_signature` / `countersign_agreement` / `withdraw_agreement` / `decline_signature_request` / `expire_due_agreements`.
- Money (LR): `lead_referrer_commission_records` + `write_lead_referrer_commission` + tier helpers (Build 56, NOT applied).
- Owner UI: `src/pages/LegalStudioPage.tsx`, `src/hooks/useLegalStudio.ts`, `src/lib/legalTemplates.ts`.
- Renderer: `supabase/functions/generate-legal-document-pdf`. Ingestion: `supabase/functions/ingest-legal-source-asset` (in #238).

## 9. Watch state (this session's session)

Subscribed to **#237 / #238 / #239**; a fallback self check-in is armed (re-arms itself). If you're a fresh session, re-subscribe to any still-open PRs you intend to babysit.

## 10. Your first moves

1. Read #229, the audit-map, this doc, and #239 (reconciliation).
2. Ask the owner for the three rulings (§6) and whether the 7 PDFs are uploaded / migrations applied / functions deployed.
3. With a ruling in hand: complete **#237** (Path-A base) or start **Build 5/6** (once PDFs verify) or **Build 8** (role agreements first is safe without the template ruling).
4. Never invent legal wording, hashes, rates, or the Path-A base. When blocked, mark `GATED` and ask.

---

*Clean take-over point. All buildable-without-ruling machinery is shipped; what remains needs owner uploads/applies/rulings.*
