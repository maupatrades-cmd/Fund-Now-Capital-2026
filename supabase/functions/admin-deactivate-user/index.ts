// admin-deactivate-user (Team Management)
//
// Owner-only Edge Function that soft-deactivates a person: they can no longer
// log in, but all their history stays intact (never deleted). Two effects:
//   1. profiles.is_active = false  (the CRM-side flag / Team list status), and
//   2. the Auth user is BANNED (ban_duration) — this blocks new logins AND
//      invalidates token refresh, so any live session dies on its next refresh.
//      Banning (not deleteUser) is the reversible, non-destructive way to
//      revoke access while preserving the account + audit trail.
//
// Auth model identical to admin-invite-user: verify_jwt=false, verify the
// caller's Bearer JWT + is_owner() ourselves, then use the service-role client
// for the admin work. See that function's header for the full rationale.
//
// Guards: the owner account can never be deactivated here, and the caller can
// never deactivate themselves.
//
// Env: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (auto-injected).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// ~100 years — an effectively permanent ban until the owner reactivates.
const BAN_DURATION = "876000h";

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

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // ---- authorize caller ----------------------------------------------------
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "Missing authorization" }, 401);

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  const caller = userData?.user;
  if (userErr || !caller) return json({ error: "Not authenticated" }, 401);

  const { data: isOwner, error: ownerErr } = await userClient.rpc("is_owner");
  if (ownerErr) return json({ error: "Authorization check failed" }, 500);
  if (isOwner !== true) return json({ error: "Only the owner can deactivate people" }, 403);

  // ---- validate input ------------------------------------------------------
  let userId = "";
  try {
    const body = (await req.json()) as { user_id?: string };
    userId = (body.user_id ?? "").trim();
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }
  if (!userId) return json({ error: "user_id is required" }, 400);
  if (userId === caller.id) return json({ error: "You cannot deactivate your own account" }, 400);

  const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ---- load target + guard the owner --------------------------------------
  const { data: target, error: targetErr } = await service
    .from("profiles")
    .select("id, email, full_name, role, is_active")
    .eq("id", userId)
    .maybeSingle();
  if (targetErr) return json({ error: "Could not load the user" }, 500);
  if (!target) return json({ error: "User not found" }, 404);
  if (target.role === "owner") return json({ error: "The owner account cannot be deactivated" }, 400);

  // Idempotent: already deactivated -> return success without re-banning.
  if (target.is_active === false) {
    return json({ ok: true, status: "already_deactivated", user_id: userId });
  }

  // ---- 1. ban the Auth user (blocks login + kills sessions on refresh) -----
  const { error: banErr } = await service.auth.admin.updateUserById(userId, { ban_duration: BAN_DURATION });
  if (banErr) return json({ error: banErr.message || "Could not revoke the user's sessions" }, 500);

  // ---- 2. flip the CRM-side flag (row-count checked) -----------------------
  const { data: updated, error: updErr } = await service
    .from("profiles")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("id", userId)
    .select("id");
  if (updErr || !updated || updated.length !== 1) {
    return json({ error: "Sessions revoked but the profile flag could not be saved" }, 500);
  }

  // ---- 3. audit (POPIA) ----------------------------------------------------
  // The ban + flag already succeeded, so a failed audit write must not report
  // the deactivation as failed. Instead: console.error + persist an
  // audit_log_failures row for backfill, and return audit_logged:false so the
  // owner UI can show a warning banner.
  let auditLogged = true;
  const { error: auditErr } = await service.from("activity_logs").insert({
    user_id: caller.id,
    user_email: caller.email ?? null,
    user_role: "owner",
    event_type: "UPDATE",
    entity_type: "profile",
    entity_id: userId,
    description: `Deactivated ${target.full_name || target.email || "user"}`,
    changed_fields: ["is_active"],
    before_values: { is_active: true },
    after_values: { is_active: false },
  });
  if (auditErr) {
    auditLogged = false;
    console.error("activity_logs insert failed:", auditErr.message);
    const { error: fallbackErr } = await service.from("audit_log_failures").insert({
      edge_function: "admin-deactivate-user",
      target_user_id: userId,
      action: "deactivate",
      error_message: auditErr.message ?? String(auditErr),
    });
    if (fallbackErr) console.error("audit_log_failures insert also failed:", fallbackErr.message);
  }

  return json({ ok: true, status: "deactivated", user_id: userId, audit_logged: auditLogged });
});
