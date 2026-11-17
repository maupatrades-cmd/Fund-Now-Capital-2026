// complete-password-reset (verify_jwt = false; checks the caller's session itself)
//
// The last step of "Forgot password" and of the welcome email: the person arrived through a single-use
// recovery link, which signed them in, and now chooses a password. Only a session that was opened by such a
// link (JWT amr method recovery / otp) may set a password without the current one; an ordinary signed-in
// session must use change-user-password, which re-checks the current password. Clears must_change_password,
// so someone who forgot a temporary password is not sent back to the temporary-password screen.
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
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

// Same rule as change-user-password and the invite's temporary password.
function validPassword(password: string): string | null {
  if (password.length < 12) return "Your new password must be at least 12 characters.";
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
    return "Use an uppercase letter, lowercase letter, number and symbol.";
  }
  return null;
}

// The token is already verified by getUser below; this only reads how the session was opened.
function sessionMethods(jwt: string): string[] {
  try {
    const part = jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(atob(part.padEnd(part.length + ((4 - (part.length % 4)) % 4), "=")));
    return Array.isArray(claims.amr) ? claims.amr.map((a: { method?: string }) => String(a?.method ?? "")) : [];
  } catch {
    return [];
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "This link has expired. Request a new one." }, 401);
  const jwt = authHeader.slice(7);

  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: callerData, error: callerError } = await callerClient.auth.getUser();
  const caller = callerData.user;
  if (callerError || !caller) return json({ error: "This link has expired. Request a new one." }, 401);
  const methods = sessionMethods(jwt);
  if (!methods.some((m) => m === "recovery" || m === "otp" || m === "magiclink" || m === "invite")) {
    return json({ error: "Open the link from your email to set a password, or use Change password." }, 403);
  }

  let body: { new_password?: string };
  try { body = await req.json(); } catch { return json({ error: "Invalid request body" }, 400); }
  const newPassword = body.new_password ?? "";
  const passwordError = validPassword(newPassword);
  if (passwordError) return json({ error: passwordError }, 400);

  const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: updateError } = await service.auth.admin.updateUserById(caller.id, {
    password: newPassword,
    app_metadata: { ...(caller.app_metadata ?? {}), must_change_password: false, password_changed_at: new Date().toISOString() },
  });
  if (updateError) {
    console.error("Password reset failed:", updateError.message);
    return json({ error: "Could not set the password. Please try again." }, 500);
  }

  const { data: profile } = await service.from("profiles").select("role").eq("id", caller.id).maybeSingle();
  // Passwords are never logged: only who, and that it was set through an emailed link.
  const { error: auditError } = await service.from("activity_logs").insert({
    user_id: caller.id,
    user_email: caller.email,
    user_role: profile?.role ?? null,
    event_type: "UPDATE",
    entity_type: "profile",
    entity_id: caller.id,
    description: "User set their password from an emailed link",
    after_values: { via: "password_reset_link" },
  });
  if (auditError) console.error("Password-reset audit failed:", auditError.message);
  return json({ ok: true });
});
