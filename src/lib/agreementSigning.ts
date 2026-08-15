import { supabase } from "@/lib/supabase";

export const REQUIRED_SIGNING_CONSENTS = [
  "signer_identity",
  "reviewed_document",
  "intent_to_bind",
  "electronic_delivery",
] as const;

export type SigningConsent = (typeof REQUIRED_SIGNING_CONSENTS)[number];

export type SigningPacket = {
  agreement_id: string;
  reference: string;
  title: string;
  document_type: string;
  state: string;
  expires_at: string;
  consumed_at: string | null;
  party_legal_name: string;
  party_capacity: string | null;
  represented_party: string | null;
  template_version: string;
  effective_date: string | null;
  content_sha256: string | null;
  content_markdown: string | null;
  content_available: boolean;
  accepted_consents: SigningConsent[];
};

function signingError(error: { message?: string } | null, fallback: string) {
  return new Error(error?.message || fallback);
}

export async function openSigningPacket(token: string): Promise<SigningPacket> {
  const packet = await supabase.rpc("open_signature_request_packet", { p_token: token });
  if (packet.error) throw signingError(packet.error, "Agreement could not be loaded");
  return packet.data as SigningPacket;
}

export async function recordSigningConsent(token: string, consent: SigningConsent) {
  const { error } = await supabase.rpc("record_agreement_consent", {
    p_token: token,
    p_consent_kind: consent,
    p_notice_version: "fnc-signing-v1",
    p_accepted: true,
    p_ip_hash: null,
    p_user_agent_hash: await hashUserAgent(),
  });
  if (error) throw signingError(error, "Acknowledgement could not be recorded");
}

export async function submitTypedSignature(token: string, legalName: string) {
  const { data, error } = await supabase.rpc("submit_agreement_signature", {
    p_token: token,
    p_method: "typed",
    p_artifact_sha256: null,
    p_storage_path: null,
    p_adopted_text: legalName.trim(),
    p_ip_hash: null,
    p_user_agent_hash: await hashUserAgent(),
  });
  if (error) throw signingError(error, "Signature could not be submitted");
  return data as { state: string; agreement_id: string };
}

export async function declineSigningRequest(token: string, reason: string) {
  const { data, error } = await supabase.rpc("decline_signature_request", {
    p_token: token,
    p_reason: reason.trim(),
  });
  if (error) throw signingError(error, "Agreement could not be declined");
  return data as { state: string };
}

async function hashUserAgent(): Promise<string | null> {
  if (!globalThis.crypto?.subtle || typeof navigator === "undefined") return null;
  const bytes = new TextEncoder().encode(navigator.userAgent);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function downloadAgreementCopy(packet: SigningPacket) {
  if (!packet.content_markdown) return;
  const blob = new Blob([packet.content_markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${packet.reference}-${packet.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.md`;
  link.click();
  URL.revokeObjectURL(url);
}
