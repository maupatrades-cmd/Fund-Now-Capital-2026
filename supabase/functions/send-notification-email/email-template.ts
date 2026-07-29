// Fund Now Capital — bulletproof transactional email template v2 (A12 / SPEC S16).
//
// Content-locked per BUILD-BRIEF email-templates-v2. Table-based, inline styles
// only. One shared shell (gradient header → cyan bar → white content card →
// deep-navy 3-column footer) wrapping four variants that differ only by a 40px
// accent icon + locked copy: welcome · deal_approved · weekly_summary ·
// commission_paid. (DEAL_FUNDED reuses the deal_approved layout with funded
// copy — the brief is silent on it; documented decision.)
//
// The Edge Function hydrates display data (role-aware funder name, deal
// reference, formatted amount, client name) and passes it in; the template only
// renders. It never reads funder data itself, so a real funder name only ever
// appears when the caller resolved it for an owner recipient.
//
// COMPROMISE LOG (pre-approved, Section 12):
//   - CTA border-radius squares in Outlook 2016 → acceptable.
//   - Header/CTA gradients render as solid navy/teal in Outlook → bgcolor fallback.
//   - Inline SVG icons don't render in Outlook 2016+ (Microsoft dropped inline
//     SVG in 2025) → the accent + social icons are simply absent there; no PNG
//     fallback (accepted per brief). aria-label serves SVG-capable clients only.
//   - Footer columns stack via <div>+inline-block wrapped in an MSO ghost table
//     (no @media, since no <style> block) → documented at the use site.

// ---- Design tokens (locked, Section 4) ----
const NAVY = "#1a3a52";
const TEAL = "#2da8b8";
const CYAN = "#3ec6d9";
const GREEN = "#5dba5d";
const FOOTER_BG = "#0f2233";
const CARD = "#ffffff";
const BODY_INK = "#1e293b";
const H1_INK = "#1a3a52";
const SMALL_INK = "#64748b";
const ICON = "#2da8b8";
const PAGE_BG = "#e8ebef";
// Single quotes around 'Segoe UI' — double quotes would terminate the enclosing
// inline style="…" attribute and corrupt the markup.
const FONT = "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

// ---- Locked contact block (Section 9) ----
const LEGAL_NAME = "Fund Now Capital (Pty) Ltd";
const CIPC = "2026/066284/07";
const PHONE = "010 102 0534";
const CONTACT_EMAIL = "hello@fundnowcapital.africa";
const WEBSITE_LABEL = "www.fundnowcapital.africa";
const WEBSITE_URL = "https://www.fundnowcapital.africa";
const TAGLINE = "Many funders. More approvals.";
// Owner didn't supply the company URL — domain-only fallback (do NOT invent a slug).
const LINKEDIN_URL = "https://www.linkedin.com/";
const TIKTOK_URL = "https://www.tiktok.com/@fundnowcapital";

export type EmailVariant =
  | "welcome"
  | "deal_approved"
  | "deal_funded"
  | "weekly_summary"
  | "commission_paid"
  | "generic";

export type EmailModel = {
  eventType: string; // derives variant + category when not given
  firstName?: string | null;
  linkUrl?: string | null; // app-relative, e.g. "/deals/123"
  appBaseUrl: string;
  // hydrated deal context (null for welcome / weekly_summary or on hydration miss):
  funderDisplay?: string | null;
  dealReference?: string | null;
  amount?: string | null; // pre-formatted, e.g. "R8,000,000"
  clientName?: string | null;
  // fallbacks / overrides:
  bodyText?: string | null; // used only if a live variant can't hydrate
  variant?: EmailVariant; // explicit override (testing dormant variants)
};

export function eventCategory(eventType: string): string {
  // Invoice events (C1.1) — group under "invoice" (incl. FUNDER_INVOICE_ISSUED).
  if (eventType.startsWith("INVOICE_") || eventType === "FUNDER_INVOICE_ISSUED") return "invoice";
  if (eventType.startsWith("LEAD_")) return "lead";
  if (eventType.startsWith("DEAL_")) return "deal";
  if (eventType.startsWith("COMMISSION_")) return "commission";
  if (eventType.startsWith("FUNDER_")) return "funder";
  if (eventType.startsWith("CLIENT_")) return "client";
  if (eventType.startsWith("DOCUMENT_")) return "document";
  if (eventType.startsWith("MONTHLY_") || eventType.startsWith("TIER_") || eventType === "BADGE_EARNED") {
    return "performance";
  }
  return "account";
}

export function resolveVariant(eventType: string): EmailVariant {
  switch (eventType) {
    case "DEAL_APPROVED":
      return "deal_approved";
    case "DEAL_FUNDED":
      return "deal_funded";
    case "COMMISSION_PAID":
      return "commission_paid";
    // Lead milestones REUSE an existing visual layout (accent icon + shell);
    // their copy is lead-specific, set in variantContent() by eventType. A
    // qualified / not-qualified lead borrows the deal_approved layout (positive
    // milestone); a lead loaded for a partner borrows welcome (introductory).
    case "LEAD_QUALIFIED":
    case "LEAD_NOT_QUALIFIED":
      return "deal_approved";
    case "LEAD_CREATED_FOR_YOU":
      return "welcome";
    case "WEEKLY_SUMMARY":
      return "weekly_summary";
    // A rejected-document alert is action-needed / informational (not a
    // celebration), so it borrows the neutral weekly_summary layout; the
    // partner-safe copy is composed in the DB and surfaced via body_text.
    case "LEAD_DOCUMENT_REJECTED":
      return "weekly_summary";
    // A follow-up reminder is a neutral heads-up → weekly_summary layout; the
    // DB sweep composes the specifics (client, next action, source) into body_text.
    case "FOLLOW_UP_DUE":
      return "weekly_summary";
    // Document expiry alerts reuse the weekly_summary (neutral digest) layout —
    // an informational / action-needed tone, NOT the celebratory deal_approved
    // band. Their copy is set by eventType in variantContent() from the
    // DB-composed (pack-aware) body_text.
    case "DOCUMENT_EXPIRING_30D":
    case "DOCUMENT_EXPIRING_7D":
    case "DOCUMENT_EXPIRED":
      return "weekly_summary";
    // FNC → funder invoicing (C1.1, SPEC S7 tone map): an issued invoice is good
    // news (money going out) → deal_approved; a payment received → commission_paid;
    // an overdue invoice is action-needed/neutral → weekly_summary. Copy is
    // DB-composed into body_text (funder/client/amount).
    case "FUNDER_INVOICE_ISSUED":
      return "deal_approved";
    case "INVOICE_MARKED_PAID":
      return "commission_paid";
    case "INVOICE_OVERDUE":
      return "weekly_summary";
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

function absoluteUrl(base: string, path: string): string {
  return `${base.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}

function greetingName(firstName?: string | null): string {
  const n = (firstName ?? "").trim();
  return n ? `Hi ${n},` : "Hi there,";
}

// ---- 40px accent icons (inline SVG, monoline, stroke #2da8b8). Outlook shows alt. ----
function accentIcon(variant: EmailVariant): { svg: string; label: string } {
  const open = `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" role="img"`;
  const s = `stroke="${ICON}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"`;
  switch (variant) {
    case "welcome":
      // Open door
      return {
        label: "Welcome",
        svg: `${open} aria-label="Welcome"><path d="M4 21h16" ${s}/><path d="M15 21V4a1 1 0 0 0-1.2-1L6.5 4.5A1 1 0 0 0 6 5.4V21" ${s}/><circle cx="12.4" cy="12" r="0.9" fill="${ICON}"/></svg>`,
      };
    case "deal_approved":
    case "deal_funded":
      // Check in circle
      return {
        label: "Approved",
        svg: `${open} aria-label="Approved"><circle cx="12" cy="12" r="9" ${s}/><path d="M8 12l2.5 2.5L16 9" ${s}/></svg>`,
      };
    case "weekly_summary":
      // Bar chart
      return {
        label: "Summary",
        svg: `${open} aria-label="Weekly summary"><path d="M4 20h16" ${s}/><rect x="6" y="12" width="3" height="6" rx="1" ${s}/><rect x="11" y="8" width="3" height="10" rx="1" ${s}/><rect x="16" y="4" width="3" height="14" rx="1" ${s}/></svg>`,
      };
    case "commission_paid":
      // Rand in circle
      return {
        label: "Commission",
        svg: `${open} aria-label="Commission paid"><circle cx="12" cy="12" r="9" ${s}/><text x="12" y="16" text-anchor="middle" font-family="Arial, sans-serif" font-size="11" font-weight="bold" fill="${ICON}">R</text></svg>`,
      };
    default:
      return {
        label: "Notification",
        svg: `${open} aria-label="Notification"><circle cx="12" cy="12" r="9" ${s}/><path d="M12 8v5" ${s}/><circle cx="12" cy="16" r="0.6" fill="${ICON}"/></svg>`,
      };
  }
}

// ---- White social glyphs (inline SVG, 24px). Outlook shows alt text. ----
const SOCIAL_LINKEDIN = `<svg width="24" height="24" viewBox="0 0 24 24" role="img" aria-label="LinkedIn" xmlns="http://www.w3.org/2000/svg"><path fill="#ffffff" d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zM7.12 20.45H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0z"/></svg>`;
const SOCIAL_TIKTOK = `<svg width="24" height="24" viewBox="0 0 24 24" role="img" aria-label="TikTok" xmlns="http://www.w3.org/2000/svg"><path fill="#ffffff" d="M12.53.02C13.84 0 15.14.01 16.44 0c.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.08-.14 1.62.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/></svg>`;

type VariantContent = {
  subject: string;
  h1: string;
  ctaLabel: string;
  category: string;
  paras: string[]; // dynamic body paragraphs (after the greeting)
};

// Build the locked per-variant content (Section 7). Live variants interpolate
// hydrated fields; if a required field is missing, fall back to bodyText so an
// email never breaks.
function variantContent(m: EmailModel, variant: EmailVariant): VariantContent {
  const fd = m.funderDisplay?.trim();
  const ref = m.dealReference?.trim();
  const amt = m.amount?.trim();
  const client = m.clientName?.trim();
  const fallback = (m.bodyText ?? "").trim();

  // Lead events (B2.3) carry no funder/deal hydration — the DB trigger composes
  // the specifics (business name, deal reference, reason category) into body_text.
  // Keyed on eventType (not variant) so a lead can reuse the deal_approved /
  // welcome visual layout while showing lead-appropriate copy. Never emit a real
  // reason's internal notes here — the trigger already withholds notes from the
  // partner recipient's body_text.
  switch (m.eventType) {
    case "LEAD_QUALIFIED":
      return {
        subject: "Lead qualified",
        h1: "Lead qualified",
        ctaLabel: "View in CRM",
        category: "lead",
        paras: [
          fallback || "A lead has been qualified.",
          "Open it in the CRM to review the new deal and move it forward.",
        ],
      };
    case "LEAD_NOT_QUALIFIED":
      return {
        subject: "Lead not qualified",
        h1: "Lead not qualified",
        ctaLabel: "View in CRM",
        category: "lead",
        paras: [
          fallback || "A lead was not qualified.",
          "Open the CRM for the full context.",
        ],
      };
    case "LEAD_CREATED_FOR_YOU":
      return {
        subject: "A new lead has been loaded for you",
        h1: "A new lead for you",
        ctaLabel: "View in CRM",
        category: "lead",
        paras: [
          fallback || "A new lead has been loaded on your behalf.",
          "Sign in to the CRM to see the details and track its progress.",
        ],
      };
    case "LEAD_STARTED_QUALIFICATION":
      return {
        subject: "Lead qualification started",
        h1: "Qualification started",
        ctaLabel: "View in CRM",
        category: "lead",
        paras: [fallback || "A lead has moved into qualification."],
      };
    case "LEAD_UPDATED":
      return {
        subject: "Lead updated",
        h1: "Lead updated",
        ctaLabel: "View in CRM",
        category: "lead",
        paras: [fallback || "A lead was updated."],
      };
    // Partner-safe: the DB composes business name + document category + rejection
    // reason category into body_text (never the free-text notes or contact PII).
    case "LEAD_DOCUMENT_REJECTED":
      return {
        subject: "A document was rejected",
        h1: "A document needs re-uploading",
        ctaLabel: "View in CRM",
        category: "lead",
        paras: [
          fallback || "A document was rejected and needs to be re-uploaded.",
          "Open the CRM to see which document to replace.",
        ],
      };
    // Follow-up reminder (weekly_summary layout). The DB sweep composes the
    // client + next-action specifics into body_text (fallback).
    case "FOLLOW_UP_DUE":
      return {
        subject: "Follow-up due",
        h1: "A follow-up is due",
        ctaLabel: "View client in CRM",
        category: "client",
        paras: [
          fallback || "A logged follow-up has come due.",
          "Open the client in the CRM to action it.",
        ],
      };
    // Document expiry alerts (weekly_summary layout). The DB sweep composes the
    // full, pack-aware specifics into body_text (fallback); we add a short CTA line.
    case "DOCUMENT_EXPIRING_30D":
      return {
        subject: "Document expiring within 30 days",
        h1: "Document expiring soon",
        ctaLabel: "View in CRM",
        category: "document",
        paras: [
          fallback || "A document is expiring within 30 days.",
          "Open the CRM to review it and upload a current version before it lapses.",
        ],
      };
    case "DOCUMENT_EXPIRING_7D":
      return {
        subject: "Document expiring soon",
        h1: "Document expiring soon",
        ctaLabel: "View in CRM",
        category: "document",
        paras: [
          fallback || "A document is expiring within 7 days.",
          "Open the CRM to upload a current version before it lapses.",
        ],
      };
    case "DOCUMENT_EXPIRED":
      return {
        subject: "Document expired",
        h1: "Document expired",
        ctaLabel: "View in CRM",
        category: "document",
        paras: [
          fallback || "A document has expired.",
          "Open the CRM to upload a current version.",
        ],
      };
  }

  switch (variant) {
    case "welcome":
      return {
        subject: "Welcome to Fund Now Capital",
        h1: "Welcome to Fund Now Capital",
        ctaLabel: "Open your dashboard",
        category: "onboarding",
        paras: [
          "Thanks for joining Fund Now Capital. We help South African SMEs access funding through a panel of 43+ alternative funders — working capital, invoice discounting, PO finance, asset finance, and more.",
          "Your account is ready. Sign in to explore the CRM, review your deals, and stay on top of every stage.",
        ],
      };
    case "deal_approved":
      return {
        subject: "Deal approved",
        h1: "Deal approved",
        ctaLabel: "View deal in CRM",
        category: "deal",
        paras: [
          fd && ref && amt ? `${fd} has approved ${ref} for ${amt}.` : (fallback || "A deal has been approved."),
          "Open the deal to review the approval terms and move the deal forward.",
        ],
      };
    case "deal_funded":
      return {
        subject: "Deal funded",
        h1: "Deal funded",
        ctaLabel: "View deal in CRM",
        category: "deal",
        paras: [
          fd && ref && amt && client
            ? `${fd} has funded ${ref} for ${amt}. The advance to ${client} is complete.`
            : (fallback || "A deal has been funded."),
          "Open the deal to record the funded date and start the commission process.",
        ],
      };
    case "weekly_summary":
      return {
        subject: "Your weekly summary",
        h1: "Your week at a glance",
        ctaLabel: "View full report",
        category: "weekly summary",
        paras: [
          "Here's how last week went at Fund Now Capital. Numbers, wins, and what's moving in the pipeline.",
          "Open the report to see funders, sectors, and next actions in detail.",
        ],
      };
    case "commission_paid":
      return {
        subject: "Commission paid",
        h1: "Commission paid",
        ctaLabel: "View deal in CRM",
        category: "commission",
        paras: [
          amt && ref && client
            ? `A commission payment of ${amt} has been recorded for ${ref} (${client}).`
            : (fallback || "A commission payment has been recorded."),
          "Open the deal to see the payment breakdown and confirm the split.",
        ],
      };
    default:
      return {
        subject: "Fund Now Capital",
        h1: "Fund Now Capital",
        ctaLabel: "View in CRM",
        category: eventCategory(m.eventType),
        paras: fallback ? [fallback] : [],
      };
  }
}

// Bulletproof CTA (MSO padded VML fallback + padded anchor).
function ctaButton(url: string, label: string): string {
  const e = escapeHtml(url);
  const l = escapeHtml(label);
  return `<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${e}" style="height:48px;v-text-anchor:middle;width:220px;" arcsize="17%" strokecolor="${TEAL}" fillcolor="${TEAL}"><w:anchorlock/><center style="color:#ffffff;font-family:Arial,sans-serif;font-size:15px;font-weight:bold;">${l}</center></v:roundrect><![endif]-->
<!--[if !mso]><!-- --><a href="${e}" target="_blank" style="background-color:${TEAL};background-image:linear-gradient(90deg,${GREEN},${TEAL});border-radius:8px;color:#ffffff;display:inline-block;font-family:${FONT};font-size:15px;font-weight:600;letter-spacing:0.3px;line-height:20px;padding:14px 32px;text-decoration:none;">${l}</a>
<!--<![endif]-->`;
}

export function renderEmail(m: EmailModel): { subject: string; html: string; text: string } {
  const variant = m.variant ?? resolveVariant(m.eventType);
  const c = variantContent(m, variant);
  const base = m.appBaseUrl.replace(/\/$/, "");
  const ctaUrl = m.linkUrl ? absoluteUrl(base, m.linkUrl) : base;
  const prefsUrl = absoluteUrl(base, "/settings/notifications");
  const logoWhite = `${base}/logo-white.png`;
  const icon = accentIcon(variant);

  const greeting = greetingName(m.firstName);
  const paraHtml = c.paras
    .map(
      (p) =>
        `<p style="margin:0 0 16px;font-family:${FONT};font-size:16px;font-weight:400;line-height:1.6;color:${BODY_INK};">${escapeHtml(p)}</p>`,
    )
    .join("");

  // Footer 3 columns: inline-block <div>s (spongy/stack on mobile) inside an MSO
  // ghost table so Outlook keeps them side-by-side. No @media (no <style> block).
  const footerCols = `<!--[if mso]><table role="presentation" width="536" cellpadding="0" cellspacing="0" border="0"><tr><td width="250" valign="top"><![endif]-->
<div style="display:inline-block;vertical-align:top;width:250px;max-width:250px;">
  <p style="margin:0 0 4px;font-family:${FONT};font-size:13px;font-weight:700;line-height:1.6;color:#ffffff;">${LEGAL_NAME}</p>
  <p style="margin:0 0 10px;font-family:${FONT};font-size:13px;font-weight:400;line-height:1.6;color:rgba(255,255,255,0.6);">Cedarwood House<br>128 Ballyclare Drive<br>Bryanston 2191, Sandton</p>
  <p style="margin:0;font-family:${FONT};font-size:13px;font-weight:400;line-height:1.6;color:rgba(255,255,255,0.6);">73 Marshall Street<br>Polokwane 0699</p>
</div>
<!--[if mso]></td><td width="170" valign="top"><![endif]-->
<div style="display:inline-block;vertical-align:top;width:170px;max-width:170px;">
  <p style="margin:0 0 6px;font-family:${FONT};font-size:13px;font-weight:400;line-height:1.6;color:#ffffff;">${PHONE}</p>
  <p style="margin:0 0 6px;font-family:${FONT};font-size:13px;font-weight:400;line-height:1.6;"><a href="mailto:${CONTACT_EMAIL}" style="color:#ffffff;text-decoration:none;overflow-wrap:anywhere;">${CONTACT_EMAIL}</a></p>
  <p style="margin:0;font-family:${FONT};font-size:13px;font-weight:400;line-height:1.6;"><a href="${WEBSITE_URL}" target="_blank" style="color:${CYAN};text-decoration:none;">${WEBSITE_LABEL}</a></p>
</div>
<!--[if mso]></td><td width="110" valign="top" align="right"><![endif]-->
<div style="display:inline-block;vertical-align:top;width:110px;max-width:110px;text-align:right;">
  <a href="${LINKEDIN_URL}" target="_blank" style="text-decoration:none;">${SOCIAL_LINKEDIN}</a>
  <span style="display:inline-block;width:12px;"></span>
  <a href="${TIKTOK_URL}" target="_blank" style="text-decoration:none;">${SOCIAL_TIKTOK}</a>
</div>
<!--[if mso]></td></tr></table><![endif]-->`;

  const html = `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->
<title>${escapeHtml(c.subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:${PAGE_BG};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${PAGE_BG};">
<tr><td align="center" style="padding:24px 12px;">
<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:${CARD};">

  <!-- Block A: gradient header -->
  <tr><td align="center" bgcolor="${NAVY}" style="background-color:${NAVY};background-image:linear-gradient(135deg,${NAVY} 0%,${TEAL} 100%);padding:32px 24px 28px;">
    <img src="${logoWhite}" width="48" height="50" alt="Fund Now Capital" style="display:block;border:0;outline:none;text-decoration:none;height:auto;margin:0 auto 12px;">
    <div style="font-family:${FONT};font-size:13px;font-weight:500;letter-spacing:0.5px;color:rgba(255,255,255,0.85);">${TAGLINE}</div>
  </td></tr>

  <!-- Block B: cyan accent bar -->
  <tr><td height="3" bgcolor="${CYAN}" style="height:3px;line-height:3px;font-size:0;background-color:${CYAN};">&nbsp;</td></tr>

  <!-- Block C: content card -->
  <tr><td style="background-color:${CARD};padding:40px 40px 32px;">
    <div style="margin:0 0 16px;">${icon.svg}</div>
    <h1 style="margin:0 0 16px;font-family:${FONT};font-size:24px;font-weight:700;line-height:1.3;color:${H1_INK};">${escapeHtml(c.h1)}</h1>
    <p style="margin:0 0 16px;font-family:${FONT};font-size:16px;font-weight:400;line-height:1.6;color:${BODY_INK};">${escapeHtml(greeting)}</p>
    ${paraHtml}
    <div style="margin:32px 0 0;">${ctaButton(ctaUrl, c.ctaLabel)}</div>
    <p style="margin:40px 0 0;font-family:${FONT};font-size:12px;font-weight:400;line-height:1.6;color:${SMALL_INK};">You're receiving this because you're subscribed to ${escapeHtml(c.category)} notifications. <a href="${escapeHtml(prefsUrl)}" target="_blank" style="color:${SMALL_INK};text-decoration:underline;">Update preferences in your CRM.</a></p>
  </td></tr>

  <!-- Block D: footer -->
  <tr><td bgcolor="${FOOTER_BG}" style="background-color:${FOOTER_BG};padding:32px 32px 24px;">
    <img src="${logoWhite}" width="32" height="33" alt="Fund Now Capital" style="display:block;border:0;outline:none;text-decoration:none;height:auto;margin:0 0 20px;">
    <div style="font-size:0;">${footerCols}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:16px;"><tr>
      <td style="padding-top:16px;border-top:1px solid rgba(255,255,255,0.12);font-family:${FONT};font-size:11px;font-weight:400;line-height:1.5;color:rgba(255,255,255,0.5);">&copy; 2026 ${LEGAL_NAME} &middot; CIPC ${CIPC}</td>
    </tr></table>
  </td></tr>

</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`;

  // ---- Plain-text fallback (Section 8) ----
  const textLines = [
    c.subject,
    "",
    greeting,
    "",
    ...c.paras.flatMap((p) => [p, ""]),
    `${c.ctaLabel}: ${ctaUrl}`,
    "",
    "---",
    `You're receiving this because you're subscribed to ${c.category}`,
    `notifications. Update preferences: ${prefsUrl}`,
    "",
    `© 2026 ${LEGAL_NAME} · CIPC ${CIPC}`,
    "Cedarwood House, 128 Ballyclare Drive, Bryanston 2191, Sandton",
    "73 Marshall Street, Polokwane 0699",
    `${PHONE} · ${CONTACT_EMAIL} · ${WEBSITE_LABEL}`,
  ];

  return { subject: c.subject, html, text: textLines.join("\n") };
}
