// Urgency colour-coding by days in the current stage:
// normal → amber at 5 days → red at 10 days.
export type Urgency = "normal" | "warning" | "urgent";

export const URGENCY_WARNING_DAYS = 5;
export const URGENCY_URGENT_DAYS = 10;

export function stageUrgency(days: number): Urgency {
  if (days >= URGENCY_URGENT_DAYS) return "urgent";
  if (days >= URGENCY_WARNING_DAYS) return "warning";
  return "normal";
}

// Left-border accent on the card + the days badge colour.
export const URGENCY_ACCENT: Record<Urgency, string> = {
  normal: "border-l-slate-200",
  warning: "border-l-amber-400",
  urgent: "border-l-red-500",
};

export const URGENCY_BADGE: Record<Urgency, string> = {
  normal: "bg-slate-100 text-slate-600",
  warning: "bg-amber-100 text-amber-800",
  urgent: "bg-red-100 text-red-700",
};

// Funder submission statuses (deal_funder_submissions.status).
export const SUBMISSION_STATUSES = [
  { value: "submitted", label: "Submitted" },
  { value: "in_credit", label: "In Credit" },
  { value: "approved", label: "Approved" },
  { value: "quote_received", label: "Quote Received" },
  { value: "declined", label: "Declined" },
] as const;

export function submissionStatusLabel(value: string): string {
  return SUBMISSION_STATUSES.find((s) => s.value === value)?.label ?? value;
}

export const SUBMISSION_STATUS_BADGE: Record<string, string> = {
  submitted: "bg-slate-100 text-slate-600 ring-slate-500/20",
  in_credit: "bg-brand-teal/10 text-brand-teal ring-brand-teal/20",
  approved: "bg-green-100 text-green-800 ring-green-600/20",
  quote_received: "bg-amber-100 text-amber-800 ring-amber-600/20",
  declined: "bg-red-100 text-red-700 ring-red-600/20",
};

// Partner-safe generic decline reasons (deal_funder_submissions.decline_reason_category).
// A referring partner may see ONLY this generic category — never the funder's
// real name or the owner-only internal decline notes. Mirrors the
// submission_decline_reason enum; the DB CHECK requires one when status=declined.
export const DECLINE_REASONS = [
  { value: "affordability", label: "Affordability" },
  { value: "documentation_gaps", label: "Documentation gaps" },
  { value: "sector_appetite", label: "Sector appetite" },
  { value: "credit_profile", label: "Credit profile" },
  { value: "security_insufficient", label: "Security insufficient" },
  { value: "funder_criteria_not_met", label: "Funder criteria not met" },
  { value: "other", label: "Other" },
] as const;

export function declineReasonLabel(value: string | null | undefined): string {
  if (!value) return "—";
  return DECLINE_REASONS.find((r) => r.value === value)?.label ?? value;
}
