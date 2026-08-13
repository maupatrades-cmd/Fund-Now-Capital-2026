import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const APP_BASE_URL = (Deno.env.get("APP_BASE_URL") ?? "https://fundnowcapital.africa").replace(/\/$/, "");
const FROM = Deno.env.get("EMAIL_FROM") ?? "Fund Now Capital <hello@fundnowcapital.africa>";
const REPLY_TO = Deno.env.get("EMAIL_REPLY_TO") ?? "hello@fundnowcapital.africa";
const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_APP_ORIGINS") ?? APP_BASE_URL)
  .split(",").map((value) => value.trim()).filter(Boolean);

function cors(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0] ?? APP_BASE_URL,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(req), "content-type": "application/json", "cache-control": "no-store" },
  });
}
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char] ?? char));
}
async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function audit(service: SupabaseClient, actorId: string, actorEmail: string | null, actorRole: string, profileId: string, description: string, eventType: "CREATE" | "NOTIFICATION_SENT") {
  const { error } = await service.from("activity_logs").insert({
    user_id: actorId,
    user_email: actorEmail,
    user_role: actorRole,
    event_type: eventType,
    entity_type: "client_profile",
    entity_id: profileId,
    description,
  });
  if (error) console.error("Client bootstrap audit failed:", error.message);
}

type Body = { client_id?: string; client_contact_id?: string; authorised_email_verified?: boolean; owner_verified?: boolean };

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (!['GET', 'POST'].includes(req.method)) return json(req, { error: "Method not allowed" }, 405);
  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY || !RESEND_API_KEY) {
    return json(req, { error: "Client onboarding is not configured" }, 503);
  }

  const authHeader = req.headers.get("authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json(req, { error: "Not authenticated" }, 401);
  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: callerData, error: callerError } = await callerClient.auth.getUser();
  const caller = callerData?.user;
  if (callerError || !caller) return json(req, { error: "Not authenticated" }, 401);
  const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: actor } = await service.from('profiles')
    .select('id,email,role,referral_partner_id,is_active').eq('id', caller.id).maybeSingle();
  if (!actor?.is_active || !['owner', 'partner', 'contractor', 'lead_referrer'].includes(actor.role)) {
    return json(req, { error: 'This role cannot invite clients' }, 403);
  }

  const { data: candidates, error: candidatesError } = await callerClient.rpc('role_client_invitation_candidates', { p_actor_id: caller.id });
  if (candidatesError) return json(req, { error: 'Client invitation access could not be checked' }, 500);
  if (req.method === 'GET') return json(req, { ok: true, clients: candidates ?? [] });

  let body: Body;
  try { body = await req.json(); } catch { return json(req, { error: "Invalid request body" }, 400); }
  if (!body.client_id || !body.client_contact_id || (body.authorised_email_verified !== true && body.owner_verified !== true)) {
    return json(req, { error: "Client, primary contact and authorised-email verification are required" }, 400);
  }
  if (!(candidates ?? []).some((candidate: { client_id?: string }) => candidate.client_id === body.client_id)) {
    return json(req, { error: 'You may invite only clients attributed to your role' }, 403);
  }
  const { data: client } = await service.from("clients").select("id, business_name").eq("id", body.client_id).maybeSingle();
  const { data: contact } = await service.from("client_contacts")
    .select("id, client_id, full_name, email, is_primary_director")
    .eq("id", body.client_contact_id).eq("client_id", body.client_id).maybeSingle();
  if (!client || !contact?.email || !contact.is_primary_director) {
    return json(req, { error: "Select a valid primary client contact with an email address" }, 422);
  }
  const email = contact.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(req, { error: "Primary contact email is invalid" }, 422);

  const { data: existing } = await service.from("profiles")
    .select("id, role, client_id, is_active").eq("email", email).maybeSingle();
  let profileId: string;
  let accountCreated = false;
  if (existing) {
    if (existing.role !== "client" || existing.client_id !== body.client_id) {
      return json(req, { error: "This email already belongs to another CRM identity" }, 409);
    }
    profileId = existing.id;
    const { error: reactivateError } = await service.from("profiles").update({ is_active: true }).eq("id", profileId);
    if (reactivateError) return json(req, { error: "The existing client account could not be reactivated" }, 500);
  } else {
    const { data: created, error: createError } = await service.auth.admin.createUser({
      email,
      email_confirm: false,
      app_metadata: { role: "client", client_id: body.client_id },
      user_metadata: { full_name: contact.full_name },
    });
    if (createError || !created.user) return json(req, { error: createError?.message ?? "Could not create client account" }, 500);
    profileId = created.user.id;
    accountCreated = true;
    const { error: profileError } = await service.from("profiles").upsert({
      id: profileId,
      email,
      full_name: contact.full_name,
      role: "client",
      client_id: body.client_id,
      referral_partner_id: null,
      is_active: true,
    }, { onConflict: "id" });
    if (profileError) {
      await service.auth.admin.deleteUser(profileId);
      return json(req, { error: "Could not create the client profile" }, 500);
    }
  }

  const emailHash = await sha256(email);
  const ledgerValues = {
    client_id: body.client_id,
    client_contact_id: body.client_contact_id,
    profile_id: profileId,
    requested_by: caller.id,
    email_hash: emailHash,
    status: "account_created",
    account_created_at: new Date().toISOString(),
    welcome_sent_at: null,
    failure_code: null,
  };
  const activeLedger = await service.from("client_account_bootstraps")
    .select("id")
    .eq("profile_id", profileId)
    .in("status", ["account_created", "welcome_sent"])
    .maybeSingle();
  if (activeLedger.error) return json(req, { error: "The onboarding audit could not be checked" }, 500);
  const ledgerResult = activeLedger.data
    ? await service.from("client_account_bootstraps").update(ledgerValues).eq("id", activeLedger.data.id).select("id").single()
    : await service.from("client_account_bootstraps").insert(ledgerValues).select("id").single();
  const { data: ledger, error: ledgerError } = ledgerResult;
  if (ledgerError || !ledger) return json(req, { error: "Account exists, but onboarding audit creation failed" }, 500);

  const { data: linkData, error: linkError } = await service.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo: `${APP_BASE_URL}/auth/callback?portal=client` },
  });
  const link = linkData?.properties?.action_link;
  if (linkError || !link) {
    await service.from("client_account_bootstraps").update({ status: "welcome_failed", failure_code: "link_generation_failed" }).eq("id", ledger.id);
    return json(req, { error: "Account created, but the secure welcome link could not be generated", profile_id: profileId }, 502);
  }

  const firstName = (contact.full_name || "there").trim().split(/\s+/)[0];
  const safeName = escapeHtml(firstName);
  let sent: Response;
  try {
    sent = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: FROM, reply_to: REPLY_TO, to: [email],
        subject: `Welcome to Fund Now Capital, ${firstName}`,
        html: `<p>Hi ${safeName},</p><p>Thank you for reaching out to Fund Now Capital. I'm Thapelo, and I'll be your broker specialist through this process.</p><p>We review your documents first, match you with suitable funders, and negotiate for you.</p><p><a href="${escapeHtml(link)}">Log in to your secure client portal</a></p><p>Once inside, choose your funding type and complete the requested information.</p><p>Talk soon,<br><strong>Thapelo Maupa</strong><br>Founder + Broker Specialist<br>Fund Now Capital</p>`,
        text: `Hi ${firstName},\n\nWelcome to Fund Now Capital. Log in to your secure client portal:\n${link}\n\nTalk soon,\nThapelo Maupa\nFounder + Broker Specialist`,
      }),
    });
  } catch {
    await service.from("client_account_bootstraps")
      .update({ status: "welcome_failed", failure_code: "resend_network_error" })
      .eq("id", ledger.id);
    return json(req, { error: "Account created, but welcome email delivery failed", profile_id: profileId }, 502);
  }
  await service.from("client_account_bootstraps").update(sent.ok ? {
    status: "welcome_sent", welcome_sent_at: new Date().toISOString(), failure_code: null,
  } : {
    status: "welcome_failed", failure_code: `resend_${sent.status}`,
  }).eq("id", ledger.id);
  if (accountCreated) await audit(service, caller.id, caller.email ?? null, actor.role, profileId, `Client portal account created for ${client.business_name}`, "CREATE");
  if (sent.ok) await audit(service, caller.id, caller.email ?? null, actor.role, profileId, `Client welcome email sent for ${client.business_name}`, "NOTIFICATION_SENT");

  return json(req, {
    ok: sent.ok,
    status: sent.ok ? "welcome_sent" : "welcome_failed",
    profile_id: profileId,
    account_created: accountCreated,
  }, sent.ok ? 200 : 502);
});
