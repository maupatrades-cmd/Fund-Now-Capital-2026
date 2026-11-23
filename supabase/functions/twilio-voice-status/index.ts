// twilio-voice-status: Twilio's progress reports for calls placed from the CRM (owner, 23 Nov 2026).
// verify_jwt=false; every request MUST carry a valid X-Twilio-Signature or it is refused with 403.
//
// Two kinds of request arrive here:
//   * the <Number statusCallback> events of the dialled leg (initiated / ringing / answered / completed): the crm_calls
//     row is keyed on the PARENT call (the browser leg), so ParentCallSid is used when present;
//   * ?kind=dial-action: Twilio's <Dial action> when the dial ends (DialCallStatus, DialCallDuration) on the parent call.
//     It must answer with TwiML; an empty <Response/> ends the browser leg.
// record_call_status (service role) updates the row idempotently and writes the activity log line once.
// Secrets: TWILIO_AUTH_TOKEN (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are injected by Supabase).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { EMPTY_TWIML, formToObject, publicFunctionUrl, validateTwilioSignature } from "../_shared/twilio-core.js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function xml(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/xml" } });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN") ?? "";
  if (!authToken) return new Response("Not configured", { status: 503 });

  const search = new URL(req.url).search;
  const params = formToObject(await req.text());
  const url = publicFunctionUrl(SUPABASE_URL, "twilio-voice-status", search);
  const ok = await validateTwilioSignature(authToken, req.headers.get("X-Twilio-Signature") ?? "", url, params);
  if (!ok) return new Response("Forbidden", { status: 403 });

  const isDialAction = new URLSearchParams(search).get("kind") === "dial-action";
  const sid = isDialAction ? params.CallSid : (params.ParentCallSid || params.CallSid);
  const status = isDialAction ? params.DialCallStatus : params.CallStatus;
  const durationRaw = isDialAction ? params.DialCallDuration : params.CallDuration;
  const duration = durationRaw && /^\d+$/.test(durationRaw) ? Number(durationRaw) : null;

  if (sid && status) {
    const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error } = await service.rpc("record_call_status", {
      p_call_sid: sid, p_status: status, p_duration_seconds: duration,
    });
    if (error) console.error("record_call_status failed:", error.message);
  }
  return isDialAction ? xml(EMPTY_TWIML) : new Response(null, { status: 204 });
});
