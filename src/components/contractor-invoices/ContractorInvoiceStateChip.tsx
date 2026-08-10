import { CONTRACTOR_INVOICE_STATE_META, type ContractorInvoiceState } from "@/lib/contractorInvoices";

// Small state badge for the contractor invoice surfaces (mirrors
// PartnerInvoiceStateChip).
export function ContractorInvoiceStateChip({ state }: { state: ContractorInvoiceState }) {
  const meta = CONTRACTOR_INVOICE_STATE_META[state];
  return (
    <span
      className={
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset " +
        (meta?.badge ?? "bg-slate-100 text-slate-600 ring-slate-500/20")
      }
    >
      {meta?.label ?? state}
    </span>
  );
}
