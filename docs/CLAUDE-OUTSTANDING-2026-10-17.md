# Claude — outstanding work (17 October 2026)

Sources: staff runbook (10 Oct), Codex → Claude handover (17 Oct), Sales Coordinator spec (6 Oct),
legal-lane handover (14 Aug), canonical build register (24 Aug), CLAUDE.md. Live database checked 17 Oct.

Ownership (agreed): Claude owns Switchboard, Sales Coordinator, staff migrations, the required-documents
catalogue, intake workflows and staff calendars. Codex owns signing, Path-A commission, R100 payroll, CI
and deployment. Coordinate before touching shared role helpers, audit functions, document tables or storage policies.

## A. Launch blockers (people cannot load and work until these are done)

1. ~~Merge the consolidated staff branch~~ — **done**: PR #297 merged 17 Oct.
2. ~~Apply `staff_review_fixes_2` live~~ — **done** 17 Oct, verified.
3. **Catalogue cut-over (Codex findings 1 + 5) + Qodo's six #297 findings** — built in PR #298, tested on the live schema
   in rolled-back transactions. Owner chose all 24 funding types everywhere (client side too). After merge apply, in
   order: `20261017100000_staff_review_fixes_3.sql`, `20261017110000_doc_catalogue_cutover.sql`. **Tell Codex:** 17 new
   rows in `funding_product_catalog`, `funding_product_catalog.doc_list_code`, and `client_form_responses` product CHECK
   replaced by an FK to the catalogue.
4. **`external_intake_safe_projection` not applied live.** The Supabase tool hangs on any `DROP POLICY` / `DROP FUNCTION`
   (it waits for a confirmation it never receives), so the owner runs that file in the SQL editor.

## B. Owner set-up after merge (owner actions, Claude guides)

Confirm document lists · enter public holidays · invite Coordinator + Switchboard and switch them on (Team page) ·
create teams · open Founder slots and grant calendar access (`/calendar/access`) · choose the confirmation sender address.
Then run the batch smoke tests in the batch docs with real role sessions (never done in a browser yet).

## C. Sales Coordinator spec items not built yet

- Batch 4 automations: stalled-file follow-up every 3 working days (day 3 / day 7 chasers exist; recurring cadence
  does not), lapse alerts (30 days without Complete, 6 months without approval), daily 16:30 Founder pipeline summary,
  Friday report on agents / Team Leaders / partners, **red-flag button** alerting the Founder immediately.
- Dashboard: each agent's Complete files this week vs target 5; each Team's monthly progress vs Team Leader targets.
- Duplicate rule "first complete submission wins" (currently a review flag only) and its reversal effect.
- Reminder sending to Team Leaders and partners (check-ins are in-app for the Coordinator only).
- Contract alignment (Schedule 2 checklists, qualifying weeks, Team Leader targets) — deferred by the owner on 17 Oct.

## D. Staff build items waiting on owner rulings (runbook §8)

- SC10 deal assignment and agent "My files" wording — commission on a deal that arrived with no agent?
- SC6 status message templates — confirm "withdrawn" wording; sender address.
- SC8 Monday pipeline emails and any delivery — sender address, WhatsApp/email set-up.
- SC9 KPI targets and the Qualifying File rule (R35 tracker built, rule unconfirmed).
- Reports and red-flag alert format and recipients.

## E. Shared / coordinated with Codex

- **Secure staff and sub-agent document upload** (insert-only storage, no read, registered by RPC) — design to agree
  with Codex; then build Claude's portion.
- Open staff review findings still to fix: booking slots do not reopen when a staff booking is cancelled; diary handover count.

## F. Older Claude-era items still open (CLAUDE.md / registers — confirm still Claude's)

- C3: Doctor's `doctor_earnings` lifecycle (S8) — scope proposal first.
- Owner rulings before the first affected deal: PO-tier scope (Sourcefin-only vs all PO) and the R1M+ band.
- Legal lane builds 5/6/9/10/11 (client legal package, role onboarding packages, executed artifact, delivery, e-sign
  smoke) — gated on the approved PDFs and email domain; signing has since moved to Codex, so confirm the split.
- Role smoke tests never run: payee profile save → submit → verify/reject; contractor invoice generate → submit → approve.
- Better Banc + Business Partners `short_code` (owner data entry before first invoicing).

## Not Claude's (for reference)

R100 payroll migrations and eligibility rules, PR #296, Path-A base ruling, commission estimate visibility, authenticated
cross-role acceptance tests — Codex.
