# Audit Map — Legal Documents / E-Signing / Role Onboarding Wave

**Spec:** `FNC-CANONICAL-LEGAL-DOCUMENTS-ESIGN-ONBOARDING-SPEC-2026-08-12.md`
**Produced:** 2026-08-12 · **Required by:** spec §19 (audit map before any code)
**Method:** read-only sweep of all 135 live migrations under `supabase/migrations/`.
**Owner ruling recorded — ⚠️ SUPERSEDED, see §0 CORRECTIONS (C1) below:** ~~the 2026-08-12 spec §4.2 supersedes consolidation §2.4 — the Bright-Destiny sub-lead-referrer deduction comes from Bright Destiny's (Doctor's) share, not Thapelo's residual.~~ → **Corrected:** the CRM carves the Lead-Referrer earning from **Thapelo's residual (`owner_share`) for BOTH paths** — never from Doctor's share. The 12–22% is contract text only, not the CRM calc. Build 56 / PR #198 already encodes this; keep it.

> Purpose: so the 15-PR wave **extends canonical objects** instead of forking parallel ones (spec §11/§19). Every capability below is graded against what is already live.

---

## 0. CORRECTIONS (post-dated — read before the table)

*Added 2026-08-13. This map was written 2026-08-12 as a read-only snapshot. Some capabilities were built + applied to live **later the same day**, and the money-source ruling was reversed afterward. §1's table is a point-in-time artifact and is stale where noted here. **Where this section conflicts with anything below it, THIS section wins.***

**C1 — Money source (corrects the "Owner ruling recorded" line above).** Final owner ruling (2026-08-12b handover, PR #229): the CRM carves the Lead-Referrer earning from **Thapelo's residual (`commission_records.owner_share`) for BOTH Path A and Path B** — never from Doctor's/Bright Destiny's share, and never from FNC's 40 % retention. The 12–22 % contract figure is agreement text only, not the CRM calc. **Build 56 / PR #198 already encodes exactly this — keep it; forward-fix only, never rewrite it, leave `commission_records` untouched.** The one open money detail is the **Path-A tier base** (a Direct-FNC deal has no `partner_share`), which the owner must confirm before Build 56's Path-A support is coded — do not invent it.

**C2 — Machinery grades in §1 are stale (built + applied to live the same day this map was written).** Verified against the live migration list 2026-08-13. Do **NOT** rebuild any of these — extend them:

| §1 row | Was | Actual | Live migration (PR) |
|---|---|---|---|
| 1 `legal_source_assets` | 🔴 | 🟢 BUILT + LIVE (+ `legal_template_clause_sources`, `register_legal_source_asset`, `set_template_clause_source`, 5 `legal-*` buckets) | `legal_source_assets_buckets` (#218) |
| 4 clause→source map | 🔴 | 🟢 BUILT + LIVE (`legal_template_clause_sources`) | same (#218) |
| 5 `role_document_requirements` | 🔴 | 🟢 BUILT + LIVE (+ `resolve_role_document_package`, owner setters) | `role_document_requirements` (#201) |
| 7–13 agreement / signature / executed / consent | 🔴 | 🟢 BUILT + LIVE — `agreement_instances`, `agreement_party_snapshots`, `agreement_variable_snapshots`, `signature_requests`, append-only `signature_events`, `signature_artifacts`, `executed_document_artifacts`, `consent_records` + server-controlled state machine (client cannot set `executed`) + full RPC surface (`create_agreement_instance`, `add_agreement_party`, `set_agreement_variables`, `send_agreement`, `open`/`resolve_signature_request`, `record_agreement_consent`, `submit_agreement_signature`, `countersign_agreement`, `withdraw_agreement`, `decline_signature_request`, `expire_due_agreements`) | `esign_evidence_backend_schema` / `_rpcs` + `esign_backend_rpc_fixes` (#200, #214) |
| success-fee model (§1 extra row) | 🔴 | 🟢 BUILT + LIVE — `deal_success_fees` + `success_fee_method` / `percentage_base` / `vat_treatment` enums + `set` / `freeze` / `summary` RPCs + immutable-after-freeze trigger | `deal_success_fees` (#220) |

Net effect: the **machinery half** of the wave (this map's §7 recommended PRs A/B/C/D + spec PR 7) is **already live**. Remaining: the money-model Path-A fix (gated on the base ruling), the PDF renderer (#222 — still a draft), content ingestion once the approved PDFs land, the onboarding + client packages, the owner + signing UIs, delivery/retention (email-domain gated), and the E2E smoke harness.

**C3 — Two merged migrations are NOT yet applied to live** (confirmed absent from the live migration list 2026-08-13): Build 56 / PR #198 (`lead_referrer_commission_engine`) and Build 57 / PR #199 (`doctor_my_network`, which depends on #198's table). They sit in `main` awaiting the single-actor apply after the Path-A ruling — the next apply must land #198 + its forward-fix before #199.

---

## 1. Capability coverage table

Legend: 🟢 EXISTS (reuse, do not rebuild) · 🟡 PARTIAL (extend the named object) · 🔴 MISSING (greenfield)

| # | Spec capability (§11) | Grade | Live object / gap |
|---|---|---|---|
| 1 | `legal_source_assets` (source PDF hashes + provenance) | 🔴 | No registry table. Nearest = `legal-template-sources` bucket + `content_sha256`/`source_storage_path` cols on template versions. Need a proper source-asset registry. |
| 2 | `legal_document_templates` (template identity) | 🟢 | **`legal_document_templates`** (Build 41, `20260810210000`). |
| 3 | `legal_template_versions` (immutable published content) | 🟢 | **`legal_document_template_versions`** — versioned, SHA-256, `is_current`, self-FK supersession, publish/immutability triggers. |
| 4 | `legal_template_clause_sources` (clause→source map) | 🔴 | None. Content is whole-document markdown/file; no clause-level decomposition. |
| 5 | `role_document_requirements` (per-role activation package + parent-partner hierarchy) | 🔴 | None. `document_requirement_rules` exists but is **product/funder/deal-scoped, not role-scoped**, and does not gate activation. |
| 6 | `commercial_schedule_versions` (owner-versioned schedules + per-event snapshot) | 🟡 | `funder_commission_structures` (effective-dated, per-submission `applied_rate_snapshot`) + versioned legal registry with a `commission_schedule` doc-type. No single named-schedule version entity bound to emitted events. |
| 7 | `agreement_instances` (draft/sent agreement) | 🔴 | None. Build 41 header explicitly defers to "Builds 42–55". |
| 8 | `agreement_party_snapshots` | 🔴 | None. |
| 9 | `agreement_variable_snapshots` (frozen variables + fee) | 🟡 | `generated_document_snapshots.{source_values,mapping}_snapshot` freezes rendered values — but for FNC/funder **form generation**, not a signed agreement instance. |
| 10 | `signature_requests` | 🔴 | None. |
| 11 | `signature_events` (append-only) | 🔴 | None. |
| 12 | `signature_artifacts` (private) | 🔴 | None. |
| 13 | `executed_document_artifacts` (executed PDF + cert) | 🔴 | None. `generated_document_snapshots` is an immutable *render*, not an *execution*. |
| 14 | `consent_records` (per-agreement consent + notices) | 🟡 | `terms_acceptances_ledger` is an immutable versioned WHO/WHICH/WHEN/IP-hash ledger — reuse the **pattern**, but it is platform-T&C-scoped, not per-agreement, and not signing-linked. |
| 15 | `operator_undertakings` (POPIA operator) | 🔴 | None (prose only). |
| 16 | `document_delivery_events` (delivery/download evidence) | 🟡 | No agreement-delivery table. `funder_invoice_dispatch_ledger` (`20260807221000`) is a delivery-evidence **pattern** to copy. |
| 17 | `document_access_events` (access audit) | 🔴 | None for agreements (only client-login magic-link audit, which is auth). |

**Additional capabilities the spec assumes (outside the §11 table):**

| Capability | Grade | Live object / gap |
|---|---|---|
| Role/user enum (all 6 personas) | 🟢 | `user_role` = `owner, partner, contractor, client, lead_referrer` (5 DB roles; "partner sub-lead referrer" is modelled as `lead_referrer` + `partner_lead_referrers` hierarchy, not a 6th enum value). |
| Path-B lead-referrer ↔ partner attribution | 🟢 | `partner_lead_referrers` + `lead_attribution_events` + `leads.attributed_to_lead_referrer_id` + `owner_lock_lead_attribution()` (`20260810034500`). |
| R100 complete-document reward (lock-once, 22nd cutoff, sub-referrer vs partner attribution) | 🟢 | `complete_document_reward_locks` + `owner_lock_complete_document_reward()` (`20260810075057`). Do **not** rebuild. |
| Terms versions + acceptance ledger | 🟢 | `terms_versions` + `terms_acceptances_ledger` + `terms_config` + `accept_terms`/`get_current_terms_for_role`/`check_user_has_accepted_current`. |
| Product/funder required-document checklist resolver | 🟢 | `funding_product_catalog` + `document_requirement_rules` + `deal_document_rule_contexts` + `client_document_checklist(deal_id)` (`20260810042037`). PO-finance→`purchase_order` is expressible (rules not yet seeded). |
| Document taxonomy + verification | 🟢 | `document_type` enum (~55 vals incl. `purchase_order`), `documents` table, `document_verification_status` + `set_document_verification()`. |
| Success-fee / mandate model (`fee_method`, `percentage_base`, `vat_treatment`, `tail_period`, immutable-after-send) | 🔴 | Zero matches. All fee modelling is FNC↔funder / FNC↔partner/contractor. No client-facing mandate/success-fee object. |
| Account-provisioning invitation (mints partner/contractor/lead_referrer/client accounts) | 🟡 | `client_invitation_tokens` is single-use, hash-only, revocable, DEFINER-consumed — but only drives the `/apply` **client** intake; no `invited_role`, no account minting, no email/magic-link binding. |
| Magic-link signing primitive | 🔴 | None. Only a client-login magic-link audit exists (auth, not signing). |
| PDF render pipeline | 🟡 | Invoice PDF edge-functions exist (`generate-invoice-pdf`, `generate-contractor-invoice-pdf`) as the **pattern**; no legal-document renderer. |
| The 5 legal buckets (`legal-source-approved`, `legal-generated-drafts`, `legal-executed`, `legal-signature-artifacts`, `legal-evidence-certificates`) | 🔴 | All 5 missing. Only `legal-template-sources` exists. Private-bucket + owner-scoped RLS pattern is established. |

---

## 2. Do NOT rebuild (already canonical)

Template registry (Build 41) · terms versions + acceptance ledger + owner terms admin · R100 reward engine · invite-token + event analytics primitives · lead-referrer/partner attribution hierarchy · the 6-persona role model · product/funder document-requirement rules + checklist resolver · document taxonomy + verification · commission/bonus/invoice ledgers (`commission_records`, `bonus_records`, `funder_invoices`, `partner_invoices`, `contractor_invoices`) · funder rate config (`funder_commission_structures` + `funder_rate_at()`).

## 3. Reusable patterns (copy the mechanics, don't duplicate the objects)

- **Immutable append-only ledger + DEFINER-only writes** → `terms_acceptances_ledger`, `complete_document_reward_locks`.
- **Immutable rendered-snapshot** → `generated_document_snapshots`.
- **Delivery-evidence ledger** → `funder_invoice_dispatch_ledger`.
- **Publish-freeze version chain** → `legal_document_template_versions`.
- **Effective-dated config + per-event snapshot** → `funder_commission_structures` + `applied_rate_snapshot`.
- **Private bucket + owner-scoped `storage.objects` RLS + assertion** → `legal-template-sources`.
- **Hash-only single-use token + event ledger** → `client_invitation_tokens` / `client_invitation_events`.

## 4. Genuinely greenfield (safe to build without duplicating)

`legal_source_assets` · `legal_template_clause_sources` · `role_document_requirements` (role-scoped, parent-partner-aware) · `agreement_instances` · `agreement_party_snapshots` · agreement-scoped `agreement_variable_snapshots` · `signature_requests` · `signature_events` · `signature_artifacts` · `executed_document_artifacts` · per-agreement `consent_records` · `operator_undertakings` · agreement `document_delivery_events` · `document_access_events` · client mandate **success-fee model** · **account-provisioning invitation** (add `invited_role` path) · **magic-link signing primitive** · the **5 legal storage buckets** · a **legal-document PDF renderer**.

---

## 5. Spec's 15-PR wave, re-graded against reality

| PR | Spec build | Reality | Blocked by |
|---|---|---|---|
| 1 | Asset ingestion + provenance | 🔴 build `legal_source_assets` + 5 buckets — **content step needs the 6 PDFs** | **PDFs absent** |
| 2 | Template/version schema | 🟢 ~80% done (Build 41). Only add clause_source map (+ source-asset link) | — |
| 3 | Role document requirements | 🔴 greenfield (role-scoped; reuse rule pattern) | — |
| 4 | Commercial schedule + success-fee composer | 🔴 success-fee model greenfield; 🟡 schedule versioning | live charging needs **accountant VAT sign-off** (model itself buildable) |
| 5 | Variable mapping + validation | 🟡 reuse `official_form_field_mappings` + `sa-validation.ts` | — |
| 6 | Deterministic PDF renderer | 🟡 reuse invoice-PDF edge-fn pattern | render of real clauses needs **PDFs** |
| 7 | E-sign evidence backend | 🔴 fully greenfield — the core machinery | — |
| 8 | Client legal package | 🔴 depends on PR 7 + dispatch gate (`deal_package_dispatches` exists) | **PDFs** (clause content) |
| 9–11 | Referrer / contractor / partner packages | 🔴 depend on templates + PR 7 | **PDFs** |
| 12 | Owner document studio (UI) | 🔴 greenfield UI over Build 41 + PR 7 | — |
| 13 | Invitee/client signing UI | 🔴 greenfield UI over PR 7 | — |
| 14 | Delivery / retention / activity | 🟡 reuse dispatch-ledger + `activity_logs` | email domain for delivery |
| 15 | Security + E2E smoke harness | 🔴 new | after 1–14 |

---

## 6. Blockers / gates (what stops which work)

1. **Six approved source PDFs are absent from the workspace** (`docs/legal/source-approved/` does not exist; repo-wide PDF search = 0). Hard-blocks every **content-bearing** step (PR 1 ingestion, PR 6 real render, PRs 8–11 packages). Machinery does not need them.
2. **§4.2 vs §2.4 money conflict** — RESOLVED by owner: **§4.2 governs**. Unblocks the commission-engine encoding.
3. **Accountant/SARS VAT sign-off** — no production payment/charge path goes live without it (success-fee charging, reimbursements). The *model* is buildable; going *live* is gated.
4. **Email sender domain + funder billing contacts** — gates delivery flows (spec §10; queue Builds 5/6/25).

## 7. Recommended buildable-now sequence (no PDFs, no invented content)

Per spec §3.2, Claude may build "document, invitation, signature, storage, gate, audit, and renewal **machinery**" — only clause *content* must come from the approved PDFs. So the machinery half of the wave is buildable now, one PR per build:

1. **PR A — E-sign evidence backend (spec PR 7):** `agreement_instances` + `signature_requests` + append-only `signature_events` + `signature_artifacts` + `executed_document_artifacts` + `consent_records` + the signing state machine (`draft→…→executed`, server-controlled, client cannot set `executed`). Highest-value greenfield; unblocks 8–13.
2. **PR B — Role document requirements (spec PR 3):** role-scoped `role_document_requirements` + parent-partner hierarchy + resolver, reusing the `document_requirement_rules` mechanics.
3. **PR C — Source-asset registry + 5 legal buckets + clause-source map (spec PRs 1-schema + 2-gap):** everything except ingesting the actual PDF bytes; ingestion runs the moment the PDFs land + hash-verify.
4. **PR D — Client mandate success-fee model (spec PR 4):** `fee_method`/`percentage_base`/`vat_treatment`/`tail_period`, immutable-after-send. Model only; live charging stays gated on accountant sign-off.

**Then, when the 6 PDFs are uploaded + hash-verified:** PR 1 ingestion → template versions → PRs 6/8–11 real packages → PRs 12–13 UI → PR 14 delivery → PR 15 harness.

---

*End of audit map.*
