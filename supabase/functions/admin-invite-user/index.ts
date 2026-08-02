// admin-invite-user (Team Management)
//
// Owner-only Edge Function that onboards a new person (partner or contractor)
// into the CRM: creates the Supabase Auth user, fills in their profile, and
// hands them login access — either a branded magic link (delivered via Resend)
// or a temporary password (returned to the owner to share verbally).
//
// AUTH MODEL — why this differs from the send-notification-email pattern:
//   send-notification-email is invoked server-to-server by the DB (pg_net) and
//   authenticates with a shared X-Webhook-Secret. This function is invoked from
//   the OWNER'S BROWSER, so it must authenticate the *caller* instead. It is
//   deployed verify_jwt=false and does the check itself:
//     1. read the caller's Bearer JWT (supabase-js functions.invoke attaches
//        the current session token automatically),
//     2. build a user-scoped client with that JWT and call is_owner() — the
//        DB is the single source of truth for "who is the owner" (auth.uid()
//        under the RLS role resolves to the caller),
//     3. only then use the service-role client for the admin operations.
//   verify_jwt=false (not true) so we can answer the CORS preflight and return
//   clean JSON errors ourselves; the is_owner() gate is the real authorization.
//
// A public signup is never opened (CLAUDE.md rule 4) — only the owner reaches
// this function, and the owner role can never be created through it.
//
// Env: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (auto-injected);
//      RESEND_API_KEY, APP_BASE_URL, optionally EMAIL_FROM / EMAIL_REPLY_TO
//      (project-wide secrets, already set for send-notification-email).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const APP_BASE_URL = Deno.env.get("APP_BASE_URL") ?? "https://fundnowcapital.africa";
const FROM = Deno.env.get("EMAIL_FROM") ?? "Fund Now Capital <hello@fundnowcapital.africa>";
const REPLY_TO = Deno.env.get("EMAIL_REPLY_TO") ?? "hello@fundnowcapital.africa";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ROLE_LABEL: Record<string, string> = { partner: "Partner", contractor: "Contractor" };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// Basic shape check — the DB and Auth server are the real validators.
function isEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

// A readable strong temp password: 16 chars from an unambiguous alphabet
// (no 0/O/1/l/I) guaranteeing a lower, upper, digit and symbol. Used only when
// the temp-password path is chosen without an explicit password.
function generatePassword(): string {
  const lower = "abcdefghijkmnpqrstuvwxyz";
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const digit = "23456789";
  const symbol = "!@#$%*?";
  const all = lower + upper + digit + symbol;
  const bytes = new Uint32Array(16);
  crypto.getRandomValues(bytes);
  const pick = (set: string, n: number) => set[n % set.length];
  const chars = [
    pick(lower, bytes[0]),
    pick(upper, bytes[1]),
    pick(digit, bytes[2]),
    pick(symbol, bytes[3]),
  ];
  for (let i = 4; i < 16; i++) chars.push(pick(all, bytes[i]));
  // Fisher-Yates shuffle so the guaranteed classes aren't always first.
  const shuf = new Uint32Array(chars.length);
  crypto.getRandomValues(shuf);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = shuf[i] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

type InviteBody = {
  email?: string;
  full_name?: string;
  phone?: string;
  role?: string;
  invite_method?: string;
  temp_password?: string;
};

// Send the branded magic-link email via the Resend REST API. Returns true on a
// 2xx from Resend. Kept dependency-free (plain fetch) — the invite email is a
// simple on-brand shell, not the bulletproof S16 notification template.
async function sendMagicLinkEmail(to: string, fullName: string, role: string, link: string): Promise<boolean> {
  if (!RESEND_API_KEY) return false;
  const roleLabel = ROLE_LABEL[role] ?? role;
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
       <p style="margin:0 0 12px;">You've been added to the Fund Now Capital CRM as a <strong>${roleLabel}</strong>. Use the button below to log in — no password needed.</p>
       <p style="margin:24px 0;text-align:center;">
         <a href="${link}" style="display:inline-block;background:#2da8b8;color:#ffffff;text-decoration:none;font-weight:bold;font-size:15px;padding:12px 28px;border-radius:8px;">Log in to Fund Now Capital</a>
       </p>
       <p style="margin:0 0 12px;color:#64748b;font-size:13px;">This login link is single-use and expires after a short time. If it has expired, ask Thapelo to resend your invite.</p>
       <p style="margin:0 0 4px;color:#64748b;font-size:13px;">If the button doesn't work, copy and paste this link into your browser:</p>
       <p style="margin:0;word-break:break-all;font-size:12px;"><a href="${link}" style="color:#2da8b8;">${link}</a></p>
     </td></tr>
     <tr><td style="background:#1a3a52;padding:16px 32px;color:rgba(255,255,255,0.45);font-size:11px;">© 2026 Fund Now Capital (Pty) Ltd</td></tr>
    </table>
   </td></tr>
  </table></body></html>`;
  const text =
    `${greeting}\n\nYou've been added to the Fund Now Capital CRM as a ${roleLabel}.\n` +
    `Log in using this single-use link (it expires after a short time):\n\n${link}\n\n` +
    `If it has expired, ask Thapelo to resend your invite.\n\n— Fund Now Capital`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: FROM,
      to: [to],
      reply_to: REPLY_TO,
      subject: "You've been invited to the Fund Now Capital CRM",
      html,
      text,
    }),
  });
  return res.ok;
}

// Write a Team-Management audit row (POPIA: every user action is logged).
// service-role bypasses RLS exactly like the DEFINER triggers that own this table.
async function audit(
  service: SupabaseClient,
  caller: { id: string; email: string | null },
  eventType: "CREATE" | "UPDATE",
  targetUserId: string,
  description: string,
  after: Record<string, unknown>,
): Promise<void> {
  await service.from("activity_logs").insert({
    user_id: caller.id,
    user_email: caller.email,
    user_role: "owner",
    event_type: eventType,
    entity_type: "profile",
    entity_id: targetUserId,
    description,
    after_values: after,
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
  if (isOwner !== true) return json({ error: "Only the owner can invite people" }, 403);

  // ---- validate input ------------------------------------------------------
  let body: InviteBody;
  try {
    body = (await req.json()) as InviteBody;
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }

  const email = (body.email ?? "").trim().toLowerCase();
  const fullName = (body.full_name ?? "").trim();
  const phone = (body.phone ?? "").trim();
  const role = (body.role ?? "").trim();
  const inviteMethod = (body.invite_method ?? "").trim();

  // full_name + phone are required only when CREATING a new user (below). A
  // resend to an existing member needs just email + role + method.
  if (!isEmail(email)) return json({ error: "A valid email is required" }, 400);
  if (role !== "partner" && role !== "contractor") {
    return json({ error: "Role must be Partner or Contractor" }, 400);
  }
  if (inviteMethod !== "magic_link" && inviteMethod !== "temp_password") {
    return json({ error: "Invite method must be magic_link or temp_password" }, 400);
  }

  let tempPassword = (body.temp_password ?? "").trim();
  if (inviteMethod === "temp_password") {
    if (tempPassword && tempPassword.length < 8) {
      return json({ error: "Temporary password must be at least 8 characters" }, 400);
    }
    if (!tempPassword) tempPassword = generatePassword();
  }

  const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const callerInfo = { id: caller.id, email: caller.email ?? null };

  // ---- idempotency: existing user by email ---------------------------------
  const { data: existing, error: existingErr } = await service
    .from("profiles")
    .select("id, role")
    .eq("email", email)
    .maybeSingle();
  if (existingErr) return json({ error: "Could not check for an existing user" }, 500);

  if (existing) {
    // A user with this email already exists.
    if (existing.role !== role) {
      return json(
        {
          error:
            `A user with this email already exists as ${ROLE_LABEL[existing.role] ?? existing.role}. ` +
            `Use "Edit Role" to change their role instead.`,
        },
        409,
      );
    }
    // Same email + same role = idempotent success (no duplicate created).
    if (inviteMethod === "magic_link") {
      const { data: linkData, error: linkErr } = await service.auth.admin.generateLink({
        type: "magiclink",
        email,
        options: { redirectTo: APP_BASE_URL },
      });
      const link = linkData?.properties?.action_link;
      if (linkErr || !link) return json({ error: "Could not generate a login link" }, 500);
      const sent = await sendMagicLinkEmail(email, fullName, role, link);
      await audit(service, callerInfo, "UPDATE", existing.id, `Re-sent login link to ${email}`, {
        email,
        role,
        invite_method: "magic_link",
      });
      return json({ ok: true, status: "existing", user_id: existing.id, invite_method: "magic_link", email_sent: sent });
    }
    // temp_password on an existing user: don't silently reset their password.
    return json({
      ok: true,
      status: "existing",
      user_id: existing.id,
      invite_method: "temp_password",
      temp_password: null,
      message: "This person is already a member. Their password was not changed — use Magic Link to resend access.",
    });
  }

  // ---- create the Auth user ------------------------------------------------
  // Creating requires the full record.
  if (!fullName) return json({ error: "Full name is required" }, 400);
  if (!phone) return json({ error: "Phone is required" }, 400);

  const createArgs: {
    email: string;
    email_confirm: boolean;
    user_metadata: Record<string, unknown>;
    password?: string;
  } = {
    email,
    email_confirm: true, // we deliver access ourselves; skip Supabase's own email
    user_metadata: { full_name: fullName, role },
  };
  if (inviteMethod === "temp_password") createArgs.password = tempPassword;

  const { data: created, error: createErr } = await service.auth.admin.createUser(createArgs);
  let userId = created?.user?.id ?? null;

  if (createErr || !userId) {
    // Race: another request created the same email between our check and now.
    const { data: raced } = await service.from("profiles").select("id, role").eq("email", email).maybeSingle();
    if (raced) {
      if (raced.role !== role) {
        return json(
          { error: `A user with this email already exists as ${ROLE_LABEL[raced.role] ?? raced.role}.` },
          409,
        );
      }
      return json({ ok: true, status: "existing", user_id: raced.id, invite_method: inviteMethod });
    }
    return json({ error: createErr?.message ?? "Could not create the user" }, 500);
  }

  // handle_new_user() creates the profile row from user_metadata (full_name,
  // role) but not phone_number — upsert to fill phone and guarantee the row
  // even if the trigger timing ever changed. onConflict=id.
  const { data: upserted, error: profileErr } = await service
    .from("profiles")
    .upsert(
      { id: userId, email, full_name: fullName, role, phone_number: phone, is_active: true },
      { onConflict: "id" },
    )
    .select("id");
  if (profileErr || !upserted || upserted.length !== 1) {
    return json({ error: "User created but profile could not be saved" }, 500);
  }

  // ---- deliver access ------------------------------------------------------
  let emailSent = false;
  if (inviteMethod === "magic_link") {
    const { data: linkData, error: linkErr } = await service.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: { redirectTo: APP_BASE_URL },
    });
    const link = linkData?.properties?.action_link;
    if (linkErr || !link) return json({ error: "User created but a login link could not be generated" }, 500);
    emailSent = await sendMagicLinkEmail(email, fullName, role, link);
  }

  await audit(service, callerInfo, "CREATE", userId, `Invited ${fullName} as ${ROLE_LABEL[role]} (${inviteMethod})`, {
    email,
    full_name: fullName,
    role,
    phone_number: phone,
    invite_method: inviteMethod,
  });

  return json({
    ok: true,
    status: "created",
    user_id: userId,
    invite_method: inviteMethod,
    email_sent: inviteMethod === "magic_link" ? emailSent : undefined,
    temp_password: inviteMethod === "temp_password" ? tempPassword : undefined,
  });
});
