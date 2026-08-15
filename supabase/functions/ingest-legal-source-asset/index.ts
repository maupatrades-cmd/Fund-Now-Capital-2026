// ingest-legal-source-asset (Build 4 — legal PDF ingestion machinery)
//
// Owner-only Edge Function that INGESTS an approved legal source PDF:
//   1. downloads the uploaded file from the private `legal-source-approved`
//      bucket (service role — guaranteed read),
//   2. computes its SHA-256 SERVER-SIDE (the trustworthy place to hash — the DB
//      cannot read storage bytes, and a browser-computed hash is only as good as
//      the browser; server-side hashing is the house integrity rule, cf. the
//      terms framework),
//   3. verifies it against the approved digest via `register_legal_source_asset`
//      (which flips the registry row to `verified`, or `mismatch` + an
//      activity-log alert — publication downstream gates on `verified`),
//   4. OPTIONALLY, when a template_id + version are supplied and the hash
//      verified, creates a SOURCE-BACKED template version via
//      `create_legal_template_version` (source_storage_path + source_filename +
//      the verified content_sha256). This registers the PDF as that template's
//      first version WITHOUT inventing any wording — the markdown execution copy
//      is added later by the owner in the Studio.
//
// MACHINERY ONLY — it ingests owner-approved bytes and never fabricates legal
// wording. Buildable now; it just waits on the owner uploading the PDFs.
//
// AUTH MODEL (same as admin-invite-user): invoked from the OWNER'S browser, so
// it authenticates the CALLER. Deployed verify_jwt=false; it reads the caller's
// Bearer JWT, confirms is_owner() via a user-scoped client, and calls the
// owner-gated RPCs in that same owner context (so is_owner() passes inside them
// and the activity log records the owner). The service-role client is used only
// to download the private bucket bytes.
//
// Env: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (auto-injected).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const SOURCE_BUCKET = "legal-source-approved";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

type IngestBody = {
  source_key?: string;
  storage_path?: string;
  template_id?: string;
  version?: string;
};

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // ---- authorize caller (must be the owner) --------------------------------
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "Missing authorization" }, 401);

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "Not authenticated" }, 401);

  const { data: isOwner, error: ownerErr } = await userClient.rpc("is_owner");
  if (ownerErr) return json({ error: "Authorization check failed" }, 500);
  if (isOwner !== true) return json({ error: "Only the owner can ingest legal source assets" }, 403);

  // ---- validate input ------------------------------------------------------
  let body: IngestBody;
  try {
    body = (await req.json()) as IngestBody;
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }
  const sourceKey = (body.source_key ?? "").trim();
  const storagePath = (body.storage_path ?? "").trim().replace(/^\/+/, "");
  const templateId = (body.template_id ?? "").trim() || null;
  const versionLabel = (body.version ?? "").trim() || null;
  if (!sourceKey) return json({ error: "source_key is required" }, 400);
  if (!storagePath) return json({ error: "storage_path is required (the file's path in the legal-source-approved bucket)" }, 400);
  if ((templateId && !versionLabel) || (!templateId && versionLabel)) {
    return json({ error: "template_id and version must be supplied together (or neither)" }, 400);
  }

  // ---- download the uploaded PDF (service role) ----------------------------
  const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: file, error: dlErr } = await service.storage.from(SOURCE_BUCKET).download(storagePath);
  if (dlErr || !file) {
    return json({ error: `Could not read ${SOURCE_BUCKET}/${storagePath}: ${dlErr?.message ?? "not found"}` }, 404);
  }

  // ---- compute SHA-256 server-side -----------------------------------------
  let computed: string;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    computed = toHex(await crypto.subtle.digest("SHA-256", bytes));
  } catch (e) {
    return json({ error: `Hashing failed: ${(e as Error).message}` }, 500);
  }

  // ---- verify against the approved digest (owner context) ------------------
  const { data: asset, error: regErr } = await userClient.rpc("register_legal_source_asset", {
    p_source_key: sourceKey,
    p_computed_sha256: computed,
    p_storage_path: storagePath,
  });
  if (regErr) return json({ error: `Registration failed: ${regErr.message}` }, 400);
  const verified = (asset as { status?: string } | null)?.status === "verified";

  // ---- optionally create a source-backed template version ------------------
  let createdVersion: unknown = null;
  if (verified && templateId && versionLabel) {
    const originalFilename =
      (asset as { original_filename?: string } | null)?.original_filename ?? null;
    const { data: ver, error: verErr } = await userClient.rpc("create_legal_template_version", {
      p_template_id: templateId,
      p_version: versionLabel,
      p_content_markdown: null,
      p_source_storage_path: storagePath,
      p_source_filename: originalFilename,
      p_content_sha256: computed,
      p_effective_date: null,
    });
    if (verErr) {
      // The asset IS verified (that write stands), but the requested template
      // version was NOT created — a partial success. Return ok:false with a
      // distinct status + version_error so the caller cannot mistake this for a
      // clean verify; the owner retries only the version step.
      return json({
        ok: false,
        status: "verified_version_failed",
        computed_sha256: computed,
        asset,
        version_error: verErr.message,
      });
    }
    createdVersion = ver;
  }

  return json({
    ok: true,
    status: (asset as { status?: string } | null)?.status ?? "unknown",
    computed_sha256: computed,
    asset,
    version: createdVersion,
  });
});
