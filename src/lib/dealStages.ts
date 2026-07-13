// The 15 deal stages, in order (matches the deal_stage enum in the database).
// 'declined' is terminal and reachable from any stage.
export const DEAL_STAGES = [
  { value: "new_lead", label: "New Lead" },
  { value: "qualifying", label: "Qualifying" },
  { value: "document_collection", label: "Document Collection" },
  { value: "deal_review", label: "Deal Review" },
  { value: "submitted", label: "Submitted" },
  { value: "in_credit", label: "In Credit" },
  { value: "approved_quote_received", label: "Approved/Quote Received" },
  { value: "client_deciding", label: "Client Deciding" },
  { value: "verification_kyc", label: "Verification/KYC" },
  { value: "contract_signed", label: "Contract Signed" },
  { value: "advance_pending", label: "Advance Pending" },
  { value: "funded", label: "Funded" },
  { value: "invoiced", label: "Invoiced" },
  { value: "commission_paid", label: "Commission Paid" },
  { value: "declined", label: "Declined" },
] as const;

export type DealStage = (typeof DEAL_STAGES)[number]["value"];

export const STAGE_LABELS: Record<string, string> = Object.fromEntries(
  DEAL_STAGES.map((s) => [s.value, s.label]),
);

export function stageLabel(value: string): string {
  return STAGE_LABELS[value] ?? value;
}

// Terminal stages — a deal here is no longer "in flight".
export const TERMINAL_STAGES: DealStage[] = ["commission_paid", "declined"];

// A deal is counted as funded once it reaches Funded or beyond.
export const FUNDED_STAGES: DealStage[] = ["funded", "invoiced", "commission_paid"];

export function isInFlight(stage: string): boolean {
  return !TERMINAL_STAGES.includes(stage as DealStage);
}
