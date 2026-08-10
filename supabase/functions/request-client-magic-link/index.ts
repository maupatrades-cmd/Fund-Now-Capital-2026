import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const APP_BASE_URL = (Deno.env.get("APP_BASE_URL") ?? "").replace(/\/$/, "");
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const EMAIL_FROM = Deno.env.get("EMAIL_FROM") ?? "Fund Now Capital <noreply@fundnowcapital.africa>";
const RATE_SECRET = Deno.env.get("CLIENT_AUTH_RATE_LIMIT_SECRET") ?? "";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json", "cache-control": "no-store" },
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

Deno.serve(async (req: Request): Promise<Response> => {
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

  if (status === "accepted" && requestRow?.id && RESEND_API_KEY) {
    const redirectTo = `${APP_BASE_URL}/auth/callback?portal=client`;
    const { data: linkData, error: linkError } = await service.auth.admin.generateLink({
      type: "magiclink", email, options: { redirectTo },
    });
    const actionLink = linkData?.properties?.action_link;
    if (!linkError && actionLink) {
      const sent = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "content-type": "application/json" },
        body: JSON.stringify({
          from: EMAIL_FROM,
          to: [email],
          subject: "Your secure Fund Now Capital sign-in link",
          html: `<p>Hello,</p><p>Use the secure link below to access your Fund Now Capital client portal.</p><p><a href="${actionLink}">Open my secure portal</a></p><p>This link is personal. Do not forward it.</p>`,
          text: `Open your secure Fund Now Capital client portal: ${actionLink}\n\nDo not forward this personal link.`,
        }),
      });
      await service.from("client_auth_requests").update({
        status: sent.ok ? "sent" : "failed",
        failure_code: sent.ok ? null : `resend_${sent.status}`,
      }).eq("id", requestRow.id);
      if (sent.ok) {
        await service.from("activity_logs").insert({
          user_id: profile.id,
          user_email: email,
          user_role: "client",
          event_type: "NOTIFICATION_SENT",
          entity_type: "client_auth_request",
          entity_id: requestRow.id,
          description: "Client portal magic-link email sent",
          related_entity_ids: [profile.client_id],
        });
      }
    } else {
      await service.from("client_auth_requests").update({
        status: "failed", failure_code: "link_generation_failed",
      }).eq("id", requestRow.id);
    }
  }

  // Always return the same response so callers cannot discover client accounts.
  return json({ accepted: true, message: "If an active client account exists, a secure link will be sent." }, 202);
});