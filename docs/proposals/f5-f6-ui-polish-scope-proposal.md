# Phase F5 + F6 — UI Polish Scope Proposal

> **Status:** DRAFT for owner review · authored 2026-07-28 by NEW CC 2 · scoping only, no build.
> **Sources:** ROADMAP F5/F6 · SPEC S14 (Celebrations & Rewards), S13 (F5 PWA), S11 (Doctor's Portal) ·
> existing infra `src/lib/celebration/ConfettiProvider.tsx`, PriorityGlow, S4 notification events.
> **Nothing here changes SPEC/CLAUDE/ROADMAP** — those stay owner/other-lane edits.

---

## 1. What these two are (and what they are NOT)

Two **independent** Phase-F items that both happen to be "UI polish," but touch different layers:

- **F5 — PWA + Mobile experience** (SPEC S13 F5 / Part 6 M9): make the app installable, mobile-native-feeling,
  camera-capable, and push-capable. *Infrastructure + layout polish.*
- **F6 — Learning feed + Gamification** (SPEC S14 / S11 F5–F6): rank badges, confetti celebration system,
  learning content feed, and the partner activity feed. *Engagement/reward polish.*

They share **no code** and can ship in **either order or in parallel**. I recommend treating them as **two
separate milestones** (F5-M and F6-M), each with its own PRs.

### Hard gating (why this is a proposal, not a build)
Per SPEC S14 + ROADMAP, **both are explicitly deferred to Phase F** and depend on things that do **not exist yet**:
- **Doctor's Portal (Phase D)** — F6's badges/confetti/learning feed live on `/portal`; F5's mobile/bottom-nav
  layout is primarily the *partner* experience. No portal shell exists today (we're mid-Phase C).
- **Real earnings + engagement data (Phase D/E)** — badges key off funded deals, streaks, R100k earnings; the
  `doctor_earnings` / engagement metrics they read are Phase D/E.
- **Owner-provided Figma badge assets** — `badge_designs.asset_url` is seeded from owner-curated Figma exports.

**Recommendation:** bank this scope now, build after Phase D ships the portal + real partner data. This document
is the ready-to-execute plan for when that gate opens.

---

## 2. Scope A — F5: PWA + Mobile experience

Six capabilities (SPEC S13 F5). Split into **two PR groups** — the offline/installable core is independent of
the layout work.

### F5-M1 — Installable PWA core
| Item | Scope | Notes / risk |
|------|-------|--------------|
| **Web app manifest** | `manifest.webmanifest` — name, icons (192/512 + maskable), theme colour navy `#1a3a52`, `display: standalone`, start_url `/portal` (partner) / `/` (owner). | Low. Brand assets exist (`brand-mark.png`); needs proper icon set generated. |
| **Service worker** | Vite PWA plugin (`vite-plugin-pwa` + Workbox). App-shell precache; runtime cache for static assets. | Medium. Must **not** cache authenticated API/RLS responses insecurely — cache only static shell + explicitly safe GETs. |
| **Offline cache of recent data** | Cache last-viewed deals/clients read-only for offline view. | **Highest risk in F5.** RLS/POPIA: cached financial + PII data sits in the browser cache. Needs a policy: what's cacheable, encryption-at-rest question, cache-clear on logout. **Owner decision required.** |
| **Installable** | Install prompt (`beforeinstallprompt`), "Add to Home Screen" affordance. | Low. iOS Safari has no install prompt — document the manual A2HS path. |

### F5-M2 — Mobile-native layout + device features
| Item | Scope | Notes / risk |
|------|-------|--------------|
| **Bottom-nav mobile layout** | Responsive shell: bottom tab bar on mobile (portal + owner), replacing/augmenting the navy sidebar below a breakpoint. | Medium. Touches the shared `AppLayout` and the future `/portal` layout — coordinate with the Phase D portal shell. |
| **Camera document capture** | On mobile, "Take photo" → capture → upload into the existing document pipeline (`documents` + versioning trigger). | Medium. Reuses the B3 upload path; adds `getUserMedia`/file-capture. Image size/orientation handling. |
| **Push notifications** | Web Push (VAPID) → service worker → notification. Wire to existing S4 events (deal funded, badge earned, follow-up due). | **High complexity.** Needs VAPID keys, a `push_subscriptions` table, an Edge Function to send, and per-event opt-in (extends `notification_preferences`). **iOS web-push requires the PWA be installed** (iOS 16.4+). Realistically its own PR. |

**F5 note:** push overlaps the existing notification system (S4/A11/A12 in-app + email). Web-push is a **third
channel** alongside email/WhatsApp — slot it into `notification_deliveries.channel` rather than a parallel path.

---

## 3. Scope B — F6: Learning feed + Gamification

Four sub-systems (SPEC S14 + S11 line 539). The **badge engine** and **confetti system** are the heart;
learning feed + activity feed are lighter.

### F6-M1 — Confetti celebration system (supersedes the current lightweight one)
- **Library:** add `canvas-confetti` (single dep, no external assets) — replaces the hand-rolled canvas in
  `ConfettiProvider.tsx`.
- **Four intensities** (SPEC S14): `small` (lead qualified / new client) · `medium` (deal approved / signed) ·
  `big` (deal funded / standard badge unlock) · `massive` (R100k+ month / tier-crossing badge).
- **Migration note — existing infra:** `src/lib/celebration/ConfettiProvider.tsx` already ships the lightweight
  "logo confetti" wired at two moments (lead qualified `small`, deal funded `big`) with `celebrateOnce`
  localStorage dedup. **F6 absorbs it:** keep the `useCelebrate` API + `celebrateOnce` dedup, swap the engine to
  canvas-confetti, add `medium`/`massive`, and add the "one event → one animation, most-significant-rule-wins"
  resolver (SPEC S14 line 617 — a funded deal that also crosses a tier is **one** `massive`, never `big`+`massive`).
- **Compose with PriorityGlow** (the single sanctioned glow) for `big`/`massive`; **`prefers-reduced-motion` →
  static celebratory toast** (already honoured today — preserve it).
- **Restraint rules (SPEC S14 "What NOT to celebrate"):** no login confetti, no per-raw-lead confetti, no
  owner-internal-edit confetti. Encode these as a deny-list in the resolver.

### F6-M2 — Rank badge engine
- **`badge_designs`** (catalogue, owner-curated, seeded from Figma): `id, code (unique), name, description,
  tier enum(bronze/silver/gold/platinum/elite), category enum(milestone/streak/volume/earnings/quality),
  criteria jsonb, asset_url, sort_order, active, created_at`.
- **`doctor_badges`** (earned): `id, doctor_id, badge_design_id FK, earned_at, deal_id (nullable trigger),
  seen_at`. Partial-unique so a badge is earned **once** per doctor.
- **Award engine:** evaluate `criteria` jsonb against partner metrics; on unlock fire **exactly one
  `BADGE_EARNED` notification** (event type already exists in S4 enum) **+ exactly one** confetti (`big`, or
  `massive` if tier-crossing). Must be **idempotent + advisory-locked** per the belt-and-braces rule — a
  re-evaluation must never double-award or double-notify.
- **Seed families (SPEC S11):** first deal funded, 4-week streak, 10 quality leads, R100k earnings, repeat client
  — each with 5 tier thresholds. **Thresholds per tier are an owner decision (§5).**

### F6-M3 — Learning feed + activity feed
- **`learning_content`** (S11): a partner-facing learning/tips feed. Needs shape + an authoring source
  (owner-curated? static seed? CMS-lite in `/settings`?). **Owner decision (§5).**
- **`doctor_activity_feed`** (S11): the partner's own activity stream on the portal dashboard — likely a
  read-model/view over `activity_logs` + `doctor_badges` + deal events, partner-scoped, fictional-funder-safe.

**Absolute partner-safety rule (S11/S7C):** every F6 surface is partner-facing → **fictional funder names only,
partner-share-only money, never gross/40-60/tier math**. Badge/celebration copy that references a deal must use
the fictional funder name and the 50/50 display view.

---

## 4. Data model summary (new tables)

| Table | Milestone | Notes |
|-------|-----------|-------|
| `badge_designs` | F6-M2 | catalogue; owner-curated; FK target |
| `doctor_badges` | F6-M2 | earned ledger; once-per-(doctor,badge) |
| `learning_content` | F6-M3 | feed content; authoring TBD |
| `doctor_activity_feed` | F6-M3 | likely a **view**, not a base table (read-model over existing logs) |
| `push_subscriptions` | F5-M2 | web-push endpoints per user/device |

**Reuse (no new table):** `notifications`/`notification_deliveries` (BADGE_EARNED, add web-push channel),
`notification_preferences` (push opt-in), `activity_logs` (activity feed source), the `ConfettiProvider`
`useCelebrate` API. `BADGE_EARNED`, `MONTHLY_TARGET_MILESTONE`, `TIER_REVIEW_UPCOMING` event types **already exist**
in the S4 enum — no enum migration needed for those.

---

## 5. Owner decisions required before build (blockers)

1. **Badge tier thresholds** — the exact Bronze/Silver/Gold/Platinum/Elite cut-offs for each of the 5 families
   (e.g. earnings: Bronze R100k → … → Elite R?). Can't build the award engine without these.
2. **Figma badge assets** — owner supplies the exported SVG/PNG set → Storage. Blocks `badge_designs` seeding.
3. **Learning content source** — who authors `learning_content`, and is it static-seed or an owner CMS-lite editor?
4. **Offline-cache policy (F5-M1)** — what financial/PII data may be cached in-browser, and the encryption/
   cache-clear-on-logout stance. POPIA-sensitive.
5. **Push scope (F5-M2)** — which events push, and accept the iOS "installed-PWA-only" limitation?
6. **Milestone independence** — confirm F5 and F6 are separate PR streams (recommended), and whether F5 (PWA)
   or F6 (gamification) goes first. *My rec: F6 first — it's higher partner-motivation value and has fewer infra
   unknowns; F5 push is the single most complex piece and can trail.*

---

## 6. Proposed PR breakdown (when the Phase-D gate opens)

**F6 stream (recommended first):**
- **F6.1** — canvas-confetti engine swap + 4 intensities + resolver + restraint deny-list (absorbs current
  ConfettiProvider). *Frontend-only, no schema.*
- **F6.2** — `badge_designs` + `doctor_badges` schema + RLS (owner-curate; partner reads own) + DO-block asserts.
- **F6.3** — award engine (criteria evaluator + idempotent/advisory-locked award RPC + BADGE_EARNED + confetti wiring).
- **F6.4** — portal UI: badge shelf/trophy case, "new badge" indicator (`seen_at`), tier progress.
- **F6.5** — `learning_content` + `doctor_activity_feed` (view) + portal feed UI.

**F5 stream:**
- **F5.1** — manifest + service worker + installable (offline shell only, no sensitive cache).
- **F5.2** — bottom-nav mobile layout + camera capture.
- **F5.3** — web-push (`push_subscriptions` + Edge Function + `notification_deliveries` channel + opt-in).
- **F5.4** — (decision-gated) offline data cache, once the caching policy is set.

Each schema PR follows standing rule: `NOT VALID`/`CONCURRENTLY` only if on populated tables (these are new/empty →
inline), DO-block assertions, belt-and-braces on the award RPC.

---

## 7. Risks & dependencies
- **Biggest risk:** F5 offline cache + push — browser-side financial/PII caching (POPIA) and iOS push limits.
- **Dependency:** the whole proposal sits on the **Phase D portal shell** and **real partner earnings data**.
- **Asset dependency:** Figma badge exports (F6) and the partner logo (already staged, S11.2).
- **Consistency:** F6 celebration must not regress the restraint rules — overuse is the named failure mode (S14).
- **Coordination:** F5-M2 bottom-nav touches the shared layout — must align with the Phase D `/portal` shell so
  they aren't built twice.

## 8. Sizing (rough, post-gate)
- **F6:** ~5 PRs, the award engine (F6.3) being the only non-trivial backend; the rest is UI + one schema PR. Medium.
- **F5:** ~4 PRs; F5.3 (push) is the heavy one; manifest/layout are light-to-medium. Medium, back-loaded.
- **Order:** F6 first (motivation value, fewer unknowns) → F5 (infra, push trails). Both strictly after Phase D.

## 9. Recommendation
Bank this as the F5/F6 execution plan. **Do not start before Phase D** ships the portal + real partner data.
When the gate opens, run **F6 first** (F6.1 confetti → F6.2/6.3 badges → F6.4/6.5 feeds), then **F5**
(F5.1 installable → F5.2 mobile/camera → F5.3 push). Resolve the six §5 decisions — especially badge thresholds,
Figma assets, and the offline-cache policy — before F6.2 / F5.1 respectively.
