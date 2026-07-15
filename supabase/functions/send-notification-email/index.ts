// send-notification-email (A12 / SPEC S4)
//
// Invoked asynchronously by the DB (pg_net) after an in-app notification is
// written. Reads the notification + recipient preferences, decides whether to
// send, renders the branded email, sends via Resend, and records the outcome in
// notification_deliveries (channel='email', status sent|failed|skipped).
//
// Auth: deployed with verify_jwt=false; the caller must present the shared
// X-Webhook-Secret header matching the WEBHOOK_SECRET env var.
//
// Env: RESEND_API_KEY, WEBHOOK_SECRET, APP_BASE_URL, optionally EMAIL_FROM /
// EMAIL_REPLY_TO. SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are auto-injected.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { Resend } from "npm:resend@4.0.1";
import { renderEmail } from "./email-template.ts";

const FROM = Deno.env.get("EMAIL_FROM") ?? "Fund Now Capital <hello@fundnowcapital.africa>";
const REPLY_TO = Deno.env.get("EMAIL_REPLY_TO") ?? "hello@fundnowcapital.africa";
const APP_BASE_URL = Deno.env.get("APP_BASE_URL") ?? "https://fundnowcapital.africa";
const QUIET_HOURS_TZ = "Africa/Johannesburg"; // SA business; SAST is UTC+2, no DST

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// "HH:MM[:SS]" -> minutes since midnight, or null.
function toMinutes(t: string | null): number | null {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

function nowMinutesInTz(tz: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
  const [h, m] = parts.split(":").map(Number);
  return h * 60 + m;
}

// Quiet hours window may wrap past midnight (e.g. 22:00–07:00).
function withinQuietHours(nowMin: number, startMin: number | null, endMin: number | null): boolean {
  if (startMin === null || endMin === null || startMin === endMin) return false;
  return startMin < endMin
    ? nowMin >= startMin && nowMin < endMin
    : nowMin >= startMin || nowMin < endMin;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const secret = Deno.env.get("WEBHOOK_SECRET");
  if (!secret || req.headers.get("X-Webhook-Secret") !== secret) {
    return json({ error: "unauthorized" }, 401);
  }

  let notificationId: string | undefined;
  try {
    notificationId = (await req.json())?.notification_id;
  } catch {
    return json({ error: "invalid json body" }, 400);
  }
  if (!notificationId) return json({ error: "notification_id required" }, 400);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Load the notification.
  const { data: n, error: nErr } = await supabase
    .from("notifications")
    .select("id, user_id, event_type, title, body_text, link_url")
    .eq("id", notificationId)
    .single();
  if (nErr || !n) return json({ error: "notification not found" }, 404);

  // Record the email delivery outcome for this notification.
  const record = async (
    status: "sent" | "failed" | "skipped",
    extra: { error_message?: string; external_id?: string } = {},
  ) => {
    await supabase.from("notification_deliveries").insert({
      notification_id: n.id,
      channel: "email",
      delivery_status: status,
      sent_at: status === "sent" ? new Date().toISOString() : null,
      error_message: extra.error_message ?? null,
      external_id: extra.external_id ?? null,
    });
  };

  // Recipient email.
  const { data: profile } = await supabase
    .from("profiles")
    .select("email")
    .eq("id", n.user_id)
    .single();
  const email = profile?.email as string | undefined;
  if (!email) {
    await record("skipped", { error_message: "no recipient email on profile" });
    return json({ ok: false, skipped: "no recipient email" });
  }

  // Preferences for this event. No row => email on by default (owner default).
  const { data: pref } = await supabase
    .from("notification_preferences")
    .select("email_enabled, quiet_hours_start, quiet_hours_end, digest_mode")
    .eq("user_id", n.user_id)
    .eq("event_type", n.event_type)
    .maybeSingle();

  if (pref && pref.email_enabled === false) {
    await record("skipped", { error_message: "email disabled for this event" });
    return json({ ok: false, skipped: "email disabled" });
  }
  if (pref?.digest_mode === true) {
    await record("skipped", { error_message: "digest mode — queued for daily digest" });
    return json({ ok: false, skipped: "digest mode" });
  }
  if (withinQuietHours(nowMinutesInTz(QUIET_HOURS_TZ), toMinutes(pref?.quiet_hours_start ?? null), toMinutes(pref?.quiet_hours_end ?? null))) {
    await record("skipped", { error_message: "within quiet hours" });
    return json({ ok: false, skipped: "quiet hours" });
  }

  // Render + send.
  const { html, text } = renderEmail({
    title: n.title,
    bodyText: n.body_text,
    linkUrl: n.link_url,
    eventType: n.event_type,
    appBaseUrl: APP_BASE_URL,
  });

  try {
    const resend = new Resend(Deno.env.get("RESEND_API_KEY"));
    const { data, error } = await resend.emails.send({
      from: FROM,
      replyTo: REPLY_TO,
      to: email,
      subject: n.title,
      html,
      text,
    });
    if (error) {
      await record("failed", { error_message: String(error.message ?? error) });
      return json({ ok: false, error: error.message ?? "send failed" });
    }
    await record("sent", { external_id: data?.id });
    return json({ ok: true, id: data?.id });
  } catch (e) {
    await record("failed", { error_message: e instanceof Error ? e.message : String(e) });
    return json({ ok: false, error: "send threw" });
  }
});
