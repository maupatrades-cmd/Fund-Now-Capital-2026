import { createClient } from "npm:@supabase/supabase-js@2";

const url = Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const referralSecret = Deno.env.get("CLIENT_REFERRAL_HASH_SECRET") ?? "";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, "content-type": "application/json", "cache-control": "no-store" },
});

const clean = (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) : "";
const emailOf = (value: unknown) => {
  const email = clean(value, 254).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
};
async function digest(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!url || !serviceKey || !referralSecret) return json({ error: "Intake is not configured" }, 503);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Invalid request" }, 400); }
  const businessName = clean(body.business_name, 200);
  const contactName = clean(body.contact_name, 160);
  const contactEmail = emailOf(body.contact_email);
  const contactCell = clean(body.contact_cell, 32);
  const idempotencyKey = clean(body.idempotency_key, 36);
  const product = clean(body.funding_product, 40);
  const amount = Number(body.amount_requested);
  const consent = body.consent_to_process === true;
  const products = new Set(["working_capital","purchase_order","asset_backed","equipment_finance","invoice_discounting","property_finance","investment","private_equity","other"]);
  if (!businessName || !contactName || !contactEmail || contactCell.length < 7 ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idempotencyKey) || !products.has(product) ||
      !Number.isFinite(amount) || amount <= 0 || amount > 100_000_000 || !consent) {
    return json({ error: "Complete all required application fields" }, 400);
  }
  const rawReferral = clean(body.referral_token, 512);
  const referralClaim = rawReferral ? {
    token_hash: await digest(`${referralSecret}:${rawReferral}`),
    captured_at: new Date().toISOString(),
  } : {};
  const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  // Supabase's edge proxy appends the connection address to X-Forwarded-For.
  // Use the rightmost hop so a caller cannot rotate a spoofed leftmost value.
  const forwardedFor = (req.headers.get("x-forwarded-for") ?? "unknown").split(",");
  const callerIp = forwardedFor[forwardedFor.length - 1]?.trim() || "unknown";
  const ipHash = await digest(`${referralSecret}:${callerIp}`);
  const { data: limited, error: limitError } = await service.rpc("record_client_application_attempt", {
    p_ip_hash: ipHash,
    p_max_per_window: 8,
    p_window_seconds: 3600,
  });
  if (limitError) return json({ error: "Intake protection is unavailable" }, 503);
  if (limited === true) return json({ error: "Too many applications. Please try again later." }, 429);

  let { data, error } = await service.from("client_applications").upsert({
    idempotency_key: idempotencyKey,
    business_name: businessName,
    contact_name: contactName,
    contact_email: contactEmail,
    contact_cell: contactCell,
    company_registration_number: clean(body.company_registration_number, 80) || null,
    funding_product: product,
    amount_requested: amount,
    product_answers: typeof body.product_answers === "object" && body.product_answers ? body.product_answers : {},
    referral_claim: referralClaim,
    referral_claim_status: rawReferral ? "pending" : "not_supplied",
    consent_to_process: true,
    consented_at: new Date().toISOString(),
  }, { onConflict: "idempotency_key", ignoreDuplicates: true }).select("id,status").maybeSingle();
  if (error) return json({ error: "Application could not be submitted" }, 500);
  const isNewApplication = Boolean(data?.id);
  if (!data) {
    const existing = await service.from("client_applications")
      .select("id,status")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    data = existing.data;
    error = existing.error;
  }
  if (error || !data?.id) return json({ error: "Application could not be submitted" }, 500);
  if (isNewApplication) await service.from("client_application_events").insert({
    application_id: data.id, event_type: "submitted", event_data: { product },
  });
  return json({ accepted: true, application_id: data.id }, 202);
});
