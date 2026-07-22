import { useState } from "react";
import { Download, FileClock } from "lucide-react";
import { toast } from "sonner";
import { getInvoicePdfUrl, type FunderInvoice } from "@/lib/invoices";

// PDF download for an invoice. The signed URL is minted by the owner's own
// authenticated client against the private `invoices` bucket (owner-only RLS) —
// no service-role secret in the browser. Available only once the PDF exists,
// which happens when the invoice is issued (issue → generate-invoice-pdf sets
// pdf_storage_path). For a draft we show a note instead of a dead button.
export function InvoicePdfButton({
  invoice,
  className,
}: {
  invoice: Pick<FunderInvoice, "pdf_storage_path">;
  className?: string;
}) {
  const [loading, setLoading] = useState(false);

  if (!invoice.pdf_storage_path) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <FileClock className="h-4 w-4" /> PDF will be generated when the invoice is issued
      </span>
    );
  }

  const open = async () => {
    setLoading(true);
    try {
      const url = await getInvoicePdfUrl(invoice.pdf_storage_path!);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      toast.error((e as Error).message || "Could not open the PDF");
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={open}
      disabled={loading}
      className={
        "inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium text-brand-navy hover:bg-slate-50 disabled:opacity-60 " +
        (className ?? "")
      }
    >
      <Download className="h-4 w-4" /> {loading ? "Preparing…" : "Download PDF"}
    </button>
  );
}
