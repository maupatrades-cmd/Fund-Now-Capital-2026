// Types + label maps mirroring the LIVE legal template registry (Build 41,
// `legal_document_templates` / `legal_document_template_versions`) and the legal
// source-asset registry (#218 + Build 3, `legal_source_assets`). Owner Document
// Studio (Build 7) is a UI over those objects — it manufactures NO legal wording.
//
// The enum label sets are mirrored from the DB enums so the picker can never
// offer a value the backend would reject. Keep them in sync with the migrations.

export type LegalDocumentRole =
  | "partner"
  | "contractor"
  | "lead_referrer"
  | "client";

export type LegalDocumentType =
  | "referral_partner_agreement"
  | "introducer_agreement"
  | "independent_contractor_agreement"
  | "lead_referrer_agreement"
  | "nda"
  | "popia_agreement"
  | "commission_schedule"
  | "acceptable_use_policy"
  | "code_of_conduct"
  | "information_security_acknowledgement"
  | "onboarding_verification"
  | "training_assessment"
  | "annexure"
  | "authority_and_consent";

export type LegalTemplateStatus =
  | "draft"
  | "legal_review"
  | "published"
  | "superseded"
  | "draft_blocked";

export type LegalSourceAssetStatus = "pending" | "verified" | "mismatch";

export const LEGAL_DOCUMENT_ROLES: LegalDocumentRole[] = [
  "partner",
  "contractor",
  "lead_referrer",
  "client",
];

export const LEGAL_DOCUMENT_TYPES: LegalDocumentType[] = [
  "referral_partner_agreement",
  "introducer_agreement",
  "independent_contractor_agreement",
  "lead_referrer_agreement",
  "nda",
  "popia_agreement",
  "commission_schedule",
  "acceptable_use_policy",
  "code_of_conduct",
  "information_security_acknowledgement",
  "onboarding_verification",
  "training_assessment",
  "annexure",
  "authority_and_consent",
];

export const LEGAL_DOCUMENT_ROLE_LABEL: Record<LegalDocumentRole, string> = {
  partner: "Partner",
  contractor: "Contractor",
  lead_referrer: "Lead Referrer",
  client: "Client",
};

export const LEGAL_DOCUMENT_TYPE_LABEL: Record<LegalDocumentType, string> = {
  referral_partner_agreement: "Referral Partner Agreement",
  introducer_agreement: "Introducer Agreement",
  independent_contractor_agreement: "Independent Contractor Agreement",
  lead_referrer_agreement: "Lead Referrer Agreement",
  nda: "NDA",
  popia_agreement: "POPIA Agreement",
  commission_schedule: "Commission Schedule",
  acceptable_use_policy: "Acceptable Use Policy",
  code_of_conduct: "Code of Conduct",
  information_security_acknowledgement: "Information Security Acknowledgement",
  onboarding_verification: "Onboarding Verification",
  training_assessment: "Training Assessment",
  annexure: "Annexure",
  authority_and_consent: "Authority & Consent Form",
};

// Human label + a semantic tone for the status pill (matches the brand palette
// usage elsewhere: green = live, slate = neutral/draft, amber = attention).
export const LEGAL_TEMPLATE_STATUS_LABEL: Record<LegalTemplateStatus, string> = {
  draft: "Draft",
  legal_review: "In legal review",
  published: "Published (live)",
  superseded: "Superseded",
  draft_blocked: "Blocked — no wording",
};

export type LegalTemplate = {
  id: string;
  document_type: LegalDocumentType;
  role: LegalDocumentRole;
  legal_entity: string;
  title: string;
  jurisdiction: string;
  description: string | null;
  created_at: string;
  updated_at: string;
};

export type LegalTemplateVersion = {
  id: string;
  template_id: string;
  version: string;
  status: LegalTemplateStatus;
  effective_date: string | null;
  content_markdown: string | null;
  source_storage_path: string | null;
  source_filename: string | null;
  content_sha256: string | null;
  approver: string | null;
  approval_time: string | null;
  superseded_by_version_id: string | null;
  is_current: boolean;
  created_at: string;
  updated_at: string;
};

export type LegalSourceAsset = {
  id: string;
  source_key: string;
  original_filename: string;
  workspace_path: string | null;
  pages: number | null;
  expected_sha256: string;
  registered_sha256: string | null;
  storage_path: string | null;
  status: LegalSourceAssetStatus;
  verified_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

// Short SHA display: first 10 hex of a 64-hex digest, or an em dash when absent.
export function shortHash(sha: string | null | undefined): string {
  return sha ? `${sha.slice(0, 10)}…` : "—";
}
