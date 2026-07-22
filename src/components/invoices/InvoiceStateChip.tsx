import { Badge } from "@/components/ui/badge";
import { INVOICE_STATE_META, type InvoiceState } from "@/lib/invoices";

// Consistent invoice-state chip used in the table, deal section, and detail page.
export function InvoiceStateChip({ state }: { state: InvoiceState }) {
  const meta = INVOICE_STATE_META[state];
  return <Badge className={"ring-1 ring-inset " + (meta?.badge ?? "")}>{meta?.label ?? state}</Badge>;
}
