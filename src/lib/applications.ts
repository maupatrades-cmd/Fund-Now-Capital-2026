// Contractor application shared types + presentation helpers (Sprint 2 Lane 2a).
// Mirrors the live public.contractors table (Stage-1 application subset) and the
// public.contractor_status enum verified against the live schema (2026-08-03).

// The full contractor_status enum. This lane only ever surfaces / transitions
// among applicant / screening / rejected; the rest exist for later HR phases.
export type ContractorStatus =
  | "applicant"
  | "screening"
  | "interview_scheduled"
  | "agreement_pending"
  | "document_collection"
  | "active"
  | "suspended"
  | "deactivated"
  | "rejected";

// A contractor application row as the owner sees it (owner-only RLS).
export type ContractorApplication = {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  id_number: string | null;
  physical_address: string;
  experience_years: number;
  motivation_text: string;
  referral_source: string | null;
  referral_source_other: string | null;
  status: ContractorStatus;
  rejected_reason: string | null;
  screening_notes: string | null;
  submitted_at: string;
  created_at: string;
  updated_at: string;
};

// The Stage-1 application filter tabs (owner's Applications view).
export type ApplicationFilter = "all" | "applicant" | "screening" | "rejected";

// Referral-source dropdown for the public form. `other` reveals a free-text box.
export const REFERRAL_SOURCES: { value: string; label: string }[] = [
  { value: "linkedin", label: "LinkedIn" },
  { value: "word_of_mouth", label: "Word of mouth" },
  { value: "website", label: "Website" },
  { value: "other", label: "Other" },
];

const REFERRAL_LABEL = new Map(REFERRAL_SOURCES.map((r) => [r.value, r.label]));

// Human label for a stored referral_source token (+ optional free text).
export function referralSourceLabel(source: string | null, other: string | null): string {
  if (!source) return "—";
  const base = REFERRAL_LABEL.get(source) ?? source;
  if (source === "other" && other) return `${base} — ${other}`;
  return base;
}

// Short human label for a status (Stage-1 statuses named explicitly; the rest
// fall back to a Title Case of the enum token so later phases render sanely).
export function statusLabel(status: ContractorStatus): string {
  switch (status) {
    case "applicant":
      return "Applicant";
    case "screening":
      return "Screening";
    case "rejected":
      return "Rejected";
    default:
      return status
        .split("_")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
  }
}

// Status badge colours (ring-1 inset pill; matches the Badge component API).
export function statusBadgeClass(status: ContractorStatus): string {
  switch (status) {
    case "applicant":
      return "bg-brand-teal/10 text-brand-teal ring-brand-teal/20";
    case "screening":
      return "bg-amber-100 text-amber-700 ring-amber-200";
    case "rejected":
      return "bg-red-100 text-red-700 ring-red-200";
    case "active":
      return "bg-brand-green/10 text-brand-green ring-brand-green/20";
    default:
      return "bg-slate-100 text-slate-600 ring-slate-200";
  }
}

// Short en-ZA date, e.g. "3 Aug 2026".
export function formatAppliedDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric" });
}

// Payload the public /apply form sends to the apply-submit-application Edge Function.
export type PublicApplicationInput = {
  full_name: string;
  email: string;
  phone: string;
  id_number?: string | null;
  physical_address: string;
  experience_years: number;
  motivation_text: string;
  referral_source?: string | null;
  referral_source_other?: string | null;
};
