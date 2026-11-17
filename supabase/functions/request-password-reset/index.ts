// request-password-reset (public, verify_jwt = false)
//
// "Forgot password" on the sign-in page. Sends a branded, single-use password-reset link to an active staff, agent
// or Director account. Always answers the same way so nobody can learn which emails have accounts. Throttled per
// email and per IP (hashed, never stored in clear) in public.password_reset_requests, same pattern as
// request-client-magic-link. Clients keep their own magic-link sign-in and are not served here.
import { createClient } from "npm:@supabase/supabase-js@2";
import { renderAccountEmail } from "../_shared/account-email.ts";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const APP_BASE_URL = (Deno.env.get("APP_BASE_URL") ?? "").replace(/\/$/, "");
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const EMAIL_FROM = Deno.env.get("EMAIL_FROM") ?? "Fund Now Capital <hello@fundnowcapital.africa>";
const REPLY_TO = Deno.env.get("EMAIL_REPLY_TO") ?? "hello@fundnowcapital.africa";
const RATE_SECRET = Deno.env.get("CLIENT_AUTH_RATE_LIMIT_SECRET") ?? "";

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...CORS_HEADERS, "content-type": "application/json", "cache-control": "no-store" },
});

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function normaliseEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

async function deliver(service: ReturnType<typeof createClient>, email: string, fullName: string, requestId: string) {
  let status = "failed";
  let failureCode: string | null = "delivery_failed";
  try {
    const { data, error } = await service.auth.admin.generateLink({
      type: "recovery",
      email,
      options: { redirectTo: `${APP_BASE_URL}/reset-password` },
    });
    const link = data?.properties?.action_link;
    if (error || !link) {
      failureCode = "link_generation_failed";
    } else {
      const content = renderAccountEmail({ kind: "reset", fullName, actionUrl: link }, APP_BASE_URL);
      const sent = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "content-type": "application/json" },
        body: JSON.stringify({ from: EMAIL_FROM, to: [email], reply_to: REPLY_TO, ...content }),
      });
      status = sent.ok ? "sent" : "failed";
      failureCode = sent.ok ? null : `resend_${sent.status}`;
    }
  } catch {
    failureCode = "delivery_failed";
  }
  const { error } = await service.from("password_reset_requests").update({ status, failure_code: failureCode }).eq("id", requestId);
  if (error) console.error("password-reset status update failed", error.message);
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !APP_BASE_URL || !RATE_SECRET || !RESEND_API_KEY) {
    return json({ error: "Password reset is not configured" }, 503);
  }

  let payload: Record<string, unknown>;
  try { payload = await req.json(); } catch { return json({ error: "Invalid request" }, 400); }
  const email = normaliseEmail(payload.email);
  if (!email) return json({ error: "Enter a valid email address" }, 400);

  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  const emailHash = await sha256(`${RATE_SECRET}:reset-email:${email}`);
  const ipHash = forwarded ? await sha256(`${RATE_SECRET}:reset-ip:${forwarded}`) : null;
  const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  // At most 3 emails per address and 10 requests per IP in 15 minutes.
  const since = new Date(Date.now() - 15 * 60_000).toISOString();
  const { count: emailCount } = await service.from("password_reset_requests")
    .select("id", { count: "exact", head: true }).eq("email_hash", emailHash).gte("requested_at", since);
  let ipCount = 0;
  if (ipHash) {
    const r = await service.from("password_reset_requests")
      .select("id", { count: "exact", head: true }).eq("ip_hash", ipHash).gte("requested_at", since);
    ipCount = r.count ?? 0;
  }
  const suppressed = (emailCount ?? 0) >= 3 || ipCount >= 10;

  const { data: profiles } = await service.from("profiles")
    .select("id, full_name, role, is_active").eq("email", email).neq("role", "client").limit(1);
  const profile = profiles?.[0];
  const status = suppressed || !profile?.is_active ? "suppressed" : "accepted";
  const { data: row } = await service.from("password_reset_requests").insert({
    profile_id: profile?.id ?? null, email_hash: emailHash, ip_hash: ipHash, status,
  }).select("id").single();

  if (status === "accepted" && row?.id) {
    EdgeRuntime.waitUntil(deliver(service, email, profile?.full_name ?? "", row.id));
  }
  // Same answer whatever happened, so the form cannot be used to discover accounts.
  return json({ accepted: true, message: "If an account exists for this email, a reset link is on its way." }, 202);
});
