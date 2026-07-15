// Fund Now Capital — bulletproof transactional email template (A12 / SPEC S4).
//
// TABLE-BASED, INLINE-STYLES-ONLY. No <style> block, no CSS classes, no flexbox,
// no grid — every style is an inline attribute on a <table>/<td>. This is the
// widest-compatibility approach for Outlook (Word rendering engine), Gmail web,
// Gmail iOS/Android, and Apple Mail.
//
// Because there is no <style> block we cannot use @media queries, so the layout
// does not "stack" on narrow screens; sizes are chosen to stay legible when a
// mobile client scales the 600px shell down. Logos/icons are hosted PNGs (Outlook
// has no SVG support) referenced by absolute HTTPS URL under APP_BASE_URL.
//
// One shared header + footer shell wraps four content variants:
//   welcome · deal_approved · weekly_summary · commission_paid
// Only DEAL_APPROVED / DEAL_FUNDED / COMMISSION_PAID fire today (DEAL_FUNDED
// reuses the deal_approved success layout); welcome + weekly_summary lie dormant
// until B2 (lead entry) and C6 (reports) land.
//
// The template renders whatever the caller supplies (title, body text, link,
// recipient first name) — it never fetches funder data itself, so the DB layer's
// role-aware fictional funder names in `body_text` pass straight through
// unchanged. Nothing here can surface a real funder name.

// ---- Brand tokens ----
const NAVY = "#1a3a52"; // primary navy
const NAVY_DEEP = "#0d2438"; // footer
const TEAL = "#2da8b8";
const CYAN = "#00C9D4";
const GREEN = "#5dba5d";
const GREEN_TINT = "#9fe09f";
const CYAN_TINT = "#c6f4f7";
const INK = "#1a3a52";
const BODY_INK = "#334155";
const MUTED = "#8B95A5";
const CARD = "#ffffff";
const PAGE_BG = "#e5e7eb";
const SHELL_BG = "#f8f9fb";
const TILE_BG = "#f8f9fb";
const BORDER = "#e5e7eb";
const FONT = "Arial, Helvetica, sans-serif";

// ---- Locked company facts (owner-confirmed; do NOT add personal emails here) ----
const LEGAL_NAME = "Fund Now Capital (Pty) Ltd";
const CIPC = "2026/066284/07";
const PHONE = "010 102 0534";
const CONTACT_EMAIL = "hello@fundnowcapital.africa";
const WEBSITE_LABEL = "www.fundnowcapital.africa";
const WEBSITE_URL = "https://www.fundnowcapital.africa";
const ADDRESS_SANDTON = "Cedarwood House, 128 Ballyclare Drive, Bryanston 2191";
const ADDRESS_POLOKWANE = "75 Marshall Street, Polokwane 0699";
const TAGLINE_A = "Many funders."; // green tint
const TAGLINE_B = "More approvals."; // cyan tint
// NOTE: confirm the LinkedIn company URL with the owner — best-guess slug for now.
const LINKEDIN_URL = "https://www.linkedin.com/company/fund-now-capital";
const TIKTOK_URL = "https://www.tiktok.com/@fundnowcapital"; // derived from @fundnowcapital

export type EmailVariant =
  | "welcome"
  | "deal_approved"
  | "weekly_summary"
  | "commission_paid"
  | "generic";

export type StatTile = { label: string; value: string };

export type EmailModel = {
  title: string;
  bodyText: string | null;
  linkUrl: string | null; // app-relative, e.g. "/deals/123"
  firstName?: string | null;
  eventType: string; // used to derive variant + category when not given explicitly
  appBaseUrl: string; // e.g. "https://fund-now-capital-2026.vercel.app"
  variant?: EmailVariant; // explicit override (dormant variants / testing)
  eventCategory?: string; // footer subscription line; derived from eventType if absent
  ctaLabel?: string; // default "View in CRM"
  // weekly_summary only:
  stats?: StatTile[];
  statusRows?: { label: string; value: string }[];
};

// Friendly category for the footer subscription line.
export function eventCategory(eventType: string): string {
  if (eventType.startsWith("LEAD_")) return "lead";
  if (eventType.startsWith("DEAL_")) return "deal";
  if (eventType.startsWith("COMMISSION_")) return "commission";
  if (eventType.startsWith("FUNDER_")) return "funder";
  if (eventType.startsWith("CLIENT_")) return "client";
  if (eventType.startsWith("DOCUMENT_")) return "document";
  if (
    eventType.startsWith("MONTHLY_") ||
    eventType.startsWith("TIER_") ||
    eventType === "BADGE_EARNED"
  ) {
    return "performance";
  }
  return "account";
}

// Map a notification event type to a layout variant.
export function resolveVariant(eventType: string): EmailVariant {
  switch (eventType) {
    case "DEAL_APPROVED":
    case "DEAL_FUNDED":
      return "deal_approved"; // shared green success layout
    case "COMMISSION_PAID":
      return "commission_paid";
    case "LEAD_CREATED_FOR_YOU":
      return "welcome";
    default:
      return "generic";
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Join the app base and an app-relative path without doubling the slash.
function absoluteUrl(base: string, path: string): string {
  return `${base.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}

function greeting(firstName?: string | null): string {
  const name = (firstName ?? "").trim();
  return name ? `Hi ${escapeHtml(name)},` : "Hi there,";
}

// Bulletproof CTA button: role=presentation table + padded anchor (Outlook-safe).
function ctaButton(url: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px auto 0;"><tr>
    <td align="center" bgcolor="${TEAL}" style="border-radius:8px;background-image:linear-gradient(90deg,${GREEN},${TEAL});">
      <a href="${escapeHtml(url)}" target="_blank" style="display:inline-block;padding:14px 32px;font-family:${FONT};font-size:16px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:8px;">${escapeHtml(label)}</a>
    </td></tr></table>`;
}

function paragraph(text: string): string {
  return `<p style="margin:0 0 16px;font-family:${FONT};font-size:16px;line-height:1.65;color:${BODY_INK};">${escapeHtml(text)}</p>`;
}

// Green "success band" wrapping the key message (deal_approved / commission_paid).
function successBand(heading: string, body: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;"><tr>
    <td style="background-color:#f0fdf4;border-left:4px solid ${GREEN};border-radius:0 8px 8px 0;padding:16px 18px;">
      <p style="margin:0 0 6px;font-family:${FONT};font-size:13px;font-weight:bold;letter-spacing:0.5px;color:#3d8f3d;text-transform:uppercase;">${escapeHtml(heading)}</p>
      <p style="margin:0;font-family:${FONT};font-size:16px;line-height:1.6;color:${INK};">${escapeHtml(body)}</p>
    </td></tr></table>`;
}

// Weekly stat tiles rendered as a table row of cells (no flex/grid).
function statTiles(stats: StatTile[]): string {
  if (!stats.length) return "";
  const cells = stats
    .map(
      (s) => `<td width="33%" valign="top" style="padding:4px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${TILE_BG};border:1px solid ${BORDER};border-radius:8px;"><tr>
          <td style="padding:14px 12px;text-align:center;">
            <div style="font-family:${FONT};font-size:24px;font-weight:bold;color:${INK};">${escapeHtml(s.value)}</div>
            <div style="font-family:${FONT};font-size:11px;font-weight:bold;letter-spacing:1px;color:#6b7280;text-transform:uppercase;padding-top:4px;">${escapeHtml(s.label)}</div>
          </td></tr></table></td>`,
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;"><tr>${cells}</tr></table>`;
}

function statusRows(rows: { label: string; value: string }[]): string {
  if (!rows.length) return "";
  const trs = rows
    .map(
      (r) => `<tr>
        <td style="padding:12px 0;border-bottom:1px solid ${BORDER};font-family:${FONT};font-size:14px;color:${BODY_INK};">${escapeHtml(r.label)}</td>
        <td align="right" style="padding:12px 0;border-bottom:1px solid ${BORDER};font-family:${FONT};font-size:14px;font-weight:bold;color:${INK};">${escapeHtml(r.value)}</td>
      </tr>`,
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;">${trs}</table>`;
}

// ---- Body renderers per variant ----
function renderBody(m: EmailModel, variant: EmailVariant, ctaUrl: string | null, ctaLabel: string): string {
  const hello = `<p style="margin:0 0 16px;font-family:${FONT};font-size:18px;font-weight:bold;color:${INK};">${greeting(m.firstName)}</p>`;
  const body = m.bodyText ? escapeHtml(m.bodyText) : "";
  const cta = ctaUrl ? ctaButton(ctaUrl, ctaLabel) : "";

  switch (variant) {
    case "deal_approved":
      return (
        hello +
        paragraph("Here's a quick update from your pipeline:") +
        (m.bodyText ? successBand("Deal update", m.bodyText) : "") +
        cta
      );
    case "commission_paid":
      return (
        hello +
        paragraph("Good news — a commission payment has been recorded:") +
        (m.bodyText ? successBand("Commission paid", m.bodyText) : "") +
        cta
      );
    case "weekly_summary":
      return (
        hello +
        (m.bodyText ? paragraph(m.bodyText) : "") +
        statTiles(m.stats ?? []) +
        statusRows(m.statusRows ?? []) +
        cta
      );
    case "welcome":
      return (
        hello +
        (m.bodyText ? paragraph(m.bodyText) : "") +
        cta
      );
    case "generic":
    default:
      return hello + (m.bodyText ? paragraph(m.bodyText) : "") + cta;
  }
}

// Plain-text body per variant (deliverability requirement).
function renderTextBody(m: EmailModel, variant: EmailVariant, ctaUrl: string | null, ctaLabel: string): string[] {
  const lines: string[] = [greeting(m.firstName).replace(/&#39;/g, "'"), ""];
  if (variant === "weekly_summary") {
    if (m.bodyText) lines.push(m.bodyText, "");
    for (const s of m.stats ?? []) lines.push(`- ${s.label}: ${s.value}`);
    if ((m.stats ?? []).length) lines.push("");
    for (const r of m.statusRows ?? []) lines.push(`- ${r.label}: ${r.value}`);
    if ((m.statusRows ?? []).length) lines.push("");
  } else if (m.bodyText) {
    lines.push(m.bodyText, "");
  }
  if (ctaUrl) lines.push(`${ctaLabel}: ${ctaUrl}`, "");
  return lines;
}

export function renderEmail(m: EmailModel): { html: string; text: string } {
  const variant = m.variant ?? resolveVariant(m.eventType);
  const category = m.eventCategory ?? eventCategory(m.eventType);
  const ctaLabel = m.ctaLabel ?? "View in CRM";
  const base = m.appBaseUrl.replace(/\/$/, "");
  const ctaUrl = m.linkUrl ? absoluteUrl(base, m.linkUrl) : null;
  const prefsUrl = absoluteUrl(base, "/settings/notifications");
  const logoWhite = `${base}/email-assets/logo-white.png`;
  const iconLinkedIn = `${base}/email-assets/social-linkedin.png`;
  const iconTikTok = `${base}/email-assets/social-tiktok.png`;

  const bodyHtml = renderBody(m, variant, ctaUrl, ctaLabel);

  const html = `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>${escapeHtml(m.title)}</title>
</head>
<body style="margin:0;padding:0;background-color:${PAGE_BG};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${PAGE_BG};">
<tr><td align="center" style="padding:24px 12px;">

<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background-color:${SHELL_BG};border-radius:12px;overflow:hidden;">

<!-- Header: navy->teal gradient (solid navy fallback for Outlook) -->
<tr>
<td align="center" bgcolor="${NAVY}" style="background-color:${NAVY};background-image:linear-gradient(135deg,${NAVY},${TEAL});border-bottom:3px solid ${CYAN};padding:30px 24px 26px;">
  <img src="${logoWhite}" width="52" height="54" alt="Fund Now Capital" style="display:block;border:0;outline:none;text-decoration:none;height:auto;margin:0 auto 12px;">
  <div style="font-family:${FONT};font-size:15px;font-weight:600;letter-spacing:0.5px;line-height:1.4;">
    <span style="color:${GREEN_TINT};">${TAGLINE_A}</span> <span style="color:${CYAN_TINT};">${TAGLINE_B}</span>
  </div>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:12px auto 0;"><tr>
    <td width="40" height="2" style="width:40px;height:2px;background-color:${CYAN};font-size:0;line-height:0;">&nbsp;</td>
  </tr></table>
</td>
</tr>

<!-- Body card -->
<tr>
<td style="padding:32px 24px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${CARD};border-radius:12px;"><tr>
    <td style="padding:32px 28px;">
      <h1 style="margin:0 0 16px;font-family:${FONT};font-size:26px;line-height:1.3;color:${INK};">${escapeHtml(m.title)}</h1>
      ${bodyHtml}
    </td>
  </tr></table>
</td>
</tr>

<!-- Footer: deep navy -->
<tr>
<td bgcolor="${NAVY_DEEP}" style="background-color:${NAVY_DEEP};padding:32px 24px;">

  <!-- brand row -->
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;"><tr>
    <td valign="middle"><img src="${logoWhite}" width="30" height="31" alt="Fund Now Capital" style="display:block;border:0;height:auto;"></td>
    <td valign="middle" style="padding-left:10px;font-family:${FONT};font-size:18px;font-weight:bold;color:#ffffff;">Fund Now Capital</td>
  </tr></table>

  <!-- 3 columns -->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
    <td width="40%" valign="top" style="padding:0 12px 0 0;">
      <p style="margin:0 0 10px;font-family:${FONT};font-size:11px;font-weight:bold;letter-spacing:1.5px;color:${CYAN};text-transform:uppercase;">Offices</p>
      <p style="margin:0 0 4px;font-family:${FONT};font-size:13px;font-weight:bold;color:#f8f9fb;">${LEGAL_NAME}</p>
      <p style="margin:0 0 8px;font-family:${FONT};font-size:13px;line-height:1.6;color:${MUTED};">${ADDRESS_SANDTON}</p>
      <p style="margin:0;font-family:${FONT};font-size:13px;line-height:1.6;color:${MUTED};">${ADDRESS_POLOKWANE}</p>
    </td>
    <td width="35%" valign="top" style="padding:0 12px;">
      <p style="margin:0 0 10px;font-family:${FONT};font-size:11px;font-weight:bold;letter-spacing:1.5px;color:${CYAN};text-transform:uppercase;">Contact</p>
      <p style="margin:0 0 8px;font-family:${FONT};font-size:13px;line-height:1.6;color:#f8f9fb;">${PHONE}</p>
      <p style="margin:0 0 8px;font-family:${FONT};font-size:13px;line-height:1.6;"><a href="mailto:${CONTACT_EMAIL}" style="color:#f8f9fb;text-decoration:none;overflow-wrap:anywhere;">${CONTACT_EMAIL}</a></p>
      <p style="margin:0;font-family:${FONT};font-size:13px;line-height:1.6;"><a href="${WEBSITE_URL}" target="_blank" style="color:${CYAN};text-decoration:none;">${WEBSITE_LABEL}</a></p>
    </td>
    <td width="25%" valign="top" style="padding:0 0 0 12px;">
      <p style="margin:0 0 10px;font-family:${FONT};font-size:11px;font-weight:bold;letter-spacing:1.5px;color:${CYAN};text-transform:uppercase;">Connect</p>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="padding-right:12px;"><a href="${LINKEDIN_URL}" target="_blank"><img src="${iconLinkedIn}" width="26" height="26" alt="LinkedIn" style="display:block;border:0;height:auto;"></a></td>
        <td><a href="${TIKTOK_URL}" target="_blank"><img src="${iconTikTok}" width="26" height="26" alt="TikTok" style="display:block;border:0;height:auto;"></a></td>
      </tr></table>
    </td>
  </tr></table>

  <!-- divider -->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;"><tr>
    <td height="1" style="height:1px;background-color:#22415a;font-size:0;line-height:0;">&nbsp;</td>
  </tr></table>

  <!-- legal + subscription -->
  <p style="margin:0 0 10px;font-family:${FONT};font-size:12px;line-height:1.6;color:${MUTED};">
    You're receiving this because you're subscribed to ${escapeHtml(category)} notifications. <a href="${prefsUrl}" target="_blank" style="color:${CYAN};text-decoration:underline;">Update your preferences in your CRM.</a>
  </p>
  <p style="margin:0 0 4px;font-family:${FONT};font-size:13px;font-weight:bold;color:#ffffff;">${TAGLINE_A} ${TAGLINE_B}</p>
  <p style="margin:0;font-family:${FONT};font-size:11px;line-height:1.5;color:${MUTED};">&copy; 2026 ${LEGAL_NAME} &middot; CIPC ${CIPC}</p>

</td>
</tr>

</table>

</td></tr>
</table>
</body>
</html>`;

  const textLines = [
    "FUND NOW CAPITAL",
    `${TAGLINE_A} ${TAGLINE_B}`,
    "",
    m.title,
    "",
    ...renderTextBody(m, variant, ctaUrl, ctaLabel),
    "—",
    `You're receiving this because you're subscribed to ${category} notifications.`,
    `Update your preferences: ${prefsUrl}`,
    "",
    `${LEGAL_NAME}`,
    `${ADDRESS_SANDTON}`,
    `${ADDRESS_POLOKWANE}`,
    `${PHONE} · ${CONTACT_EMAIL} · ${WEBSITE_LABEL}`,
    `© 2026 ${LEGAL_NAME} · CIPC ${CIPC}`,
  ];

  return { html, text: textLines.join("\n") };
}
