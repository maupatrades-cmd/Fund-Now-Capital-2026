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

  const open = () => {
    // Open the tab synchronously inside the click gesture so the browser doesn't
    // treat the later (post-await) open as a popup and block it. We can't pass
    // `noopener` here — that makes window.open return null and we'd lose the
    // handle — so we sever the opener manually instead (same security benefit).
    const win = window.open("about:blank", "_blank");
    if (win) win.opener = null;
    setLoading(true);
    getInvoicePdfUrl(invoice.pdf_storage_path!)
      .then((url) => {
        if (win) win.location.href = url;
        // Popup blocked despite the synchronous open → fall back to same-tab
        // navigation rather than failing silently.
        else window.location.assign(url);
      })
      .catch((e) => {
        if (win) win.close();
        toast.error((e as Error).message || "Could not open the PDF");
      })
      .finally(() => setLoading(false));
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
