// Sends one client email for a team-diary appointment (booked, moved or cancelled) from the
// team_appointment_emails outbox (Administrator spec §18, Batch 1b).
// Auth: database-to-function webhook secret (pg_net), like send-booking-confirmation. The browser never
// supplies the recipient: the address and the wording come from the database.
// The email names the team member as "our FNC partner", with their phone and email, the reason and the
// time. It never names a funder, rate or fee.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { renderEmail } from "../send-notification-email/email-template.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET") ?? "";
const APP_BASE_URL = Deno.env.get("APP_BASE_URL") ?? "https://fundnowcapital.africa";
const FROM = Deno.env.get("EMAIL_FROM") ?? "Fund Now Capital <hello@fundnowcapital.africa>";
const REPLY_TO = Deno.env.get("EMAIL_REPLY_TO") ?? "hello@fundnowcapital.africa";

type Payload = {
  kind: "booked" | "moved" | "cancelled";
  recipient_email: string;
  recipient_name: string | null;
  member_name: string | null;
  member_phone: string | null;
  member_email: string | null;
  reason: string;
  starts_at: string;
  ends_at: string;
  status: string;
};

const EVENT: Record<Payload["kind"], string> = {
  booked: "TEAM_APPOINTMENT_BOOKED",
  moved: "TEAM_APPOINTMENT_MOVED",
  cancelled: "TEAM_APPOINTMENT_CANCELLED",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function validEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}

function sastRange(startsAt: string, endsAt: string): string {
  const date = new Intl.DateTimeFormat("en-ZA", {
    timeZone: "Africa/Johannesburg", weekday: "long", day: "2-digit", month: "long", year: "numeric",
  }).format(new Date(startsAt));
  const time = new Intl.DateTimeFormat("en-ZA", {
    timeZone: "Africa/Johannesburg", hour: "2-digit", minute: "2-digit", hour12: false,
  });
  return `${date}, ${time.format(new Date(startsAt))}–${time.format(new Date(endsAt))} SAST`;
}

// One line per paragraph; the template escapes every line.
export function composeLines(p: Payload): string[] {
  const name = p.member_name?.trim() || "our team";
  const when = sastRange(p.starts_at, p.ends_at);
  const contact = [p.member_phone?.trim(), p.member_email?.trim()].filter(Boolean).join(" · ");
  const lines =
    p.kind === "cancelled"
      ? [`Your meeting with our FNC partner ${name} on ${when} has been cancelled.`]
      : p.kind === "moved"
        ? [`Your meeting with our FNC partner ${name} has a new time.`, `New date and time: ${when}`]
        : [`Your meeting is booked with our FNC partner ${name}.`, `Date and time: ${when}`];
  if (p.kind !== "cancelled") lines.push(`Reason: ${p.reason}`);
  lines.push(`Your FNC partner: ${name}${contact ? ` · ${contact}` : ""}`);
  lines.push(
    p.kind === "cancelled"
      ? `To book a new time, contact ${name} or reply to this email.`
      : `If you need to change the time, contact ${name} or reply to this email.`,
  );
  return lines;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!WEBHOOK_SECRET || req.headers.get("X-Webhook-Secret") !== WEBHOOK_SECRET) {
    return json({ error: "Unauthorized" }, 401);
  }
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !RESEND_API_KEY) {
    return json({ error: "Delivery service is not configured" }, 503);
  }

  let emailId = "";
  try {
    const body = await req.json() as { email_id?: unknown };
    emailId = typeof body.email_id === "string" ? body.email_id : "";
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }
  if (!/^[0-9a-f-]{36}$/i.test(emailId)) return json({ error: "Invalid email id" }, 400);

  const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const fail = async (message: string) => {
    const { error } = await service.rpc("record_team_appointment_email_result", {
      p_email_id: emailId, p_status: "failed", p_external_id: null, p_error_message: message,
    });
    if (error) console.error("Could not record failure", emailId, error.message);
  };

  // Atomic claim: queued/failed -> processing in one locked update, so a second call cannot send twice.
  const { error: claimError } = await service.rpc("claim_team_appointment_email", { p_email_id: emailId });
  if (claimError) return json({ status: "not_claimable" });

  const { data, error: payloadError } = await service.rpc("team_appointment_email_payload", { p_email_id: emailId });
  const payload = data as Payload | null;
  if (payloadError || !payload) {
    await fail("Appointment could not be resolved");
    return json({ error: "Appointment could not be resolved" }, 409);
  }
  if (!validEmail(payload.recipient_email)) {
    await fail("Recipient email is missing or invalid");
    return json({ status: "skipped" });
  }

  const email = renderEmail({
    eventType: EVENT[payload.kind],
    variant: "booking_confirmation",
    firstName: payload.recipient_name,
    bodyText: composeLines(payload).join("\n"),
    linkUrl: null,
    appBaseUrl: APP_BASE_URL,
  });

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `fnc-team-appointment-${emailId}`,
      },
      body: JSON.stringify({
        from: FROM,
        to: [payload.recipient_email],
        reply_to: payload.member_email && validEmail(payload.member_email) ? [payload.member_email, REPLY_TO] : REPLY_TO,
        subject: email.subject,
        html: email.html,
        text: email.text,
      }),
    });
    const result = await response.json().catch(() => ({})) as { id?: string; message?: string };
    if (!response.ok) throw new Error(result.message || `Resend returned ${response.status}`);
    const { error: sentError } = await service.rpc("record_team_appointment_email_result", {
      p_email_id: emailId, p_status: "sent", p_external_id: result.id ?? null, p_error_message: null,
    });
    if (sentError) {
      console.error("Email sent but result could not be recorded", emailId, sentError.message);
      return json({ error: "Email sent but status could not be recorded" }, 500);
    }
    return json({ status: "sent" });
  } catch (error) {
    await fail((error as Error).message.slice(0, 500));
    return json({ error: "Email delivery failed" }, 502);
  }
});
