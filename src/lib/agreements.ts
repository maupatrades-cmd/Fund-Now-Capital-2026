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

/* ------------------------------------------------------------------------- *
 * Owner-side dispatch shapes (Build 8.2).
 * ------------------------------------------------------------------------- */

export type AgreementState =
  | "draft"
  | "approved_for_send"
  | "sent"
  | "viewed"
  | "in_progress"
  | "signer_signed"
  | "countersign_pending"
  | "executed"
  | "expired"
  | "declined"
  | "withdrawn"
  | "superseded"
  | "delivery_failed"
  | "identity_failed";

export type AgreementListRow = {
  id: string;
  reference: string;
  document_type: string;
  title_snapshot: string;
  state: AgreementState;
  sent_at: string | null;
  executed_at: string | null;
  expires_at: string | null;
  created_at: string;
};

export type AgreementPartyRow = SigningParty & {
  agreement_id: string;
  party_order: number;
  email: string | null;
  profile_id: string | null;
  frozen: boolean;
};

export type SignatureEventRow = {
  id: string;
  event_type: string;
  occurred_at: string;
  party_snapshot_id: string | null;
  actor_profile_id: string | null;
  signature_method: string | null;
  detail: Record<string, unknown> | null;
};

export type ConsentRow = {
  id: string;
  party_snapshot_id: string;
  consent_kind: string;
  accepted: boolean;
  notice_version: string | null;
  created_at: string;
};

export type SignatureRequestRow = {
  id: string;
  party_snapshot_id: string;
  issued_at: string;
  expires_at: string;
  revoked_at: string | null;
  last_opened_at: string | null;
  consumed_at: string | null;
  delivery_status: string;
};

export type AgreementDetail = {
  instance: AgreementListRow & {
    template_version_id: string;
    subject_profile_id: string | null;
    unsigned_sha256: string | null;
    executed_sha256: string | null;
    decline_reason: string | null;
    withdraw_reason: string | null;
    frozen_at: string | null;
    first_viewed_at: string | null;
    signer_signed_at: string | null;
    terminal_at: string | null;
  };
  parties: AgreementPartyRow[];
  events: SignatureEventRow[];
  consents: ConsentRow[];
  requests: SignatureRequestRow[];
};

export type SignableProfile = {
  id: string;
  full_name: string | null;
  email: string | null;
  role: string;
};

export type AgreementPartyInput = {
  party_role: "signer" | "countersignatory" | "witness" | "data_subject";
  legal_name: string;
  represented_party: string;
  capacity: string;
  email: string;
  profile_id: string | null;
  is_fnc: boolean;
};

/**
 * `send_agreement` returns the RAW signing tokens — the only time they exist in
 * plaintext anywhere. Only the SHA-256 is stored, so these cannot be re-read
 * later; the dispatch UI must surface them immediately and say so.
 */
export type SendResult = {
  agreementId: string;
  was_transitioned: boolean;
  state: string;
  reason?: string;
  tokens?: Array<{
    party_snapshot_id: string;
    token: string;
    expires_at: string;
  }>;
};

/** Signing URL for a raw token, absolute so the owner can paste it into a message. */
export function signingUrl(token: string): string {
  const origin =
    typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/sign/${token}`;
}

/**
 * States from which nothing further can happen. Shared by the register's "Open"
 * filter and the detail page's action gating — when these two lists drifted
 * apart, a failed agreement showed as Open while offering no action at all.
 */
export const TERMINAL_AGREEMENT_STATES: AgreementState[] = [
  "executed",
  "expired",
  "declined",
  "withdrawn",
  "superseded",
  "delivery_failed",
  "identity_failed",
];

export function isTerminalAgreementState(state: AgreementState): boolean {
  return TERMINAL_AGREEMENT_STATES.includes(state);
}

export const AGREEMENT_STATE_LABEL: Record<AgreementState, string> = {
  draft: "Draft",
  approved_for_send: "Approved to send",
  sent: "Sent",
  viewed: "Viewed",
  in_progress: "In progress",
  signer_signed: "Signed",
  countersign_pending: "Awaiting your countersignature",
  executed: "Executed",
  expired: "Expired",
  declined: "Declined",
  withdrawn: "Withdrawn",
  superseded: "Superseded",
  delivery_failed: "Delivery failed",
  identity_failed: "Identity check failed",
};

/** Pill tone per state — green = done, amber = needs attention, slate = inert. */
export function agreementStateTone(
  state: AgreementState,
): "ok" | "warn" | "live" | "muted" {
  switch (state) {
    case "executed":
      return "ok";
    case "countersign_pending":
      return "warn";
    case "sent":
    case "viewed":
    case "in_progress":
    case "signer_signed":
      return "live";
    default:
      return "muted";
  }
}

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

/* ------------------------------------------------------------------------- *
 * Signature artifacts (Build 8.3).
 * ------------------------------------------------------------------------- */

export type SignatureMethod = "typed" | "drawn" | "uploaded";

export const SIGNATURE_BUCKET = "legal-signature-artifacts";

/** Max upload size, mirroring the bucket's server-side `file_size_limit`. */
export const SIGNATURE_MAX_BYTES = 2 * 1024 * 1024;

export const SIGNATURE_ACCEPTED_TYPES = ["image/png", "image/jpeg"];

/**
 * Storage path for a signature image: `signature/{uid}/{agreementId}/{uuid}.{ext}`.
 *
 * Segment 2 is the uploader, which is what the storage policy checks — a signer
 * can only write inside their own folder. The fresh uuid per attempt means a
 * re-draw writes a NEW object rather than overwriting the previous one: the
 * bucket grants no UPDATE or DELETE to signers, because a signature artifact is
 * evidence of a legal act. The path recorded on `signature_artifacts` is the
 * one that counts.
 */
export function signatureObjectPath(
  uid: string,
  agreementId: string,
  extension: string,
): string {
  const unique =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `signature/${uid}/${agreementId}/${unique}.${extension}`;
}

/** Lowercase 64-hex SHA-256 of raw bytes — the artifact's integrity fingerprint. */
export async function sha256HexOfBytes(
  buffer: ArrayBuffer,
): Promise<string | null> {
  try {
    if (typeof crypto === "undefined" || !crypto.subtle) return null;
    const digest = await crypto.subtle.digest("SHA-256", buffer);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return null;
  }
}

export function extensionForMime(mime: string): string {
  return mime === "image/jpeg" ? "jpg" : "png";
}

/**
 * Hand the signer a copy of exactly what they are being asked to sign, before
 * they sign it. A signer who cannot keep a copy of the wording is relying on
 * the counterparty's record of it — which is the wrong way round.
 */
export function downloadReviewCopy(
  reference: string,
  title: string,
  markdown: string,
): void {
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${reference}-${title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.md`;
  link.click();
  URL.revokeObjectURL(url);
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
