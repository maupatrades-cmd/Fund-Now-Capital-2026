# FNC — Legal-Documents / E-Sign / Role-Onboarding Lane — Handover for the next CC (2026-08-12b)

**Repo:** `maupatrades-cmd/fund-now-capital-2026` (main) · **Supabase:** `hvxruwkgmhjoypepffgv`.
**Supersedes/extends:** `docs/SESSION-HANDOVER-2026-08-12-legal-wave.md` (PR #223). Read that + `docs/legal/AUDIT-MAP-LEGAL-ESIGN-WAVE-2026-08-12.md` too.

## 0. Your lane (do not cross it)
You own **only** the FNC **legal-documents, e-signing, and role-onboarding** lane. **Codex owns the client portal** (progress, profile, meetings, messages, documents, funding-offer) — do not build in that area.

## 1. Rules (non-negotiable)
- **NO concurrent live apply.** Create reviewed migration files **inside PRs only**. A **single actor applies after merge**, coordinated separately — **not you**. (A concurrent apply on 2026-08-12 diverged the live ledger from the schema; that's why this rule exists.)
- One logical build per PR → draft PR → wait for CodeRabbit/Gitar → **propose → owner-approve → fix** (even nitpicks) → **owner merges**.
- Money server-side `numeric(14,2)`; **never recompute a locked commission**; partner/contractor surfaces show their take only (S7C); funder anonymisation on partner surfaces; **never invent legal clauses, rates, or amounts**.
- No local Postgres / no preview branch (replay dies on `20260802043750`). Migrations self-verify via rollback-on-failure assertion blocks.

## 2. Already applied to live — DO NOT rebuild or re-apply
e-sign evidence backend **#200** (`20260812090000/090100`) + 4-bug fix **#214** (`200000`); role-document-requirements **#201** (`093000`); source-asset registry + 5 private buckets + clause map **#218** (`210000`); success-fee model **#220** (`220000`); codex wave **#203–#211 + #155205**.

## 3. The 11-build lane plan (ordered; one independent PR each)
1. **Correct Build 56 / #198** lead-referrer engine — **money model CONFIRMED, see §4 below.**
2. **PR #222 renderer** — complete reviewer fixes + prepare deployment (Edge Function `generate-legal-document-pdf`; not deployed).
3. **Authority & Consent** as the **7th** approved source registry key + `legal_document_type` value.
4. **Ingest the 7 approved PDFs** into immutable versioned legal templates — **no inventing or rewriting their legal wording** (§2.1 production cleaning: strip DRAFT banners, map clauses, blanks → governed variables).
5. **Client legal package** — NDA + Mandate (owner-selected % or flat fee, from the live `deal_success_fees` model) + Authority & Consent.
6. **Onboarding packages** — Partner, Contractor, Lead Referrer, Sub-Lead-Referrer (uses live `role_document_requirements`).
7. **Owner Document Studio** UI.
8. **Invitee/client signing UI** — draw/type/upload signature, consent, decline, countersign, evidence certificate (over the live e-sign backend).
9. **Connect** template snapshots + signatures to the deterministic PDF renderer + private storage.
10. **Delivery/retention/reminder** readiness — external **email sending stays GATED until the sender domain is approved**.
11. **Legal onboarding + e-sign E2E smoke harness.**

## 4. BUILD 1 — CONFIRMED money model (owner ruling, 2026-08-12) — read carefully
**#198 is MERGED** (migration `20260810240000_lead_referrer_commission_engine.sql`) but **NOT applied to live.**

- **CRM money source = Thapelo's residual (`owner_share`) for BOTH paths. DO NOT deduct from Doctor's share.** #198 already carves the LR earning out of `owner_share`, leaving Doctor's `partner_share` and FNC's `company_retention` untouched — **keep that.** (The original Build-1 wording "deduct from Doctor's share" was **retracted** by the owner.)
- **The 12–22% figure is CONTRACT / legal-agreement text ONLY — it is NOT the CRM calculation.**
- **Both paths earn, via the tier ladder (L1 25% / L2 35% / L3 40% / L4 50% by closed-deal count), carved from Thapelo's residual:**
  - **Path B** (sub-lead-referrer, `profiles.sourced_via_partner_id` = a Doctor/partner): tier% of Doctor's earning (`partner_share`), carved from `owner_share`. **✅ #198 already does this — leave it.**
  - **Path A** (direct FNC lead referrer, `sourced_via_partner_id = null`): **#198 currently REJECTS Path A** ("Lead referrer is Path A … no LR commission"). **The change = SUPPORT Path A too**, also carved from Thapelo's residual.
- **⚠️ OPEN money detail — confirm with the owner BEFORE coding Path A:** a Direct-FNC deal has Thapelo at 100% (no partner/`partner_share`). **What base does the Path-A LR's tier% apply to?** (Most likely tier% of Thapelo's own commission/`owner_share` on that deal.) **Get the owner's exact base before encoding — do not invent it.**
- **Implementation:** a **forward-fix migration** (do NOT rewrite merged #198; PR only, no live apply). Keep `commission_records` untouched (never recompute the locked partner engine). Extend `write_lead_referrer_commission` to handle Path A (drop the Path-A rejection; add the confirmed Path-A base). Preserve the S7C-safe `lead_referrer_my_earnings` view (LR sees only their own Rand figure).

## 5. Content status — the 7 approved PDFs (all hash-verified)
All **6 seeded source PDFs are uploaded and SHA-256-verified** against the #218 registry: `contractor_service_agreement`, `client_nda`, `client_mandate_letter`, `bright_destiny_referral_partner_agreement`, `lead_referrer_service_agreement`, `lead_referrer_nda`. Plus a **7th — the Authority & Consent Form** (verified content, hash `c013c5d129f44d637c785924fef13ef737ccb25d2869590df9c6157642f306df`) which is **not yet a registry key** (that's Build 3).
The PDFs are at `/root/.claude/uploads/15ebc158-…/` (this session only — re-obtain from the owner). **Bytes are NOT yet in the `legal-source-approved` bucket** — there is no Supabase storage-upload MCP tool; the owner uploads via the dashboard, or Build 3/4 includes a small upload Edge Function. **No templates built yet.**

## 6. Open PRs (this lane)
#221 coordination doc · #222 PDF renderer · #223 handover · this handover.

## 7. Open gates
6 PDFs ✅ done · **accountant/SARS VAT sign-off** (no live charging path) · **email sender domain** (delivery flows) · **Path-A LR base** (§4 above).
