import { PARTNER_INVOICE_STATE_META, type PartnerInvoiceState } from "@/lib/partnerInvoices";

// Small state badge shared by the partner + owner partner-invoice surfaces.
export function PartnerInvoiceStateChip({ state }: { state: PartnerInvoiceState }) {
  const meta = PARTNER_INVOICE_STATE_META[state];
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
