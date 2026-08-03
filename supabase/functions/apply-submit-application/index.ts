// apply-submit-application (Public Application Entry Point — Sprint 2 Lane 2a)
//
// The PUBLIC, unauthenticated endpoint behind the /apply form (ONBOARDING.md
// Stage 1). A cold applicant submits their details; this function validates the
// payload, throttles by IP, creates the contractors record at status
// 'applicant', notifies every owner, and sends the applicant a confirmation
// email.
//
// AUTH MODEL — why verify_jwt=false and no caller check:
//   Unlike admin-invite-user (owner's browser, is_owner() gate), this endpoint
//   is deliberately OPEN — anyone on the internet can apply. There is no user to
//   authenticate. All privileged work (the DB write, the owner notification) is
//   done through the SERVICE-ROLE key via a single DEFINER RPC
//   (submit_contractor_application) that is granted to service_role ONLY — never
//   to anon/authenticated — so the public cannot reach the contractors table or
//   the RPC directly; only this function can. verify_jwt=false lets the function
//   answer the CORS preflight and return clean JSON (incl. a 429) itself.
//
// Spam/abuse: the RPC records every attempt in an IP-keyed ledger (hashed IP,
// POPIA) and returns {status:'rate_limited'} once the window is exceeded, which
// we surface as HTTP 429. The IP is SHA-256 hashed here before it ever reaches
// the DB — the raw IP is never stored.
//
// POPIA: the applicant confirmation email contains ONLY the applicant's own
// name — it never leaks any other application or CRM data. Application data at
// rest is protected by Supabase disk encryption + owner-only RLS on contractors.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-injected); RESEND_API_KEY,
//      APP_BASE_URL, optionally EMAIL_FROM / EMAIL_REPLY_TO / APPLY_IP_SALT
//      (project-wide secrets; RESEND_API_KEY/APP_BASE_URL already set).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM = Deno.env.get("EMAIL_FROM") ?? "Fund Now Capital <hello@fundnowcapital.africa>";
const REPLY_TO = Deno.env.get("EMAIL_REPLY_TO") ?? "hello@fundnowcapital.africa";
// A static salt keeps the hashed IP from being a bare, reversible SHA-256 of a
// small IPv4 space. It need not be secret to be useful here.
const IP_SALT = Deno.env.get("APPLY_IP_SALT") ?? "fnc-apply-v1";

// Throttle: at most this many submissions per IP per window (seconds).
const RATE_MAX = 5;
const RATE_WINDOW_SECONDS = 60;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function isEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

// SHA-256(salt + ip) -> hex. Returns null when no client IP is resolvable (we
// then skip throttling rather than block legitimate users).
async function hashIp(req: Request): Promise<string | null> {
  const fwd = req.headers.get("x-forwarded-for") ?? "";
  const ip = fwd.split(",")[0]?.trim() || req.headers.get("x-real-ip")?.trim() || "";
  if (!ip) return null;
  const bytes = new TextEncoder().encode(`${IP_SALT}:${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

type ApplyBody = {
  full_name?: string;
  email?: string;
  phone?: string;
  id_number?: string;
  physical_address?: string;
  experience_years?: number | string;
  motivation_text?: string;
  referral_source?: string;
  referral_source_other?: string;
};

// Branded applicant confirmation email (dependency-free Resend REST call, same
// shell as admin-invite-user). Returns true on a 2xx from Resend; a delivery
// failure never rolls back the already-captured application.
async function sendConfirmationEmail(to: string, fullName: string): Promise<boolean> {
  if (!RESEND_API_KEY) return false;
  const greeting = fullName ? `Hi ${fullName},` : "Hi,";
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f1f5f9;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 0;">
   <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;">
     <tr><td style="background:#1a3a52;padding:24px 32px;">
       <div style="color:#ffffff;font-size:18px;font-weight:bold;">Fund Now <span style="color:#2da8b8;">Capital</span></div>
       <div style="color:rgba(255,255,255,0.6);font-size:12px;margin-top:2px;">Many funders. More approvals.</div>
     </td></tr>
     <tr><td style="padding:32px;color:#1a3a52;font-size:15px;line-height:1.6;">
       <p style="margin:0 0 12px;">${greeting}</p>
       <p style="margin:0 0 12px;">Thank you for applying to become a <strong>Fund Now Capital contractor</strong>. We've received your application and it's now with our team.</p>
       <p style="margin:0 0 12px;">We review every application carefully and will be in touch within <strong>5 business days</strong> with the next step. There's nothing you need to do in the meantime.</p>
       <p style="margin:0 0 12px;">We appreciate your interest in helping South African businesses access the funding they need to grow.</p>
       <p style="margin:24px 0 0;">Warm regards,<br/>The Fund Now Capital team</p>
     </td></tr>
     <tr><td style="background:#1a3a52;padding:16px 32px;color:rgba(255,255,255,0.45);font-size:11px;">© 2026 Fund Now Capital (Pty) Ltd</td></tr>
    </table>
   </td></tr>
  </table></body></html>`;
  const text =
    `${greeting}\n\nThank you for applying to become a Fund Now Capital contractor. ` +
    `We've received your application and it's now with our team.\n\n` +
    `We review every application carefully and will be in touch within 5 business days ` +
    `with the next step. There's nothing you need to do in the meantime.\n\n` +
    `Warm regards,\nThe Fund Now Capital team`;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: FROM,
        to: [to],
        reply_to: REPLY_TO,
        subject: "We've received your Fund Now Capital application",
        html,
        text,
      }),
    });
    if (!res.ok) console.error("Resend returned non-2xx:", res.status);
    return res.ok;
  } catch (e) {
    console.error("Resend request failed:", (e as Error).message);
    return false;
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // ---- parse + validate ----------------------------------------------------
  let body: ApplyBody;
  try {
    body = (await req.json()) as ApplyBody;
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }

  const fullName = (body.full_name ?? "").trim();
  const email = (body.email ?? "").trim().toLowerCase();
  const phone = (body.phone ?? "").trim();
  const idNumber = (body.id_number ?? "").trim();
  const address = (body.physical_address ?? "").trim();
  const motivation = (body.motivation_text ?? "").trim();
  const referralSource = (body.referral_source ?? "").trim();
  const referralOther = (body.referral_source_other ?? "").trim();
  const expRaw = `${body.experience_years ?? ""}`.trim();

  if (!fullName) return json({ error: "Full name is required" }, 400);
  if (!isEmail(email)) return json({ error: "A valid email address is required" }, 400);
  if (!phone) return json({ error: "Phone is required" }, 400);
  if (!address) return json({ error: "Physical address is required" }, 400);
  if (!/^\d{1,3}$/.test(expRaw)) return json({ error: "Years of experience must be a whole number" }, 400);
  const experience = Number(expRaw);
  if (experience < 0 || experience > 80) return json({ error: "Years of experience must be between 0 and 80" }, 400);
  if (motivation.length < 50) return json({ error: "Please tell us a little more (at least 50 characters)" }, 400);

  const ipHash = await hashIp(req);

  const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ---- create the application (service-role DEFINER RPC) -------------------
  const { data, error } = await service.rpc("submit_contractor_application", {
    p_payload: {
      full_name: fullName,
      email,
      phone,
      id_number: idNumber || null,
      physical_address: address,
      experience_years: expRaw,
      motivation_text: motivation,
      referral_source: referralSource || null,
      referral_source_other: referralOther || null,
    },
    p_ip_hash: ipHash,
    p_max_per_window: RATE_MAX,
    p_window_seconds: RATE_WINDOW_SECONDS,
  });

  if (error) {
    // The RPC re-validates (defence-in-depth) and raises validation failures with
    // SQLSTATE 22023 — treat those as a 400 (bad payload that slipped past the
    // checks above). Anything else is an unexpected server/DB failure: return a
    // retryable 503 so the applicant is told to try again, not to "fix" details
    // that are fine. Either way we log the real reason and never leak internals.
    console.error("submit_contractor_application failed:", error.code, error.message);
    if ((error as { code?: string }).code === "22023") {
      return json({ error: "We couldn't submit your application. Please check your details and try again." }, 400);
    }
    return json({ error: "Something went wrong on our side. Please try again in a moment." }, 503);
  }

  const status = (data as { status?: string } | null)?.status;
  if (status === "rate_limited") {
    return json(
      { error: "Too many applications from this connection. Please wait a minute and try again." },
      429,
    );
  }
  if (status !== "created") {
    console.error("submit_contractor_application unexpected result:", data);
    return json({ error: "We couldn't submit your application. Please try again shortly." }, 500);
  }

  // ---- applicant confirmation email (best-effort) --------------------------
  // A send failure does NOT fail the request — the application is safely
  // recorded and the owner has been notified. The UI shows the thank-you either
  // way; email_sent tells it whether to mention the email.
  const emailSent = await sendConfirmationEmail(email, fullName);

  return json({ ok: true, status: "created", email_sent: emailSent });
});
