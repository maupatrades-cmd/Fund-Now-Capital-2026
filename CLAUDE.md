# Fund Now Capital CRM — CLAUDE.md (v2)

## What this is
Internal CRM for **Fund Now Capital**, a South African SME funding brokerage owned by Thapelo Maupa (she/her). Owner-first tool now; referral-partner portal for **Doctor (Bright Destiny)** launches in **Phase D**. Client-facing portal deliberately deferred (Part 7).
Build order lives in **ROADMAP.md** — always consult it before starting work. Feature details live in `SPEC.md`.

## Who I'm working with
Thapelo — founder, 12+ years high-performance sales, learning to code (beginner), mother, Christian faith central to her life. Explain technical decisions in plain language. Name real tradeoffs once, recommend one, respect her call. Never invent funder rates, client data, or facts — ask. When she's working very late, be honest and encourage rest.

## Tech stack (locked)
React + TypeScript + Vite · Tailwind + shadcn/ui · Supabase (Postgres/Auth/Storage/RLS/Edge Functions) · react-hook-form + zod · TanStack Query · dnd-kit · gsap (PriorityGlow only) · Vercel (auto-deploy from main) · GitHub `maupatrades-cmd/Fund-Now-Capital-2026` · CodeRabbit on PRs · Resend for email · Twilio for WhatsApp/SMS (Phase D) · Anthropic API for AI features (Phase E).

## Security rules — NON-NEGOTIABLE
1. Supabase native Auth only; `auth.uid()`-based RLS on every table. NEVER custom session tokens (the LB-281 lesson from a previous build).
2. Service role key never reaches the client.
3. RLS on every new table from day one. Owner: full. Partner: read-only own rows. Funder identity is owner-only; partners see `display_name_for_partner` ONLY.
4. Public signup OFF. Users created by owner. Current users: `business.lekgoro@gmail.com` (owner), `queenasdice@gmail.com` (test partner — placeholder for Doctor).
5. Money is recomputed server-side on save; client values never trusted.
6. All monetary values `numeric(14,2)`. Never floats. Currency format `R1,250,000` (en-ZA).
7. Bank statements are owner-only in RLS — partners never see them.
8. Every new feature writes to `activity_logs` (once A10 lands) and, where user-relevant, fires notifications (once A11 lands).

## The Commission Engine (locked — implemented as `calculate_commission()` in Postgres)
Gross X → 40% company retention → 60% partner pool. Partner tier % of pool: PO deals flat 40%. Non-PO by gross band: R0–80,000 → 29% · R80,001–150,000 → 30% · R150,001–500,000 → 33% · R500,001+ → 25%. Owner share = pool − partner share. Three outputs always sum to X. Contract range 20–45%; all tiers comply. Single source of truth: the DB function, called via RPC everywhere (calculator screen, deal submissions, doctor earnings).

## Funder anonymisation (live in schema)
`funders.name` (owner-only) + `display_name_for_partner` (Rachel, Marcus, Ethan, Nadia, Palesa, Themba, Chloe, Amara, Ryan, Sophie, Sipho, Elizabeth, Thomas, Grace, Nicholas, Isabelle, Benjamin, Lerato, William, Zanele, Alexander). Partner-facing surfaces show the fictional name only — screens, notifications, PDFs, AI outputs, everywhere.

## Brand
Navy `#1a3a52` · Teal `#2da8b8` · Green `#5dba5d` · Tagline "Many funders. More approvals." · Inter · clean modern SaaS · shared AppLayout (navy sidebar + top bar) on every owner screen · PriorityGlow is the single sanctioned glow effect (priority deals + celebrations only).

## Deal stages (15, Declined is terminal — revival only via deal-detail dropdown w/ confirm)
New Lead → Qualifying → Document Collection → Deal Review → Submitted → In Credit → Approved/Quote Received → Client Deciding → Verification/KYC → Contract Signed → Advance Pending → Funded → Invoiced → Commission Paid → Declined

## Current build state (update this section as phases complete)
DONE (applied + verified live): schema+RLS+engine+21 funders · auth/login · dashboard · funder panel · client DB · pipeline kanban + deal detail + calculators · A10 activity logging · A11 in-app notifications (bell/list/prefs, Realtime, owner-targeted role-aware triggers, mark-read RPCs return affected rows — PRs #18, #19).
IN FLIGHT: A12 Resend email notifications (send-notification-email Edge Function via pg_net, branded template, per-event email prefs) — in PR, awaiting CodeRabbit; migration + function not yet applied/deployed to live.
NEXT: A13 (Twilio paperwork, parallel) · Phase B.

## Open decisions (do not build past these without owner's answer)
1. Doctor's Commission Estimator "Business View" transparency (blocks D5).
2. Password expiry policy at F2 (recommend against forced 90-day rotation; prefer 2FA).

## Working style
Small verified stages. One PR per logical change; open PR, WAIT for CodeRabbit, owner merges. After any schema merge: apply migration to live DB, verify, then owner runs smoke test. Tell her what you did and what to test — never chain ten silent changes. Ask before destructive migrations. Never discuss real funder rates in partner-facing code or copy.

Supabase RLS silently returns empty result sets for UPDATE/DELETE without permission. Every mutation must use `.select()` or `RETURNING id` and check the returned row count to catch silent RLS failures loudly. Never assume a mutation succeeded just because no error was thrown.
