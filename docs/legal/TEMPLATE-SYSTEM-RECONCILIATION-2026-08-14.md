# Decision doc — Template-system reconciliation (client legal documents)

**Date:** 2026-08-14 · **Owner ruling required before:** Build 8 (the signing UI)
**Prepared by:** Claude (legal-documents / e-sign / role-onboarding lane)
**Audience:** owner (Thapelo) — with input needed from the Codex client-portal lane

---

## 1. The decision, in one sentence

There are two legal-document systems live in the codebase. Before the **signing UI (Build 8)** is built, we need one ruling: **which system is the source of truth for a *client's* legal documents (Mandate, NDA, Authority & Consent) — and therefore where the client actually signs.** Everything else follows from that.

This is not urgent to *build*, but it must be **decided** before Build 8, or we risk two parallel signing worlds and two "legal template" concepts for the same document.

---

## 2. The two systems (what actually exists live)

They were built by different lanes for different primary jobs. They are **not duplicates** — they solve different problems and happen to overlap on client legal docs.

| | **System A — "Official Forms"** (Codex / client backend) | **System B — "Legal Templates + E-Sign"** (this lane) |
|---|---|---|
| Primary job | **Generate** filled official/funder application PDFs from client + deal data | **Author, version, and E-SIGN legal agreements** with evidence |
| Template store | `official_form_templates` (`template_kind` = fnc / funder / **legal** / other) + `official_form_field_mappings` | `legal_document_templates` + `legal_document_template_versions` (versioned wording, publish/immutability, SHA-256) |
| Source of approved files | `official_form_templates.storage_path` + `content_sha256` | `legal_source_assets` (7 approved PDFs, hash-verified) + Build 4 ingestion |
| Rendered output | `generated_document_snapshots` (immutable filled snapshot) | `generate-legal-document-pdf` renderer (#222) |
| Signing engine | **none** — `client_legal_document_readiness` (#226) shows a client status card that says *"secure signing will open here when enabled"* | **full e-sign backend** (live): `agreement_instances` → `signature_requests` → append-only `signature_events` → `signature_artifacts` → `executed_document_artifacts` + `consent_records`, with the signing state machine + RPCs (send / open / submit-signature / countersign / decline / withdraw / expire / certificate) |
| Owner authoring UI | seeded via governed RPCs | the **Document Studio** (Build 7, live) |
| Client-facing surface | `client_legal_document_readiness` card in the client portal (Codex) | none yet (Build 8 would add the signing surface) |

**The overlap:** Codex's `#226` extended System A with `template_kind = 'legal'` and a `client_legal_document_readiness` table that *lists* the client's Mandate + Authority & Consent and shows a status (`preparing → ready_to_sign → client_signed → …`). But System A has **no signing mechanism** — the actual e-signature machinery only exists in **System B**.

---

## 3. Why it matters for Build 8

The signing UI needs to know, for a *client* Mandate / NDA / Authority & Consent:
- **Which template is authoritative** — the `official_form_templates(kind=legal)` row, or the `legal_document_templates` version?
- **What the "sign" button drives** — a new signing mechanism inside System A, or an `agreement_instance` in System B's e-sign backend?
- **What the client portal's readiness card reflects** — its own `client_legal_document_readiness` status, or the agreement's real signing state?

If we don't decide, we could build signing twice (once per system), keep two "legal template" concepts, and let the client's "ready to sign" card (System A) and the actual signed evidence (System B) drift apart.

---

## 4. Options

### Option 1 — **System B is canonical for all legal signing; System A stays for forms** *(recommended)*
Client legal documents (Mandate, NDA, Authority & Consent) are **legal agreements** → they live in `legal_document_templates` and are signed as `agreement_instances` through the live e-sign backend. `official_form_templates(kind='legal')` is **not** used for agreements; System A keeps doing what it's genuinely good at — filling **FNC / funder application forms**. Codex's `client_legal_document_readiness` card becomes a **projection of the agreement's state** (it reads System B).

- ✅ One purpose-built signing engine with POPIA-grade evidence (append-only events, consent, countersign, executed artifact, certificate) — already live, nothing to rebuild.
- ✅ One source of truth for legal wording (versioned registry + Studio + hash-verified sources + renderer).
- ✅ Clear split: **agreements → System B; forms → System A.**
- ⚠️ Requires a small coordination change in Codex's lane: re-point `client_legal_document_readiness` to read agreement state (or replace it with a read of `agreement_instances`).

### Option 2 — **System A canonical for client legal docs; System B only for role/onboarding agreements**
Client docs flow through `official_form_templates` + a signing mechanism **built into System A**; System B handles only partner/contractor/lead-referrer agreements.

- ✅ Keeps Codex's client portal self-contained.
- ❌ Requires **building a second signing engine** into System A (duplicating the live e-sign backend, its evidence model, consent, countersign) — or System A calls into System B anyway, which is Option 1 with extra indirection.
- ❌ Two "legal template" concepts persist; higher long-term divergence + maintenance.

### Option 3 — **Explicit retirement variant of Option 1**
Same as Option 1, but we also formally retire `template_kind='legal'` on `official_form_templates` (stop using it) so there is exactly one legal-template concept. Cleanest end-state; slightly more coordination with Codex up front.

---

## 5. Recommendation

**Option 1 (trending to Option 3 over time).**

Rationale: the e-sign backend, the versioned legal registry, the source-asset hash-verification, the Studio, and the renderer are **all already built around System B and purpose-designed for legal execution with evidence.** A client Mandate / NDA / Authority & Consent *is* a legal agreement — it belongs in the same engine as the partner/contractor/lead-referrer agreements, not in the form-generation system. System A (`official_form_templates` + `generated_document_snapshots`) is excellent at its real job — filling FNC/funder application forms — and should keep it. The only work Option 1 adds is a **coordination change with Codex** to make the client portal's readiness card reflect the agreement's true state instead of a parallel status.

**Net rule to lock:** *Legal **agreements** (client + role) → System B (`legal_document_templates` + e-sign). Official/funder **forms** → System A (`official_form_templates` + generated snapshots). The client portal reads agreement state; it does not run its own signing.*

---

## 6. What the ruling unblocks + who needs to coordinate

- **Unblocks Build 8** (signing UI over the live e-sign backend) — for client + role agreements alike.
- **Coordination with the Codex lane** (client portal owns `client_legal_document_readiness` and the client-facing surface): under Option 1, that card re-points to read `agreement_instances` state. This is a cross-lane change — it should be agreed, not done unilaterally by either lane.

## 7. Open sub-questions to settle alongside the ruling

1. **Client signing entry point:** does the client sign *inside* the client portal (Codex's surface, driven by System B), or via a standalone magic-link signing route (the "magic-link signing primitive" the audit map graded 🔴 missing)? Build 8 needs this.
2. **Readiness card ownership:** does `client_legal_document_readiness` stay as a Codex-owned projection of agreement state, or is it replaced by a direct read of `agreement_instances`?
3. **Role vs client scope of Build 8:** if the ruling is delayed, Build 8 can start on the **role/onboarding** agreements (partner/contractor/lead-referrer), which are unambiguously System B and touch no Codex surface — and add the client surface once this is settled.

---

*This doc decides nothing on its own — it exists so the owner can make one ruling (§5) and unblock Build 8. No code or schema is affected by this document.*
