# Logo Confetti — global celebration

A single reusable celebration that can fire anywhere in the app. Confetti bursts
in the brand palette with the Fund Now Capital logo mark mixed in, plus an
optional success card. Owner-provided component, adapted to this codebase.

## Files
- `ConfettiProvider.tsx` — the whole feature (provider + `useCelebrate` hook + canvas + card).
- Logo particle uses the existing **`/public/brand-mark.png`** (the transparent FN mark) — no new asset needed.

## Wiring (already done)
1. `ConfettiProvider` wraps the app once in `src/App.tsx` (inside `BrowserRouter`,
   around `AppRoutes`), so `useCelebrate()` works on any screen and the canvas
   persists across route changes.
2. Fire from any component:
   ```tsx
   import { useCelebrate } from "@/lib/celebration/ConfettiProvider";

   const { celebrate, celebrateOnce } = useCelebrate();
   celebrate({ message: "Deal funded!" });          // confetti + success card
   celebrateOnce("funded:" + dealId, { message });   // fires at most once per key
   ```
   - `celebrate()` — confetti only.
   - `celebrate({ message })` — confetti + success card.
   - `celebrateOnce(key, opts)` — same, but persisted in `localStorage`
     (`fnc-celebrated:<key>`) so a refresh / re-visit never re-fires the same milestone.

## Where it fires today (two money-relevant moments only)
- **Lead qualified** (both qualify paths) — `LeadDetailPage` qualify success handler.
  Key `qualify:<deal_id>`. Card: "Qualified onto {business} — {DEAL-REF} created".
- **Deal → Funded** — both stage-change paths: `DealDetailPage` stage dropdown and
  `PipelinePage` drag-to-Funded. Key `funded:<deal_id>`. Card: "🎉 {business} —
  {DEAL-REF} Funded! Commission earned: R X" (commission line shown only when set).

Other moments (document uploaded, follow-up completed, etc.) are intentionally
**not** wired — a Phase-F polish pass can add them.

## Behaviour / a11y
- **Silent** — no sound (professional context).
- **Idempotent** — `celebrateOnce` dedups via `localStorage` per event id.
- **Success card** auto-dismisses after **4s**, or on click / **Escape**.
- **`prefers-reduced-motion`** — the animation is skipped; the success card still shows.
- The confetti **canvas is `pointer-events: none`**, so it never blocks UI clicks.
- Particles use **brand colours only** (Navy `#1a3a52` · Teal `#2da8b8` · Green `#5dba5d` + accents).

## Tunables (in `ConfettiProvider.tsx`)
`COLORS`, the `0.16` logo-particle ratio, particle count (`70`), `burst()` origins,
and `CARD_AUTO_DISMISS_MS` (4000).

## Relation to SPEC S14
This is the lightweight "logo confetti" the owner requested now. The full S14
celebration system (rank badges + four confetti intensities via canvas-confetti,
Phase F6) is separate and supersedes/absorbs this later.
