// Account emails (welcome on invite, password reset) — one branded shell with the full Fund Now Capital logo.
// Used by admin-invite-user and request-password-reset. Table layout + inline styles so it renders in Gmail and
// Outlook; the logo is served from the CRM's own public folder (APP_BASE_URL/fnc-logo.png).

const NAVY = "#1a3a52";
const TEAL = "#2da8b8";
const GREEN = "#5dba5d";
const INK = "#334155";
const MUTED = "#64748b";
const FONT = "Inter,Arial,Helvetica,sans-serif";

export type AccountEmail =
  | { kind: "welcome"; fullName: string; roleLabel: string; actionUrl: string; actionLabel: string; tempPassword: boolean }
  | { kind: "reset"; fullName: string; actionUrl: string };

function esc(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function button(url: string, label: string): string {
  return `<a href="${esc(url)}" target="_blank" style="background-color:${TEAL};background-image:linear-gradient(90deg,${GREEN},${TEAL});border-radius:8px;color:#ffffff;display:inline-block;font-family:${FONT};font-size:15px;font-weight:600;line-height:20px;padding:14px 32px;text-decoration:none;">${esc(label)}</a>`;
}

export function renderAccountEmail(m: AccountEmail, appBaseUrl: string): { subject: string; html: string; text: string } {
  const base = appBaseUrl.replace(/\/$/, "");
  const loginUrl = `${base}/`;
  const forgotUrl = `${base}/forgot-password`;
  const first = m.fullName.trim().split(/\s+/)[0] ?? "";
  const greeting = first ? `Hi ${first},` : "Hi,";

  let subject: string;
  let heading: string;
  let paras: string[];
  let note: string;
  if (m.kind === "welcome") {
    subject = "Welcome to Fund Now Capital";
    heading = "Welcome to the team";
    paras = [
      `You have been added to the Fund Now Capital CRM as <strong>${esc(m.roleLabel)}</strong>.`,
      m.tempPassword
        ? "Your temporary password will be given to you in person by the Director. Sign in with your email address and that password; you will then choose your own private password."
        : "Use the button below to choose your password and sign in. The link works once and expires after a short time.",
    ];
    note = "If you did not expect this email, you can ignore it.";
  } else {
    subject = "Reset your Fund Now Capital password";
    heading = "Reset your password";
    paras = ["We received a request to reset the password for your Fund Now Capital account. Use the button below to choose a new password. The link works once and expires after a short time."];
    note = "If you did not ask for this, you can ignore this email: your password stays the same.";
  }
  const actionUrl = m.actionUrl;
  const actionLabel = m.kind === "welcome" ? m.actionLabel : "Choose a new password";

  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 0;"><tr><td align="center">
 <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;">
  <tr><td style="padding:28px 32px 20px;border-bottom:4px solid ${TEAL};">
   <img src="${esc(base)}/fnc-logo.png" width="240" height="52" alt="Fund Now Capital — Many funders. More approvals." style="display:block;border:0;outline:none;text-decoration:none;height:auto;max-width:240px;">
  </td></tr>
  <tr><td style="padding:32px;font-family:${FONT};color:${INK};font-size:15px;line-height:1.6;">
   <h1 style="margin:0 0 16px;font-family:${FONT};font-size:22px;line-height:1.3;color:${NAVY};">${esc(heading)}</h1>
   <p style="margin:0 0 12px;">${esc(greeting)}</p>
   ${paras.map((p) => `<p style="margin:0 0 12px;">${p}</p>`).join("\n   ")}
   <p style="margin:28px 0;text-align:center;">${button(actionUrl, actionLabel)}</p>
   <p style="margin:0 0 6px;color:${MUTED};font-size:13px;">If the button does not work, copy this link into your browser:</p>
   <p style="margin:0 0 20px;word-break:break-all;font-size:12px;"><a href="${esc(actionUrl)}" style="color:${TEAL};">${esc(actionUrl)}</a></p>
   <p style="margin:0 0 6px;color:${MUTED};font-size:13px;">Sign in any time at <a href="${esc(loginUrl)}" style="color:${TEAL};">${esc(loginUrl)}</a>.</p>
   <p style="margin:0;color:${MUTED};font-size:13px;">Forgot your password? <a href="${esc(forgotUrl)}" style="color:${TEAL};">Reset it here</a>.</p>
   <p style="margin:24px 0 0;color:${MUTED};font-size:12px;">${esc(note)}</p>
  </td></tr>
  <tr><td style="background:${NAVY};padding:16px 32px;font-family:${FONT};color:rgba(255,255,255,0.6);font-size:11px;">© ${new Date().getFullYear()} Fund Now Capital (Pty) Ltd · Many funders. More approvals.</td></tr>
 </table>
</td></tr></table></body></html>`;

  const plain = (s: string) => s.replace(/<[^>]+>/g, "");
  const text = [
    heading, "", greeting, "", ...paras.map(plain), "",
    `${actionLabel}: ${actionUrl}`, "",
    `Sign in: ${loginUrl}`, `Forgot your password? ${forgotUrl}`, "", note, "", "— Fund Now Capital",
  ].join("\n");
  return { subject, html, text };
}
