import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

function validPassword(password: string): string | null {
  if (password.length < 12) return "Your new password must be at least 12 characters.";
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
    return "Use an uppercase letter, lowercase letter, number and symbol.";
  }
  return null;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "Missing authorization" }, 401);

  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: callerData, error: callerError } = await callerClient.auth.getUser();
  const caller = callerData.user;
  if (callerError || !caller?.email) return json({ error: "Not authenticated" }, 401);

  let body: { current_password?: string; new_password?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }

  const currentPassword = body.current_password ?? "";
  const newPassword = body.new_password ?? "";
  if (!currentPassword) return json({ error: "Enter your current password." }, 400);
  const passwordError = validPassword(newPassword);
  if (passwordError) return json({ error: passwordError }, 400);
  if (currentPassword === newPassword) return json({ error: "Choose a password different from the temporary password." }, 400);

  // Re-authenticate before changing a credential. The bearer session alone is
  // not enough for this sensitive action if somebody gained access to an
  // unattended signed-in browser.
  const verifier = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: verifyError } = await verifier.auth.signInWithPassword({
    email: caller.email,
    password: currentPassword,
  });
  if (verifyError) return json({ error: "The current password is incorrect." }, 400);

  const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const nextMetadata = {
    ...(caller.app_metadata ?? {}),
    must_change_password: false,
    password_changed_at: new Date().toISOString(),
  };
  const { error: updateError } = await service.auth.admin.updateUserById(caller.id, {
    password: newPassword,
    app_metadata: nextMetadata,
  });
  if (updateError) {
    console.error("Password update failed:", updateError.message);
    return json({ error: "Could not change the password. Please try again." }, 500);
  }

  const { data: profile } = await service
    .from("profiles")
    .select("role")
    .eq("id", caller.id)
    .maybeSingle();

  // Passwords are never logged. This audit contains only the actor, action and
  // whether this was the mandatory first-login change.
  const { error: auditError } = await service.from("activity_logs").insert({
    user_id: caller.id,
    user_email: caller.email,
    user_role: profile?.role ?? null,
    event_type: "UPDATE",
    entity_type: "profile",
    entity_id: caller.id,
    description: "User changed their password",
    after_values: {
      initial_password_change_completed: caller.app_metadata?.must_change_password === true,
    },
  });
  if (auditError) console.error("Password-change audit failed:", auditError.message);

  return json({ ok: true });
});
