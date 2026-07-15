// Branded Fund Now Capital notification email (A12 / SPEC S4).
// Table-based, inline-styled HTML for broad email-client support, plus a plain
// text fallback. No external images (the "FN" mark is CSS) so it renders even
// where remote/data images are blocked (e.g. Gmail).

const NAVY = "#1a3a52";
const TEAL = "#2da8b8";
const GREEN = "#5dba5d";

export type EmailModel = {
  title: string;
  bodyText: string | null;
  linkUrl: string | null; // app-relative, e.g. "/deals/123"
  eventType: string;
  appBaseUrl: string; // e.g. "https://app.fundnowcapital.africa"
};

// Friendly category for the footer subscription line.
export function eventCategory(eventType: string): string {
  if (eventType.startsWith("LEAD_")) return "lead";
  if (eventType.startsWith("DEAL_")) return "deal";
  if (eventType.startsWith("COMMISSION_")) return "commission";
  if (eventType.startsWith("FUNDER_")) return "funder";
  if (eventType.startsWith("CLIENT_")) return "client";
  if (eventType.startsWith("DOCUMENT_")) return "document";
  if (eventType.startsWith("MONTHLY_") || eventType.startsWith("TIER_") || eventType === "BADGE_EARNED")
    return "performance";
  return "account";
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

export function renderEmail(m: EmailModel): { html: string; text: string } {
  const category = eventCategory(m.eventType);
  const prefsUrl = absoluteUrl(m.appBaseUrl, "/settings/notifications");
  const ctaUrl = m.linkUrl ? absoluteUrl(m.appBaseUrl, m.linkUrl) : null;

  const bodyParagraph = m.bodyText
    ? `<p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#334155;">${escapeHtml(m.bodyText)}</p>`
    : "";

  const ctaButton = ctaUrl
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 8px;">
         <tr><td style="border-radius:8px;background-image:linear-gradient(90deg,${GREEN},${TEAL});background-color:${TEAL};">
           <a href="${escapeHtml(ctaUrl)}" style="display:inline-block;padding:13px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">View in CRM</a>
         </td></tr>
       </table>`
    : "";

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only"><title>${escapeHtml(m.title)}</title></head>
<body style="margin:0;padding:0;background-color:#f1f5f9;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background-color:#ffffff;border-radius:12px;overflow:hidden;font-family:'Inter',Arial,Helvetica,sans-serif;">
        <!-- Header -->
        <tr><td style="background-color:${NAVY};padding:20px 32px;">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td style="width:40px;height:40px;background-color:#ffffff;border-radius:8px;text-align:center;vertical-align:middle;font-size:16px;font-weight:800;color:${NAVY};letter-spacing:0.5px;">FN</td>
            <td style="padding-left:12px;font-size:18px;font-weight:700;color:#ffffff;vertical-align:middle;">Fund Now Capital</td>
          </tr></table>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:32px;">
          <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:${NAVY};">${escapeHtml(m.title)}</h1>
          ${bodyParagraph}
          ${ctaButton}
        </td></tr>
        <!-- Footer -->
        <tr><td style="background-color:${NAVY};padding:24px 32px;">
          <p style="margin:0 0 12px;font-size:12px;line-height:1.6;color:#cbd5e1;">
            You're receiving this because you're subscribed to ${escapeHtml(category)} notifications.
            <a href="${escapeHtml(prefsUrl)}" style="color:#7fd4e0;text-decoration:underline;">Update your preferences in your CRM.</a>
          </p>
          <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:#ffffff;">Many funders. More approvals.</p>
          <p style="margin:0;font-size:11px;color:#94a3b8;">© 2026 Fund Now Capital (Pty) Ltd · CIPC 2026/066284/07</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  const textLines = [
    "FUND NOW CAPITAL",
    "",
    m.title,
    "",
    ...(m.bodyText ? [m.bodyText, ""] : []),
    ...(ctaUrl ? [`View in CRM: ${ctaUrl}`, ""] : []),
    "—",
    `You're receiving this because you're subscribed to ${category} notifications.`,
    `Update your preferences: ${prefsUrl}`,
    "",
    "Many funders. More approvals.",
    "© 2026 Fund Now Capital (Pty) Ltd · CIPC 2026/066284/07",
  ];

  return { html, text: textLines.join("\n") };
}
