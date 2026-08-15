/*
 * Build 8.1 — signing-surface types + helpers.
 *
 * Mirrors the shapes returned by the token-gated e-sign RPCs. The token in the
 * URL is the credential (same posture the backend takes); the signer must ALSO
 * hold a session, because every signer RPC is granted to `authenticated` only
 * and anon is explicitly revoked. That is deliberate: role signers
 * (partner / contractor / lead-referrer) are platform users, so a signing link
 * that requires a login is stronger evidence of identity, not weaker.
 */

import {
  LEGAL_DOCUMENT_TYPE_LABEL,
  type LegalDocumentType,
} from "@/lib/legalTemplates";

// The four §7.2 acknowledgements. `submit_agreement_signature` refuses to write
// a signature until all four are recorded as accepted, so this list is a mirror
// of a server-side gate — never the gate itself.
//
// Wording matters legally: each line is what the signer is attesting to, and it
// is stored verbatim-by-version in consent_records.notice_version.
export const CONSENT_NOTICE_VERSION = "v1.0";

export type ConsentKind =
  | "signer_identity"
  | "reviewed_document"
  | "intent_to_bind"
  | "electronic_delivery";

export const REQUIRED_CONSENTS: ReadonlyArray<{
  kind: ConsentKind;
  label: string;
}> = [
  {
    kind: "signer_identity",
    label:
      "I confirm that I am the person named as the signing party on this document, and that I am signing it myself.",
  },
  {
    kind: "reviewed_document",
    label:
      "I have read the full document above and I understand its contents.",
  },
  {
    kind: "intent_to_bind",
    label:
      "I intend my electronic signature to bind me (and any party I represent) to this agreement.",
  },
  {
    kind: "electronic_delivery",
    label:
      "I agree to sign electronically and to receive the executed document and related notices electronically.",
  },
];

export type SigningParty = {
  id: string;
  party_role: string;
  legal_name: string;
  represented_party: string | null;
  capacity: string | null;
  is_fnc: boolean;
};

export type SigningPackage = {
  agreement: {
    id: string;
    reference: string;
    document_type: string;
    title: string;
    state: string;
    sent_at: string | null;
    expires_at: string;
    unsigned_sha256: string | null;
    decline_reason: string | null;
  };
  party: SigningParty;
  other_parties: SigningParty[];
  document: {
    content_markdown: string | null;
    content_sha256: string | null;
    version: string;
    effective_date: string | null;
    has_source_file: boolean;
    source_filename: string | null;
  };
  variables: Record<string, unknown>;
  fee_summary: Record<string, unknown> | null;
  consents: Partial<Record<ConsentKind, boolean>>;
  already_signed: boolean;
  can_sign: boolean;
  required_consent_kinds: ConsentKind[];
};

/** Lowercase 64-hex SHA-256 of a UTF-8 string, or null where WebCrypto is absent. */
export async function sha256Hex(input: string): Promise<string | null> {
  try {
    if (typeof crypto === "undefined" || !crypto.subtle) return null;
    const bytes = new TextEncoder().encode(input);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return null;
  }
}

/*
 * The signer's IP is deliberately NOT collected here.
 *
 * `record_agreement_consent` / `submit_agreement_signature` accept a p_ip_hash,
 * but a browser cannot know its own public IP without asking a third party, and
 * a third-party-asserted IP recorded as signing evidence is evidence of what
 * that third party said — not of where the signer was. Writing a guessed value
 * into an append-only legal ledger is worse than writing nothing, so we send
 * null and let the user-agent hash carry the device evidence. If IP evidence is
 * required later it must be captured server-side from the request headers (the
 * pattern `accept_terms` already uses).
 */
export async function userAgentHash(): Promise<string | null> {
  if (typeof navigator === "undefined") return null;
  const ua = (navigator.userAgent ?? "").trim();
  if (!ua) return null;
  return sha256Hex(ua.slice(0, 1024));
}

/** A signing token is the 64-hex raw token issued by `send_agreement`. */
export function isValidSigningToken(token: string | undefined): boolean {
  return !!token && /^[0-9a-f]{64}$/.test(token);
}

/*
 * Reuses the Document Studio's label map (the mirror of the live
 * `legal_document_type` enum) rather than keeping a second copy — one drifting
 * label set on a legal surface is one too many. Falls back to a de-snaked label
 * so a newly added enum value renders readably instead of crashing.
 */
export function documentTypeLabel(documentType: string): string {
  return (
    LEGAL_DOCUMENT_TYPE_LABEL[documentType as LegalDocumentType] ??
    documentType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

/** Human sentence for a terminal/unavailable agreement state. */
export function signingUnavailableReason(state: string): string | null {
  switch (state) {
    case "executed":
      return "This agreement has already been fully executed.";
    case "declined":
      return "This agreement was declined and can no longer be signed.";
    case "withdrawn":
      return "Fund Now Capital withdrew this agreement.";
    case "expired":
      return "This signing link has expired. Ask Fund Now Capital to re-send it.";
    case "superseded":
      return "This agreement was replaced by a corrected version.";
    case "countersign_pending":
      return "You have signed. Fund Now Capital still needs to countersign.";
    case "draft":
    case "approved_for_send":
      return "This agreement has not been sent for signing yet.";
    case "delivery_failed":
    case "identity_failed":
      return "This agreement cannot be signed. Please contact Fund Now Capital.";
    default:
      return null;
  }
}
