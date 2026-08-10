import { useRef, useState } from "react";
import { toast } from "sonner";
import { Download, Loader2 } from "lucide-react";
import { downloadContractorInvoicePdf } from "@/lib/contractorInvoices";

// Renders + downloads a contractor-invoice PDF on demand. The PDF is generated
// by the generate-contractor-invoice-pdf Edge Function (caller-session scoped)
// and streamed back inline, so there is no stored path to poll — the button is
// shown as soon as the invoice is submitted/approved/paid.
export function ContractorInvoicePdfButton({
  invoiceId,
  invoiceNumber,
}: {
  invoiceId: string;
  invoiceNumber: string;
}) {
  const [loading, setLoading] = useState(false);
  const inFlightRef = useRef(false);

  const download = async () => {
    if (inFlightRef.current) return; // synchronous double-click guard
    inFlightRef.current = true;
    setLoading(true);
    try {
      await downloadContractorInvoicePdf(invoiceId, invoiceNumber);
    } catch (e) {
      toast.error((e as Error).message || "Could not generate the PDF");
    } finally {
      setLoading(false);
      inFlightRef.current = false;
    }
  };

  return (
    <button
      type="button"
      onClick={() => void download()}
      disabled={loading}
      className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium text-brand-navy hover:bg-slate-50 disabled:opacity-60"
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
      {loading ? "Preparing…" : "Download PDF"}
    </button>
  );
}
