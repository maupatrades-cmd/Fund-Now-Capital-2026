# Email templates (A12 — Resend transactional emails)

The `send-notification-email` Edge Function renders every notification email from a
single **bulletproof, table-based HTML template** with a **plain-text fallback**.
Source: `supabase/functions/send-notification-email/email-template.ts`.

## Why it's built this way

- **Table-based, inline styles only.** No `<style>` block, no CSS classes, no
  flexbox, no grid. This is the widest-compatibility approach for Outlook (Word
  rendering engine), Gmail web, Gmail iOS/Android, and Apple Mail.
- **No `@media` queries** (they require a `<style>` block, which we don't use), so
  the layout does **not** stack on narrow screens. Font sizes are chosen to stay
  legible when a mobile client scales the 600px shell down.
- **Hosted PNG images, not SVG.** Outlook has no SVG support, so the logo and
  social icons are PNGs in `public/email-assets/` referenced by absolute HTTPS URL
  built from `APP_BASE_URL` (e.g. `${APP_BASE_URL}/email-assets/logo-white.png`).
- **Plain-text fallback** is generated for every variant — required for
  deliverability and for text-only clients.
- **The template never fetches funder data.** It renders only the strings the
  caller passes in, so the DB layer's role-aware *fictional* funder names in
  `body_text` pass straight through. Nothing here can surface a real funder name.

## Assets (`public/email-assets/`)

| File | Use |
| --- | --- |
| `logo-white.png` | White FN mark (the "n" is carved out as negative space). Header (dark gradient) + footer (deep navy). |
| `logo-full.png` | Full colour lockup + wordmark. For light backgrounds / future PDFs — not used on the dark email surfaces. |
| `social-linkedin.png` | White LinkedIn glyph, footer "Connect" column. |
| `social-tiktok.png` | White TikTok glyph, footer "Connect" column. |

Served by Vercel from `/public`, so `public/email-assets/x.png` is reachable at
`${APP_BASE_URL}/email-assets/x.png`. Images only resolve **after** the app is
deployed with these files present.

> **TODO (owner):** confirm the LinkedIn company URL. `LINKEDIN_URL` in
> `email-template.ts` is a best-guess slug (`.../company/fund-now-capital`); the
> TikTok URL is derived from the `@fundnowcapital` handle.

## `renderEmail(model)` inputs

```ts
type EmailModel = {
  title: string;              // subject + H1 (from notification.title)
  bodyText: string | null;    // main message (from notification.body_text)
  linkUrl: string | null;     // app-relative, e.g. "/deals/123" -> CTA target
  firstName?: string | null;  // greeting; null => "Hi there,"
  eventType: string;          // derives variant + footer category when not given
  appBaseUrl: string;         // e.g. https://fund-now-capital-2026.vercel.app
  variant?: EmailVariant;     // explicit override (dormant variants / testing)
  eventCategory?: string;     // footer subscription line; derived if absent
  ctaLabel?: string;          // default "View in CRM"
  stats?: { label: string; value: string }[];        // weekly_summary only
  statusRows?: { label: string; value: string }[];   // weekly_summary only
};
```

The Edge Function (`index.ts`) populates this from the notification row + the
recipient's `profiles` row (`full_name` → `firstName`). It does **not** pass a
`variant`, so live emails resolve their variant from `eventType` (below).

## Variants

Four layout archetypes share the header/footer shell:

| Variant | Body layout |
| --- | --- |
| `welcome` | greeting + intro paragraph + CTA |
| `deal_approved` | greeting + lead-in + **green success band** (holds `body_text`) + CTA |
| `commission_paid` | greeting + lead-in + **green success band** (holds `body_text`) + CTA |
| `weekly_summary` | greeting + intro + **stat tiles** (`stats`) + **status rows** (`statusRows`) + CTA |
| `generic` | greeting + `body_text` paragraph + CTA (fallback) |

### Event type → variant (`resolveVariant`)

| Event type | Variant | Fires today? |
| --- | --- | --- |
| `DEAL_APPROVED` | `deal_approved` | ✅ |
| `DEAL_FUNDED` | `deal_approved` (shared success layout) | ✅ |
| `COMMISSION_PAID` | `commission_paid` | ✅ |
| `LEAD_CREATED_FOR_YOU` | `welcome` | ⬜ (B2) |
| anything else | `generic` | — |

`welcome` and `weekly_summary` are **dormant** until B2 (lead entry) and C6
(reports) land; the layouts exist and are testable via an explicit `variant`.

## How to add a new event type

1. **DB trigger** — emit the notification via `emit_in_app_notification(...)` with
   a good `title` (becomes subject + H1) and `body_text` (the message). Keep any
   funder name role-aware (fictional `display_name_for_partner` for partners).
2. **Category** — if the event prefix isn't already handled, extend
   `eventCategory()` so the footer subscription line reads naturally
   ("...subscribed to *X* notifications").
3. **Variant** — if the event needs a distinct layout, add a case to
   `resolveVariant()` (and, if it's a brand-new archetype, a branch in
   `renderBody()` + `renderTextBody()`). Otherwise it falls through to `generic`,
   which renders title + body + CTA correctly with no code change.
4. **Preferences** — make sure the event type exists in the
   `notification_event_type` enum and that owner/recipient `notification_preferences`
   are backfilled with `email_enabled` as intended (see the A12 migration).
5. **Email allow-list** — the Edge Function attempts email for every event that
   reaches it; SPEC S4 lists which events are *in scope* to actually fire. Add the
   new event there if it should send email.

## Locked company facts (used in the footer — do not edit casually)

Fund Now Capital (Pty) Ltd · CIPC 2026/066284/07 · 010 102 0534 ·
hello@fundnowcapital.africa · www.fundnowcapital.africa ·
Cedarwood House, 128 Ballyclare Drive, Bryanston 2191 ·
75 Marshall Street, Polokwane 0699 · "Many funders. More approvals."

**Never** put a personal email (e.g. `thapelol@…`) in the notification footer —
`hello@` is the shared inbox for all replies.
