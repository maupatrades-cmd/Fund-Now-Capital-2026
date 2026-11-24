// meet-ice-servers (owner, 24 Nov 2026): the network settings a browser needs for an in-CRM call or meeting.
// Deploy with verify_jwt = true: Supabase's gateway refuses callers without a valid login before this code runs, and the
// function also re-checks the user. It always returns free public STUN servers. When the optional relay secrets
// MEET_TURN_URLS (comma-separated turn:/turns: URLs), MEET_TURN_USERNAME and MEET_TURN_CREDENTIAL are set, it adds that
// TURN relay, which helps calls connect on strict mobile or office networks. Nothing here touches the database.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" } });

const STUN = { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json({ error: "Missing authorization" }, 401);
  const client = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.getUser();
  if (error || !data?.user) return json({ error: "Not authenticated" }, 401);

  const urls = (Deno.env.get("MEET_TURN_URLS") ?? "").split(",").map((u) => u.trim()).filter((u) => /^turns?:/.test(u));
  const username = Deno.env.get("MEET_TURN_USERNAME") ?? "";
  const credential = Deno.env.get("MEET_TURN_CREDENTIAL") ?? "";
  const iceServers: Record<string, unknown>[] = [STUN];
  if (urls.length > 0 && username && credential) iceServers.push({ urls, username, credential });
  return json({ iceServers, relay: iceServers.length > 1 });
});
