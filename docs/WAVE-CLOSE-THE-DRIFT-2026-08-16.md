# Build Wave — "Close the Drift" (opened 2026-08-16)

**Origin.** The full spec-vs-built audit (`docs/AUDIT-SPEC-VS-BUILT-2026-08-15.md`) found that the project's real risk is not missing features but **drift**: code merged and never applied, Edge Functions written and never deployed, functions running in production with no source in the repo, and planning documents diverged far enough from the live system to mislead.

**Goal of this wave.** Leave nothing known-broken, nothing merged-but-dead, and no document that lies. After this wave the roadmap can be trusted to plan from again.

**Standing rule reasserted for this wave:** a migration is not done when it merges — it is done when it is **applied and verified live**. Same for an Edge Function and `deploy`.

---

## Lane 1 — Repair (largely DONE 2026-08-15/16)

| # | Item | State |
|---|---|---|
| 1.1 | `/apply` — public contractor application | ✅ **DONE.** 3 migrations applied + `apply-submit-application` deployed. Verified end-to-end via `pg_net`: 400 on invalid payload, 200 + row + owner notification + audit row + confirmation email on a valid one. Test data removed. |
| 1.2 | `/team` application review controls | ✅ **DONE** (same migration — `move_application_to_screening`, `reject_application` now live). |
| 1.3 | `/client/documents` | ✅ **DONE.** `20260812193636_client_portal_secure_documents` applied. |
| 1.4 | `/contractor/progression` | ✅ **DONE.** `20260804130000` + `20260804130100` applied; existing contractors backfilled at Base. |
| 1.5 | Drawn/uploaded signatures | ✅ **DONE.** `20260815010000` applied — the signer-scoped storage policy is live, so the merged drawn-signature UI now actually works. |
| 1.6 | Authority & Consent (#232) | ✅ **DONE.** `20260813000000` applied; enum value live, 7th source key seeded (pending). |
| 1.7 | `/sign/:token` collision | 🔨 **IN THIS PR.** See Lane 2. |
| 1.8 | Contractor document checklist | ⬜ **REMAINING.** `20260810230000_contractor_document_checklist` (789 lines) merged, not applied. Not a broken screen — no frontend calls it yet — so it is deferred rather than urgent. |

### ⚠️ Behaviour change to be aware of (1.3)

`client_portal_secure_documents` narrows the **shared** `documents` bucket to `application/pdf`, `image/jpeg`, `image/png`, `image/webp`, max 20 MB. It was previously unrestricted. Existing documents are all PDF or PNG so nothing broke, but **the owner can no longer upload a Word or Excel file** to that bucket. If that matters for the 52-type taxonomy, widen `allowed_mime_types` — it is a one-line change.

---

## Lane 2 — Signing surface consolidation (this PR)

Two signing implementations existed simultaneously after PR #246 merged alongside the already-merged #241/#242 work. That merge:

- pointed `/sign/:token` at a page calling `open_signature_request_packet`, **which was never applied** → the signing surface was **broken in production**
- **regressed drawn and uploaded signatures** (the replacement was typed-only)
- left a second, unreachable signing page and a duplicate RPC in the tree

**Resolution — one surface, keeping the best of both:**

- `/sign/:token` returns to the fuller implementation: rendered markdown (not raw text in a `<pre>`), scroll-to-end gate before acknowledgements, consent recorded **as each box is ticked** rather than in a burst at signing, typed **+ drawn + uploaded** signatures, decline-with-reason, terminal-state explanations.
- **Kept from the retired page — its genuinely better idea:** the signing link is now **bound to the named account**. A linked party's link cannot be read or signed by a different logged-in user. This is enforced in `submit_agreement_signature`, not only on the read, because a read-only gate is decoration.
- **External signatories are unaffected by design:** the binding applies only when `profile_id` is set. A party with no platform account still signs on the token alone — asserted in the migration.
- **Also kept:** "Download a copy to keep". A signer who cannot retain the wording is relying on the counterparty's record of it.
- Retired: `AgreementSigningPage.tsx`, `lib/agreementSigning.ts`, and the unapplied `20260815193733_signing_packet_read.sql`.

**Lesson for the lane:** this collision happened because two agents built the same thing in the same week. The lane boundary in the handover (Codex owns the client portal; the legal/e-sign lane is separate) needs to be restated before the next parallel wave.

---

## Lane 3 — Edge Function reconciliation ⬜

| Function | Action |
|---|---|
| `submit-client-application` | Deploy |
| `create-client-invitation` | Deploy |
| `resolve-client-invitation` | Deploy |
| `generate-legal-document-pdf` | Deploy (needed by legal Build 9) |
| `ingest-legal-source-asset` | Deploy once its PR merges |
| `sign-invoice-url` | **Recover source into the repo** — runs in production, untracked |
| `ops-storage-remove` | **Recover source into the repo** — runs in production, untracked |
| `pdflibtest` | **Delete** — leftover experiment |

Three production functions with no source in version control cannot be reviewed, changed safely, or rebuilt after a loss. This is the highest-risk item left in the wave.

---

## Lane 4 — Make the documents true ⬜

1. **`CLAUDE.md`** — remove the "no deal is genuinely funded / `commission_records` is legitimately empty" note. It is wrong: `DEAL-013` reached `invoiced`, `INV-0032` is paid, one commission record is `settled` (R12,250 gross → R2,131.50 partner / R5,218.50 owner), and partner invoice `BD-0003` was paid on 2026-08-07.
2. **`ROADMAP.md`** — C4, D1/D2, F6 and C5/C6 are marked unbuilt but ship today; the contractor and client portals (23 pages) are absent from the phase plan entirely. Either reconcile the checkboxes or mark the phase plan superseded by the Sprint/Build-Queue documents.
3. **`AUDIT.md`** — supersede with the 2026-08-15 audit.
4. Record the migration-ledger caveat: **live ledger names diverge from filenames**, so "is it applied?" must be answered by querying for the objects, never by reading the ledger.

---

## Lane 5 — Verification harness ⬜ (recommended, new)

The drift was invisible because nothing checked for it. A single script, run before each session, would have caught every finding in the audit:

- every RPC the frontend calls exists live (this alone found all four broken screens)
- every repo migration's objects exist live
- every repo Edge Function is deployed
- every deployed Edge Function has source in the repo

Cheap to write, and it converts a recurring class of production breakage into a failing check.

---

## Exit criteria

- [ ] No frontend RPC missing from live
- [ ] No merged migration whose objects are absent (or an explicit, recorded reason)
- [ ] Every repo Edge Function deployed; every deployed function has source
- [ ] `CLAUDE.md` / `ROADMAP.md` match live reality
- [ ] One signing surface, identity-bound, with drawn signatures working

---

## What this wave deliberately does NOT touch

Still gated on the owner, unchanged by this wave:

| Gate | Blocks |
|---|---|
| **Approved legal PDFs** (7 source keys registered, all `pending`; 0 templates) | Legal Builds 5, 6, 9 |
| **Path-A tier base ruling** | PR #237 |
| **Email sender domain** | Legal Build 10 delivery |
| **Accountant / SARS VAT sign-off** | Live charging |
| **S7C PO-tier + R1M band** | Commission engine |

The **template-system ruling is now recorded** (Option 1, PR #243) — one gate closed. Uploading the PDFs is the single highest-value thing the owner can do next: three builds start the day they land.
