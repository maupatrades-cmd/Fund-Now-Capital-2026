// twilio-voice-token: a short-lived Twilio Access Token so the Director's browser can place a call (owner, 23 Nov 2026).
//
// Called from the browser with the user's Supabase session. Deployed verify_jwt=false (so we can answer the CORS
// preflight and return clean JSON); the caller is authenticated here: getUser() with their JWT, then the database
// decides who may call (can_place_calls(): the Director today). The token allows OUTGOING calls through the TwiML App
// only (incoming disabled), identity = the caller's profile id, valid for one hour.
//
// Until every Twilio secret is set it answers 503 "Calling is not set up yet" (fails closed).
// Secrets: TWILIO_ACCOUNT_SID, TWILIO_API_KEY_SID, TWILIO_API_KEY_SECRET, TWILIO_TWIML_APP_SID
// (SUPABASE_URL / SUPABASE_ANON_KEY are injected by Supabase).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildVoiceAccessToken } from "../_shared/twilio-core.js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "Missing authorization" }, 401);
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  const caller = userData?.user;
  if (userErr || !caller) return json({ error: "Not authenticated" }, 401);

  const { data: allowed, error: allowErr } = await userClient.rpc("can_place_calls");
  if (allowErr) return json({ error: "Authorization check failed" }, 500);
  if (allowed !== true) return json({ error: "Only the Director can place calls from the CRM" }, 403);

  const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID") ?? "";
  const apiKeySid = Deno.env.get("TWILIO_API_KEY_SID") ?? "";
  const apiKeySecret = Deno.env.get("TWILIO_API_KEY_SECRET") ?? "";
  const twimlAppSid = Deno.env.get("TWILIO_TWIML_APP_SID") ?? "";
  const callerId = Deno.env.get("TWILIO_CALLER_ID") ?? "";
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN") ?? "";
  if (!accountSid || !apiKeySid || !apiKeySecret || !twimlAppSid || !callerId || !authToken) {
    return json({ error: "Calling is not set up yet", code: "not_configured" }, 503);
  }

  try {
    const token = await buildVoiceAccessToken({ accountSid, apiKeySid, apiKeySecret, twimlAppSid, identity: caller.id });
    return json({ token, identity: caller.id, expires_in: 3600 });
  } catch (e) {
    console.error("token build failed:", (e as Error).message);
    return json({ error: "Could not start the call" }, 500);
  }
});
