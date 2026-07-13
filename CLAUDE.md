# Fund Now Capital CRM

## What this is
An internal CRM for **Fund Now Capital**, a South African SME funding brokerage. Owned by Thapelo Maupa (she/her). Phase 1 is a **single-owner internal tool**. A referral-partner portal comes in a later phase — so the schema and security model are designed for it now, but the partner-facing screens are NOT built yet.

## Who I'm working with
Thapelo is the founder — 12+ years in sales, business-minded, learning to code at a beginner level with the goal of understanding her own product. Explain technical decisions in plain language. When a choice has real tradeoffs, name them briefly and recommend one. Never invent funder rates, client data, or facts — if something isn't specified, ask.

## Tech stack (locked)
- **Frontend:** React + TypeScript + Vite
- **Styling:** Tailwind + shadcn/ui
- **Backend:** Supabase (Postgres, Auth, Storage, RLS, Edge Functions)
- **Forms:** react-hook-form + zod
- **Data fetching:** TanStack Query
- **Deploy:** Vercel
- **Version control:** GitHub, private repo. CodeRabbit reviews PRs.

## Security rules — NON-NEGOTIABLE
This app holds client bank statements and a live commission ledger. Treat security as the priority.
1. **Supabase native Auth only** (email + password), with `auth.uid()`-based RLS on every table. NEVER use custom session tokens. (A previous build on another platform failed exactly this way — custom tokens broke RLS and forced every read through service-role backend functions. Do not repeat that pattern.)
2. **Never expose the service role key to the client.** It lives only in server-side/Edge Function environments.
3. **RLS enabled on every table**, day one. Owners: full read/write. Partners: read-only on rows linked to their own `referral_partner_id` (write these policies now, even though partner screens don't exist yet).
4. **Public signup is OFF.** The first owner account is created once, then signup is disabled. New users are owner-invited only.
5. **Money is always recomputed server-side on save.** The commission split is never trusted from the browser — the client may show a live preview, but persisted values are recalculated server-side.
6. All monetary values are `numeric(14,2)` in Postgres. Never floats.

## The Commission Engine — the core of the app
Every funded deal produces a gross commission `X` that Fund Now Capital receives from the funder. It splits like this:
1. `company_retention = X × 0.40` (stays in the business, flat, all deals)
2. `partner_pool = X × 0.60` (shared between Thapelo and the referral partner)
3. Partner's share of the pool is set by tier %, chosen by deal type and gross-commission band:
   - **Purchase Order deals (any funder): flat 40% of pool**
   - **Non-PO deals, by gross band:**
     - R0 – R80,000 → 29%
     - R80,001 – R150,000 → 30%
     - R150,001 – R500,000 → 33%
     - R500,001+ → 25%
4. `partner_share = partner_pool × tier%`
5. `owner_share = partner_pool − partner_share`
6. The three outputs (company_retention, partner_share, owner_share) must always sum to X.

Implement this ONCE as a shared, unit-tested function. Both the calculator screen and the deal-submission save path use it. The save path runs it server-side.

Contract note: the referral partner agreement permits a 20%–45% range; all tier percentages above fall inside it.

## Funder anonymisation (schema now, UI later)
Each funder has a real name AND a `display_name_for_partner` (a fictional first name). In the future partner portal, the partner only ever sees the fictional name — this stops them bypassing Fund Now Capital to approach funders directly. The owner always sees real names. Store both now.

## Brand
- Navy `#1a3a52` (primary), Teal `#2da8b8` (secondary), Green `#5dba5d` (success/positive)
- Tagline: "Many funders. More approvals."
- Currency: South African Rand, formatted `R1,250,000` via `Intl.NumberFormat('en-ZA')`.
- Clean modern SaaS, sidebar nav, responsive (owner uses desktop + mobile).

## Deal stages (15, in order)
New Lead → Qualifying → Document Collection → Deal Review → Submitted → In Credit → Approved/Quote Received → Client Deciding → Verification/KYC → Contract Signed → Advance Pending → Funded → Invoiced → Commission Paid → Declined
(Declined is terminal, reachable from any stage.)

## Working style
- Small, reviewable commits with clear messages. One logical change per PR where practical.
- Write the schema and RLS first, verify it, THEN build screens.
- When you finish a step, tell me what you did and what to test — don't chain ten changes silently.
- Ask before destructive migrations.
- Deployed app (main branch): https://fund-now-capital-2026-git-main-thapelo-l.vercel.app/

---

## Repo status (living notes — update as work lands)
- **Login page** (`src/pages/AuthPage.tsx` + `AuthPage.css`): split-screen UI built to the design handoff. Currently **UI-only** — Sign In shows a placeholder toast and is NOT yet wired to Supabase Auth. Wiring native email/password auth (rule #1) and disabling public signup (rule #4) is the next step for this screen.
- **Not yet started:** Supabase project/client, database schema, RLS policies, commission engine function, all post-login screens.
