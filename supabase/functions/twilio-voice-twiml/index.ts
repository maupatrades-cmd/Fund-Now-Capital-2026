// twilio-voice-twiml: the Voice URL of the Twilio TwiML App (owner, 23 Nov 2026). Twilio calls this when the
// Director's browser places a call. verify_jwt=false: Twilio cannot send a Supabase JWT; instead the request MUST carry
// a valid X-Twilio-Signature (HMAC-SHA1 with TWILIO_AUTH_TOKEN over the public URL + sorted POST params) or it is
// refused with 403.
//
// The browser sends only `callTarget` (a call_targets id made by prepare_call). The number is looked up here, server
// side, through claim_call_target (service role): the target must be unexpired, unused and prepared by the same person
// (Twilio "From" is client:<profile id>). It is marked used, a crm_calls row is opened, and the TwiML dials the number
// with record="do-not-record". Anything else gets a short spoken message and a hang-up.
// Secrets: TWILIO_AUTH_TOKEN, TWILIO_CALLER_ID (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are injected by Supabase).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  dialTwiml, formToObject, publicFunctionUrl, sayTwiml, validateTwilioSignature,
} from "../_shared/twilio-core.js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function xml(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/xml" } });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN") ?? "";
  const callerId = Deno.env.get("TWILIO_CALLER_ID") ?? "";
  if (!authToken || !callerId) return xml(sayTwiml("Calling is not set up yet."), 503);

  const params = formToObject(await req.text());
  const url = publicFunctionUrl(SUPABASE_URL, "twilio-voice-twiml", new URL(req.url).search);
  const ok = await validateTwilioSignature(authToken, req.headers.get("X-Twilio-Signature") ?? "", url, params);
  if (!ok) return new Response("Forbidden", { status: 403 });

  const target = params.callTarget ?? "";
  const callSid = params.CallSid ?? "";
  const from = params.From ?? "";
  const identity = from.startsWith("client:") ? from.slice("client:".length) : "";
  if (!UUID.test(target) || !callSid || !UUID.test(identity)) {
    return xml(sayTwiml("This call could not be placed."));
  }

  const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: e164, error } = await service.rpc("claim_call_target", {
    p_target_id: target, p_call_sid: callSid, p_caller_identity: identity,
  });
  if (error) {
    console.error("claim_call_target failed:", error.message);
    return xml(sayTwiml("This call could not be placed."));
  }
  if (!e164) return xml(sayTwiml("This call has expired. Please press call again."));

  const statusUrl = publicFunctionUrl(SUPABASE_URL, "twilio-voice-status", "");
  const actionUrl = publicFunctionUrl(SUPABASE_URL, "twilio-voice-status", "?kind=dial-action");
  return xml(dialTwiml({ callerId, e164: String(e164), statusUrl, actionUrl }));
});
