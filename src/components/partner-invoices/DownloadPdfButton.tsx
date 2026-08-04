import { useRef, useState } from "react";
import { toast } from "sonner";
import { Download, Loader2 } from "lucide-react";
import { getPartnerInvoicePdfUrl } from "@/lib/partnerInvoices";

// Downloads/opens a rendered partner-invoice PDF via a caller-session signed URL
// (no service-role secret in the browser). When the PDF hasn't rendered yet
// (path null), shows a quiet "PDF is generating" hint instead of a dead button.
export function DownloadPdfButton({ path }: { path: string | null }) {
  const [loading, setLoading] = useState(false);
  const inFlightRef = useRef(false);

  if (!path) {
    return (
      <span className="text-xs text-muted-foreground">
        PDF is generating — it appears here shortly after submission.
      </span>
    );
  }

  const open = async () => {
    if (inFlightRef.current) return; // synchronous double-click guard (FIX #4)
    inFlightRef.current = true;
    setLoading(true);
    try {
      const url = await getPartnerInvoicePdfUrl(path);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      toast.error((e as Error).message || "Could not open the PDF");
    } finally {
      setLoading(false);
      inFlightRef.current = false;
    }
  };

  return (
    <button
      type="button"
      onClick={() => void open()}
      disabled={loading}
      className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium text-brand-navy hover:bg-slate-50 disabled:opacity-60"
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
      Download PDF
    </button>
  );
}
