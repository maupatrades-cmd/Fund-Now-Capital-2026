// Sends one confirmed-booking email from the durable booking confirmation outbox.
// Auth: database-to-function webhook secret. No browser supplies an email address.
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

type Delivery = {
  id: string;
  booking_id: string;
  recipient_email: string;
  recipient_name: string | null;
  status: "queued" | "processing" | "sent" | "failed" | "skipped";
  attempts: number;
};

type Booking = {
  booking_type: string;
  status: string;
  slot_id: string;
};

type Slot = { starts_at: string; ends_at: string };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function validEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}

function bookingLabel(value: string): string {
  const labels: Record<string, string> = {
    urgent: "Urgent meeting",
    submission: "Funding submission",
    submission_update: "Submission update",
    consultation: "Funding consultation",
    presentation: "Presentation",
    call: "Call",
    paperwork_review: "Paperwork review",
  };
  return labels[value] ?? "Appointment";
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

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!WEBHOOK_SECRET || req.headers.get("X-Webhook-Secret") !== WEBHOOK_SECRET) {
    return json({ error: "Unauthorized" }, 401);
  }
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !RESEND_API_KEY) {
    return json({ error: "Delivery service is not configured" }, 503);
  }

  let deliveryId = "";
  try {
    const body = await req.json() as { delivery_id?: unknown };
    deliveryId = typeof body.delivery_id === "string" ? body.delivery_id : "";
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }
  if (!/^[0-9a-f-]{36}$/i.test(deliveryId)) return json({ error: "Invalid delivery id" }, 400);

  const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Atomic claim: the service-only RPC transitions queued/failed -> processing
  // and increments attempts in one locked database operation. A concurrent
  // invocation receives no row and cannot send a duplicate email.
  const { data: claimRows, error: claimError } = await service
    .rpc("claim_booking_confirmation_delivery", { p_delivery_id: deliveryId });
  const claimed = (Array.isArray(claimRows) ? claimRows[0] : claimRows) as Delivery | null;

  if (claimError) return json({ error: "Could not claim delivery" }, 500);
  if (!claimed) return json({ status: "already_claimed" });
  if (!validEmail(claimed.recipient_email)) {
    const { error: resultError } = await service.rpc("record_booking_confirmation_delivery_result", {
      p_delivery_id: claimed.id,
      p_status: "failed",
      p_external_id: null,
      p_error_message: "Recipient email is missing or invalid",
    });
    if (resultError) console.error("Failed to record invalid recipient", claimed.id, resultError);
    return json({ status: "skipped" });
  }

  const [{ data: booking, error: bookingError }] = await Promise.all([
    service.from("crm_bookings").select("booking_type,status,slot_id").eq("id", claimed.booking_id).single<Booking>(),
  ]);
  if (bookingError || !booking || booking.status !== "confirmed") {
    const { error: resultError } = await service.rpc("record_booking_confirmation_delivery_result", {
      p_delivery_id: claimed.id,
      p_status: "failed",
      p_external_id: null,
      p_error_message: "Confirmed booking could not be resolved",
    });
    if (resultError) console.error("Failed to record unresolved booking", claimed.id, resultError);
    return json({ error: "Confirmed booking could not be resolved" }, 409);
  }

  const { data: slot, error: slotError } = await service
    .from("owner_availability_slots")
    .select("starts_at,ends_at")
    .eq("id", booking.slot_id)
    .single<Slot>();
  if (slotError || !slot) {
    const { error: resultError } = await service.rpc("record_booking_confirmation_delivery_result", {
      p_delivery_id: claimed.id,
      p_status: "failed",
      p_external_id: null,
      p_error_message: "Appointment time could not be resolved",
    });
    if (resultError) console.error("Failed to record unresolved appointment time", claimed.id, resultError);
    return json({ error: "Appointment time could not be resolved" }, 409);
  }

  const summary = `${bookingLabel(booking.booking_type)} — ${sastRange(slot.starts_at, slot.ends_at)}.`;
  const email = renderEmail({
    eventType: "BOOKING_CONFIRMED",
    variant: "booking_confirmation",
    firstName: claimed.recipient_name,
    bodyText: summary,
    linkUrl: "/client/appointments",
    appBaseUrl: APP_BASE_URL,
  });

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `fnc-booking-${claimed.id}`,
      },
      body: JSON.stringify({
        from: FROM,
        to: [claimed.recipient_email],
        reply_to: REPLY_TO,
        subject: email.subject,
        html: email.html,
        text: email.text,
      }),
    });
    const result = await response.json().catch(() => ({})) as { id?: string; message?: string };
    if (!response.ok) throw new Error(result.message || `Resend returned ${response.status}`);

    const { error: sentError } = await service.rpc("record_booking_confirmation_delivery_result", {
      p_delivery_id: claimed.id,
      p_status: "sent",
      p_external_id: result.id ?? null,
      p_error_message: null,
    });
    if (sentError) {
      console.error("Email sent but delivery result could not be recorded", claimed.id, sentError);
      return json({ error: "Email sent but delivery status could not be recorded" }, 500);
    }
    return json({ status: "sent" });
  } catch (error) {
    const { error: resultError } = await service.rpc("record_booking_confirmation_delivery_result", {
      p_delivery_id: claimed.id,
      p_status: "failed",
      p_external_id: null,
      p_error_message: (error as Error).message.slice(0, 500),
    });
    if (resultError) console.error("Failed to record email delivery failure", claimed.id, resultError);
    return json({ error: "Email delivery failed" }, 502);
  }
});
