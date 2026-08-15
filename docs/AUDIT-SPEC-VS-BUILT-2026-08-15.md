# FNC CRM — Full Build Audit: Spec vs Reality (2026-08-15)

**Method.** Every claim below was verified against the **live database** (project `hvxruwkgmhjoypepffgv`) and the repository at `main` — not against the planning documents. Where the docs and the live system disagree, the live system wins and the disagreement is itself recorded as a finding.

**What was checked:** all 10 root spec documents + 17 `docs/` documents · 166 migration files vs the live migration ledger *and* live object existence · 96 live tables · 89 distinct RPCs called by the frontend · 83 page components across 5 role surfaces · 14 repo Edge Functions vs 11 deployed · 4 cron jobs · live row counts.

**Not checked:** runtime behaviour, RLS correctness under each role, and UI rendering. This audit proves *presence and absence*, not *correctness*.

---

## 1. Headline: the planning docs are materially out of date

The single most important fact in the project is wrong in `CLAUDE.md`.

> `CLAUDE.md` states: *"No deal is GENUINELY funded yet — commission_records is legitimately empty (0 rows)."*

**The live database disagrees.** The entire money chain has run end-to-end:

| Evidence | Live value |
|---|---|
| `DEAL-013` | stage `invoiced` |
| `funder_invoices` INV-0032 | state `paid` |
| `commission_records` | **1 row, state `settled`** |
| — gross commission | R12,250.00 |
| — company retention (40%) | R4,900.00 |
| — partner pool (60%) | R7,350.00 |
| — partner share (29% tier) | R2,131.50 |
| — owner share | R5,218.50 |
| `partner_invoices` BD-0003 | `paid`, R2,131.50, 2026-08-07 |

The commission engine, the funder-invoice lifecycle, the funded trigger, the earned→outstanding→payable→settled cascade, and partner invoicing all **ran on real data and produced arithmetic that sums correctly**. That is the project's biggest milestone and it is recorded nowhere in the specs.

**Consequences of the stale docs:**

- `ROADMAP.md` marks **C4 (Doctor invoicing)** as `⬜ not built`. It is built, and it has been paid out.
- `ROADMAP.md` marks **D1/D2 (partner portal)** as `⬜`. Nine partner pages exist and ship.
- `ROADMAP.md` marks **F6 (gamification)** as `⬜`. Badges are live (10 rows) with pages in two portals.
- `ROADMAP.md` marks **C5/C6 (statements, reports)** as `⬜`. Both have live pages and RPCs.
- The **contractor portal (12 pages) and the client portal (11 pages) do not appear in the phase plan at all** — they arrived through the Sprint / Build-Queue documents, which were never reconciled back into the roadmap.

**Recommendation:** treat `ROADMAP.md`'s phase checkboxes as unreliable. Reconcile them against Section 5 of this document before using them to plan.

---

## 2. Merged code that never reached the live database

This is the most consequential category. These migrations are **merged to `main`** but their objects **do not exist live** — verified by querying for the tables and functions themselves, not by trusting the migration ledger (the ledger's names diverge from filenames often enough to be untrustworthy on its own).

| # | Migration | Missing live objects | Impact |
|---|---|---|---|
| 1 | `20260803140000/140100/140200_contractor_application*` | `contractors`, `contractor_applications`, `contractor_application_attempts`, `submit_contractor_application` | **`/apply` is dead** (§3) |
| 2 | `20260804130000/130100_contractor_progression` | `get_contractor_progression`, `owner_promote_contractor` | **`/contractor/progression` is dead** |
| 3 | `20260810230000_contractor_document_checklist` | `contractor_documents`, `contractor_upload_document`, `contractor_document_checklist_status` | Contractor doc checklist unavailable |
| 4 | `20260810240000_lead_referrer_commission_engine` (#198) | `lead_referrer_commission_records`, `calculate_lead_referrer_earning`, `write_lead_referrer_commission` | Known — parked behind the Path-A ruling |
| 5 | `20260810250000_doctor_my_network` (#199) | network RPCs | Known — parked with #198 |
| 6 | `20260812193636_client_portal_secure_documents` | `client_portal_document_workspace`, `register_client_portal_document` | **`/client/documents` is dead** |
| 7 | `20260813000000_authority_consent_source_key` (#232) | `authority_and_consent` enum value | Document Studio option errors |
| 8 | `20260815010000_signature_artifact_signer_storage` | signer storage policy | Expected — PR #242 not yet merged |

Items 1, 2, 3 and 6 are **not** gated on any decision. They appear to have been merged and then simply never applied.

---

## 3. Broken screens — UI shipped, backend absent

Four surfaces call RPCs or Edge Functions that do not exist live. These will fail at runtime for any user who reaches them.

### 3.1 `/apply` — public contractor application (worst of the four)

Fails on **two** independent counts:

- calls Edge Function `apply-submit-application`, which **is not deployed**
- depends on `contractor_applications` / `submit_contractor_application`, which **do not exist live**

This is the public front door described in `ONBOARDING.md` Stage 1. It is unauthenticated, linkable, and completely non-functional. Anyone sent to it fills in the form and gets an error.

### 3.2 `/client/documents`
`ClientDocumentsPage.tsx` calls `client_portal_document_workspace` and `register_client_portal_document` — neither exists live.

### 3.3 `/contractor/progression`
`useContractorProgression.ts` calls `get_contractor_progression` — absent.

### 3.4 `/team` — application review controls
`useApplications.ts` calls `move_application_to_screening` and `reject_application` — both absent.

**The other 83 of 89 frontend RPCs resolve correctly against live.** The failure is concentrated, not systemic.

---

## 4. Edge Function drift

| In repo, NOT deployed | Consequence |
|---|---|
| `apply-submit-application` | breaks `/apply` (§3.1) |
| `submit-client-application` | client application intake |
| `create-client-invitation` | client invitations |
| `resolve-client-invitation` | client invitations |
| `generate-legal-document-pdf` | legal renderer (known, PR #222) |
| `ingest-legal-source-asset` | PDF verification (expected, PR #238 unmerged) |

| Deployed, NOT in repo | Note |
|---|---|
| `sign-invoice-url` | untracked — no source in version control |
| `ops-storage-remove` | untracked ops utility |
| `pdflibtest` | leftover experiment — recommend deleting |

Three live functions have **no source in the repository**. If they are load-bearing, they cannot be reviewed, changed safely, or rebuilt after a loss.

---

## 5. What is genuinely built and live

### Phase A — Core spine ✅ complete
Auth, owner dashboard, funder panel (24 funders), client database, pipeline kanban + deal detail + calculators, activity logging (135 rows), in-app notifications (24), Resend email. A13 (WhatsApp paperwork) remains external.

### Phase B — Data foundations ✅ complete
Industries (225 sub-industries, 51 appetite rows), leads + qualification, document management with the 52-type taxonomy + versioning + verification + expiry cron, client story + call logs, SA validation + duplicate detection, stakeholders.

### Phase C — Money operations ✅ **further than documented**
- **C0** funder rate structures — live, 6 rate rows
- **C1** funder invoicing — live and **proven** (INV-0032 paid)
- **C2** commission records — live and **proven** (1 settled record)
- **C3** partner earnings — owner-side view only; the S8 `doctor_earnings` lifecycle is genuinely not built
- **C4** partner invoicing — **live and proven** (BD-0003 paid) — *roadmap wrongly says not built*
- **C5/C6/C7** statements, reports, owner home — pages exist; depth not audited

### Built outside the phase plan
Terms & conditions framework (2 acceptances), payee payment profiles (0 profiles), contractor invoicing backend, repayments, payouts, owner tasks, deal archive, deal packaging, training platform (6 modules), gamification badges (10), global search, client portal (11 pages), contractor portal (12 pages), lead-referrer portal (2 pages).

### E-signing lane
E-sign evidence backend (12 RPCs, append-only ledger) · legal template registry · source-asset registry · Document Studio · **signing surface** (`/sign/:token`, live as of today) · **owner dispatch UI** + **drawn/uploaded signatures** (PR #242, awaiting merge).

### Phases D, E, F
Phase D is largely superseded by portals built out of order. **Phase E is essentially untouched** — no Gmail integration, no AI features, no nurture automation, no funder form auto-fill. **Phase F is untouched** except global search (F1) and gamification (F6), both shipped early.

---

## 6. Gates still closed

| Gate | Blocks | State |
|---|---|---|
| **Approved legal PDFs** | Builds 5/6/9 in the legal lane | 6 source keys registered, **all `pending`** — none verified. `legal_document_templates` = **0**. The legal lane has no approved wording. |
| **Path-A tier base ruling** | PR #237 | Open |
| **Template-system reconciliation** | Build 8 client-side | Open (PR #239 recommends Option 1) |
| **Email sender domain** | Build 10 delivery | Open |
| **Accountant/SARS VAT sign-off** | live charging | Open |
| **S7C PO-tier + R1M band ruling** | commission engine | Open |
| **A13 WhatsApp verification** | Phase D notifications | External, in progress |

---

## 7. Recommended order of work

1. **Deploy `apply-submit-application` and apply the contractor-application migrations.** The public front door is broken; this is the only finding a stranger can hit.
2. **Apply the other four ungated migration clusters** (contractor progression, contractor document checklist, client portal secure documents, authority & consent) — this repairs three more dead screens.
3. **Deploy the remaining repo Edge Functions**, and get `sign-invoice-url` / `ops-storage-remove` into version control. Delete `pdflibtest`.
4. **Reconcile `CLAUDE.md` and `ROADMAP.md` with live reality** — starting with the funded deal and the settled commission.
5. **Upload and verify the legal PDFs**; it unblocks the largest remaining body of work.
6. **Give the three open rulings** (Path-A base, template system, S7C tiers).

---

## 8. Overall assessment

The **core CRM is in good shape**. Phases A and B are genuinely complete, and Phase C is further along than any document claims — the money loop has been proven end-to-end on real data, which is the hardest thing in the system to get right.

The real risk is **not missing features — it is drift**. Code is being merged and then not applied; Edge Functions are being written and not deployed; functions are running in production with no source in the repository; and the planning documents have diverged far enough from the live system that they now mislead rather than guide. Four user-facing screens are broken today purely because of that gap, not because anyone failed to build them.

Every one of those four screens is fixed by applying code that already exists and has already been reviewed.
