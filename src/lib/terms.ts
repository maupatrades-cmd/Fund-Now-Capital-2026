// Terms & Conditions Acceptance Framework (Sprint 4, Lane 4d) — shared types +
// helpers for the first-login acceptance modal and the public /terms/current
// viewer.

export type PortalRole = "partner" | "contractor";

// Mirrors the public.terms_versions row shape (what get_current_terms_for_role
// returns and what the public viewer selects).
export type TermsVersion = {
  id: string;
  version_number: string;
  effective_date: string;
  content_markdown: string;
  applies_to_roles: string[];
  is_current: boolean;
  published_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

// Best-effort, POPIA-friendly client IP hash sent as the `p_ip_hash` fallback to
// accept_terms.
//
// The AUTHORITATIVE ip_hash is derived SERVER-SIDE inside the accept_terms RPC
// from the real client IP PostgREST sees (see the migration) — that value is
// preferred and this client value is only a fallback for the rare case the
// server can't resolve a header IP. So this call is deliberately best-effort:
// a short timeout, and any failure (blocked network, offline, no crypto.subtle)
// resolves to null WITHOUT ever blocking or failing acceptance. We hash the IP
// here (never send it raw) so no plaintext IP crosses the wire from the browser.
export async function hashClientIp(): Promise<string | null> {
  try {
    if (typeof crypto === "undefined" || !crypto.subtle) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    let ip = "";
    try {
      const res = await fetch("https://api.ipify.org?format=json", {
        signal: controller.signal,
      });
      if (res.ok) {
        const body = (await res.json()) as { ip?: string };
        ip = (body.ip ?? "").trim();
      }
    } finally {
      clearTimeout(timer);
    }
    if (!ip) return null;
    const bytes = new TextEncoder().encode(ip);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return null; // never block acceptance over IP hashing
  }
}

// A trimmed user-agent for the acceptance record (the RPC also caps length).
export function currentUserAgent(): string | null {
  if (typeof navigator === "undefined") return null;
  const ua = (navigator.userAgent ?? "").trim();
  return ua ? ua.slice(0, 1024) : null;
}
