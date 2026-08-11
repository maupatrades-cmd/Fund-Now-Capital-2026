import { createClient } from "npm:@supabase/supabase-js@2";
import { renderEmail } from "../send-notification-email/email-template.ts";

declare const EdgeRuntime: {
  waitUntil(promise: Promise<unknown>): void;
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const APP_BASE_URL = (Deno.env.get("APP_BASE_URL") ?? "").replace(/\/$/, "");
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const EMAIL_FROM = Deno.env.get("EMAIL_FROM") ?? "Fund Now Capital <noreply@fundnowcapital.africa>";
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
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function normaliseEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

async function deliverMagicLink(
  service: ReturnType<typeof createClient>,
  email: string,
  requestId: string,
  profileId: string,
  clientId: string,
): Promise<void> {
  let status = "failed";
  let failureCode: string | null = "delivery_failed";

  try {
    const redirectTo = `${APP_BASE_URL}/auth/callback?portal=client`;
    const { data: linkData, error: linkError } = await service.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: { redirectTo },
    });
    const actionLink = linkData?.properties?.action_link;

    if (linkError || !actionLink) {
      failureCode = "link_generation_failed";
    } else {
      const emailContent = renderEmail({
        eventType: "CLIENT_MAGIC_LINK",
        appBaseUrl: APP_BASE_URL,
        linkUrl: actionLink,
      });
      const sent = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "content-type": "application/json" },
        body: JSON.stringify({
          from: EMAIL_FROM,
          to: [email],
          subject: emailContent.subject,
          html: emailContent.html,
          text: emailContent.text,
        }),
      });
      status = sent.ok ? "sent" : "failed";
      failureCode = sent.ok ? null : `resend_${sent.status}`;
    }
  } catch {
    failureCode = "delivery_failed";
  }

  try {
    const { error: updateError } = await service.from("client_auth_requests").update({
      status,
      failure_code: failureCode,
    }).eq("id", requestId);
    if (updateError) console.error("magic-link status update failed", updateError.message);

    if (status === "sent") {
      const { error: activityError } = await service.from("activity_logs").insert({
        user_id: profileId,
        user_email: email,
        user_role: "client",
        event_type: "NOTIFICATION_SENT",
        entity_type: "client_auth_request",
        entity_id: requestId,
        description: "Client portal magic-link email sent",
        related_entity_ids: [clientId],
      });
      if (activityError) console.error("magic-link activity write failed", activityError.message);
    }
  } catch (error) {
    console.error("magic-link audit write failed", error);
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY || !APP_BASE_URL || !RATE_SECRET || !RESEND_API_KEY) {
    return json({ error: "Client authentication is not configured" }, 503);
  }

  let payload: Record<string, unknown>;
  try { payload = await req.json(); } catch { return json({ error: "Invalid request" }, 400); }
  const email = normaliseEmail(payload.email);
  if (!email) return json({ error: "Enter a valid email address" }, 400);

  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  const agent = req.headers.get("user-agent") ?? "";
  const emailHash = await sha256(`${RATE_SECRET}:email:${email}`);
  const ipHash = forwarded ? await sha256(`${RATE_SECRET}:ip:${forwarded}`) : null;
  const agentHash = agent ? await sha256(`${RATE_SECRET}:ua:${agent}`) : null;
  const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const since = new Date(Date.now() - 15 * 60_000).toISOString();
  const { count: emailCount } = await service.from("client_auth_requests")
    .select("id", { count: "exact", head: true }).eq("email_hash", emailHash).gte("requested_at", since);
  let ipCount = 0;
  if (ipHash) {
    const result = await service.from("client_auth_requests")
      .select("id", { count: "exact", head: true }).eq("ip_hash", ipHash).gte("requested_at", since);
    ipCount = result.count ?? 0;
  }
  const suppressed = (emailCount ?? 0) >= 3 || ipCount >= 10;

  const { data: profiles } = await service.from("profiles")
    .select("id, client_id, is_active").eq("email", email).eq("role", "client").limit(1);
  const profile = profiles?.[0];
  const status = suppressed || !profile?.is_active || !profile.client_id ? "suppressed" : "accepted";
  const { data: requestRow } = await service.from("client_auth_requests").insert({
    profile_id: profile?.id ?? null,
    client_id: profile?.client_id ?? null,
    email_hash: emailHash,
    ip_hash: ipHash,
    request_user_agent_hash: agentHash,
    status,
  }).select("id").single();

  if (status === "accepted" && requestRow?.id && profile?.id && profile.client_id) {
    EdgeRuntime.waitUntil(deliverMagicLink(
      service,
      email,
      requestRow.id,
      profile.id,
      profile.client_id,
    ));
  }

  // Always return the same response so callers cannot discover client accounts.
  return json({ accepted: true, message: "If an active client account exists, a secure link will be sent." }, 202);
});
