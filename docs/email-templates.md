# Email templates (A12 — Resend transactional emails, v2)

The `send-notification-email` Edge Function renders every notification email from a
single **bulletproof, table-based HTML template** with a **plain-text fallback**.
Source: `supabase/functions/send-notification-email/email-template.ts`. Canonical
design system: **SPEC S16**.

## Why it's built this way

- **Table-based, inline styles only.** No `<style>` block, no CSS classes, no
  flexbox, no grid. Widest-compatibility approach for Outlook (Word engine),
  Gmail web, Gmail iOS/Android, and Apple Mail.
- **No `@media` queries** (they need a `<style>` block). The footer columns
  instead use `<div>` + `display:inline-block` inside an **MSO ghost table**, so
  they sit side-by-side on desktop, wrap/stack on narrow screens, and stay in a
  table for Outlook. Other sizes are chosen to stay legible when the 600px shell
  is scaled down.
- **Hosted logo (PNG), inline-SVG icons.** The header logo is a hosted PNG
  referenced by absolute HTTPS URL under `APP_BASE_URL`. The per-variant accent
  icon and the LinkedIn/TikTok social glyphs are **inline `<svg>`** (`role="img"`
  + `aria-label` for SVG-capable clients). **Outlook 2016+ does not render inline
  SVG**, so these icons are absent there — an accepted compromise (no PNG
  fallback, per brief).
- **Plain-text fallback** for every variant — required for deliverability.
- **The template never fetches funder data.** The Edge Function hydrates a
  role-aware funder name (real for owner, fictional `display_name_for_partner`
  for partner) and passes it in. The template only renders — a real funder name
  only appears when the caller resolved it for an owner recipient.

## Assets (`/public`)

| File | Use |
| --- | --- |
| `logo-white.png` | White FN mark (the "n" carved out). Header (dark gradient). Hosted PNG. |
| `logo-full.png` | Full colour lockup — light backgrounds / future PDFs. Not used on the dark email surfaces. |

Served by Vercel from `/public`, so `public/logo-white.png` is reachable at
`${APP_BASE_URL}/logo-white.png`. Images only resolve **after** the app is
deployed. Social + accent icons are inline SVG (no hosted files).

> **TODO (owner):** provide the LinkedIn company URL. `LINKEDIN_URL` in
> `email-template.ts` is currently the **domain-only fallback**
> (`https://www.linkedin.com/`) because the company URL wasn't supplied — no slug
> is invented. The TikTok URL is `https://www.tiktok.com/@fundnowcapital`.

## `renderEmail(model)` interface

```ts
type EmailModel = {
  eventType: string;            // derives variant + footer category
  firstName?: string | null;    // greeting; null => "Hi there,"
  linkUrl?: string | null;      // app-relative, e.g. "/deals/123" -> CTA target
  appBaseUrl: string;           // e.g. https://fund-now-capital-2026.vercel.app
  // hydrated deal context (null for welcome/weekly_summary or on a hydration miss):
  funderDisplay?: string | null;   // role-aware: real name (owner) / fictional (partner)
  dealReference?: string | null;   // e.g. "DEAL-001"
  amount?: string | null;          // pre-formatted, e.g. "R8,000,000"
  clientName?: string | null;      // e.g. "Mama Mabase JV"
  bodyText?: string | null;        // fallback only, if a live variant can't hydrate
  variant?: EmailVariant;          // explicit override (testing dormant variants)
};
// returns { subject, html, text } — subject is the locked per-variant subject.
```

The Edge Function (`index.ts`) hydrates the deal context from the notification's
`data` payload using the **service-role client** (server-side render, no RLS user
context): `deal_id` / `submission_id` / `commission_record_id` → deal reference,
role-aware funder, formatted amount, client name. It does **not** pass a
`variant`, so live emails resolve theirs from `eventType`.

## Variants (locked copy — SPEC S16 / brief Section 7)

| Variant | Icon | Body |
| --- | --- | --- |
| `welcome` | open door | fixed onboarding copy (no deal fields) |
| `deal_approved` | check-in-circle | `{funderDisplay} has approved {dealReference} for {amount}.` + closing |
| `deal_funded` | check-in-circle | `{funderDisplay} has funded {dealReference} for {amount}. The advance to {clientName} is complete.` + "record the funded date and start the commission process" closing |
| `weekly_summary` | bar chart | fixed digest copy (no deal fields) |
| `commission_paid` | rand-in-circle | `A commission payment of {amount} has been recorded for {dealReference} ({clientName}).` + closing |
| `bonus_paid` | rand-in-circle | `A bonus payment of {amount} has been recorded for {dealReference} ({clientName}).` + "see the bonus detail" closing — bonus amounts aren't hydrated (no `bonus_record_id` path), so the DB-composed `bodyText` fallback is the normal path today |
| `generic` | info | fallback: renders `bodyText` (safety net; production events should map to one of the above) |

Each variant also carries a locked **subject**, **H1**, and **CTA label** (see
`variantContent()`). If a live variant's hydrated fields are missing, the body
gracefully falls back to `bodyText` so an email never breaks.

### Event type → variant (`resolveVariant`)

| Event type | Variant | Fires today? |
| --- | --- | --- |
| `DEAL_APPROVED` | `deal_approved` | ✅ |
| `DEAL_FUNDED` | `deal_funded` (deal_approved layout, funded copy) | ✅ |
| `COMMISSION_PAID` | `commission_paid` | ✅ |
| `LEAD_QUALIFIED` / `LEAD_CREATED_FOR_YOU` | `welcome` | ⬜ (B2) |
| `WEEKLY_SUMMARY` | `weekly_summary` | ⬜ (C6) |
| anything else | `generic` | — |

`welcome` and `weekly_summary` are **dormant** until B2 / C6; the layouts exist
and render when invoked with a matching `eventType` or explicit `variant`.

## How to add a new event type

1. **DB trigger** — emit via `emit_in_app_notification(...)` with a `title`,
   `body_text`, `link_url`, and a `data` payload carrying the entity ids the email
   needs (e.g. `deal_id`). Keep funder names role-aware.
2. **Hydration** — if the email needs discrete fields (amount, reference, funder,
   client), add a branch to `hydrateDealContext()` in `index.ts` for the new event.
3. **Variant** — map the event in `resolveVariant()`, add locked copy in
   `variantContent()` (subject / H1 / CTA / paras) and an accent icon in
   `accentIcon()`. If it needs no special layout it falls through to `generic`.
4. **Category** — extend `eventCategory()` so the footer line reads naturally.
5. **Preferences / allow-list** — ensure the event exists in the
   `notification_event_type` enum, prefs are backfilled, and SPEC S4 lists it as
   in-scope to send email.

## Locked company facts (footer — use exactly)

Fund Now Capital (Pty) Ltd · CIPC 2026/066284/07 · 071 208 5218 ·
hello@fundnowcapital.africa · www.fundnowcapital.africa ·
Cedarwood House, 128 Ballyclare Drive, Bryanston 2191, Sandton ·
73 Marshall Street, Polokwane 0699 · "Many funders. More approvals."

**Never** put a personal email (e.g. `thapelol@…`) in the notification footer —
`hello@` is the shared inbox for all replies.
