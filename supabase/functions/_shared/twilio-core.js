// Twilio helpers shared by the twilio-voice-* Edge Functions. Plain JavaScript using only Web Crypto, so it runs the
// same in Deno (Edge Functions) and Node (tests/twilio-core.test.mjs). No secrets live here: every value is passed in.

const enc = new TextEncoder();

function base64(bytes) {
  let bin = "";
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
  return btoa(bin);
}

function base64url(input) {
  const b64 = typeof input === "string" ? btoa(unescape(encodeURIComponent(input))) : base64(input);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(hash, secret, message) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", key, enc.encode(message));
}

// Twilio Access Token (JWT, HS256) with a Voice grant: outgoing calls through the TwiML App only, incoming disabled.
// https://www.twilio.com/docs/iam/access-tokens
export async function buildVoiceAccessToken({
  accountSid, apiKeySid, apiKeySecret, twimlAppSid, identity, nowSeconds, ttlSeconds = 3600,
}) {
  if (!accountSid || !apiKeySid || !apiKeySecret || !twimlAppSid || !identity) {
    throw new Error("Missing Twilio settings for the access token");
  }
  const now = Math.floor(nowSeconds ?? Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT", cty: "twilio-fpa;v=1" };
  const payload = {
    jti: `${apiKeySid}-${now}`,
    iss: apiKeySid,
    sub: accountSid,
    iat: now,
    nbf: now,
    exp: now + ttlSeconds,
    grants: {
      identity,
      voice: { incoming: { allow: false }, outgoing: { application_sid: twimlAppSid } },
    },
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const sig = await hmac("SHA-256", apiKeySecret, unsigned);
  return `${unsigned}.${base64url(sig)}`;
}

// X-Twilio-Signature: base64(HMAC-SHA1(authToken, fullUrl + each POST param name+value, names sorted)).
// https://www.twilio.com/docs/usage/security#validating-requests
export async function computeTwilioSignature(authToken, url, params) {
  const data = Object.keys(params).sort().reduce((acc, k) => acc + k + (params[k] ?? ""), url);
  return base64(await hmac("SHA-1", authToken, data));
}

function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function validateTwilioSignature(authToken, signature, url, params) {
  if (!authToken || !signature || !url) return false;
  return safeEqual(await computeTwilioSignature(authToken, url, params), signature);
}

export function escapeXml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// TwiML that dials one number without recording, reporting each leg's progress to statusUrl.
export function dialTwiml({ callerId, e164, statusUrl, actionUrl }) {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Dial callerId="${escapeXml(callerId)}" record="do-not-record"`
    + ` answerOnBridge="true" action="${escapeXml(actionUrl)}" method="POST"><Number statusCallback="${escapeXml(statusUrl)}"`
    + ` statusCallbackMethod="POST" statusCallbackEvent="initiated ringing answered completed">${escapeXml(e164)}</Number>`
    + `</Dial></Response>`;
}

export function sayTwiml(message) {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Say>${escapeXml(message)}</Say><Hangup/></Response>`;
}

export const EMPTY_TWIML = `<?xml version="1.0" encoding="UTF-8"?><Response/>`;

// Twilio posts application/x-www-form-urlencoded bodies; read them into a plain object.
export function formToObject(text) {
  const out = {};
  for (const [k, v] of new URLSearchParams(text)) out[k] = v;
  return out;
}

// The public URL Twilio signed: the Supabase functions URL, not the internal request URL the function sees.
export function publicFunctionUrl(supabaseUrl, functionName, search) {
  return `${String(supabaseUrl).replace(/\/$/, "")}/functions/v1/${functionName}${search || ""}`;
}
