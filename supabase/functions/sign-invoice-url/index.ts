// sign-invoice-url — service-role helper for the private `invoices` bucket.
// action 'sign' (default): mint a short-lived signed URL for an object.
// action 'remove': delete an object (Storage API; direct SQL delete is blocked).
// Auth: shared X-Webhook-Secret header (same pattern as the other pg_net fns).
// (Deployed for the C1.1 smoke test; the sign path backs the C1.2 download button.)
//
// RECOVERED INTO VERSION CONTROL 2026-08-16 (wave "Close the Drift", Lane 3).
// This function had been running in production since the C1.1 smoke test with no
// source in the repository — it could not be reviewed, changed safely, or rebuilt
// after a loss. Source below is the deployed v2, fetched verbatim from Supabase.
import { createClient } from "@supabase/supabase-js";

Deno.serve(async (req: Request) => {
  const secret = Deno.env.get("WEBHOOK_SECRET");
  if (!secret || req.headers.get("X-Webhook-Secret") !== secret) {
    return new Response("Unauthorized", { status: 401 });
  }
  let body: { path?: string; action?: string; expires_in?: number };
  try {
    body = await req.json();
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  const path = body?.path;
  const action = body?.action ?? "sign";
  const expiresIn = body?.expires_in ?? 3600;
  if (!path) return new Response(JSON.stringify({ error: "missing path" }), { status: 400 });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  if (action === "remove") {
    const { data, error } = await supabase.storage.from("invoices").remove([path]);
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    return new Response(JSON.stringify({ removed: (data ?? []).map((o) => o.name) }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const { data, error } = await supabase.storage.from("invoices").createSignedUrl(path, expiresIn);
  if (error || !data) {
    return new Response(JSON.stringify({ error: error?.message ?? "sign failed" }), { status: 500 });
  }
  let url = data.signedUrl;
  if (url && url.startsWith("/")) url = Deno.env.get("SUPABASE_URL") + "/storage/v1" + url;
  return new Response(JSON.stringify({ signed_url: url }), {
    headers: { "Content-Type": "application/json" },
  });
});
