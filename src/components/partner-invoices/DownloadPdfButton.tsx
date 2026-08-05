import { useRef, useState } from "react";
import { toast } from "sonner";
import { Download, ExternalLink, Loader2 } from "lucide-react";
import { getPartnerInvoicePdfUrl } from "@/lib/partnerInvoices";

// Downloads/opens a rendered partner-invoice PDF via a caller-session signed URL
// (no service-role secret in the browser). When the PDF hasn't rendered yet
// (path null), shows a quiet "PDF is generating" hint instead of a dead button.
export function DownloadPdfButton({ path }: { path: string | null }) {
  const [loading, setLoading] = useState(false);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);
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
    setFallbackUrl(null);
    // Open synchronously from the click so popup blockers can permit it. The
    // signed URL arrives asynchronously and is assigned to this safe blank tab.
    const popup = window.open("about:blank", "_blank");
    try {
      const url = await getPartnerInvoicePdfUrl(path);
      if (popup) {
        popup.opener = null;
        popup.location.href = url;
      } else {
        setFallbackUrl(url);
        toast.error("Your browser blocked the PDF tab. Use the Open PDF link below.");
      }
    } catch (e) {
      popup?.close();
      toast.error((e as Error).message || "Could not open the PDF");
    } finally {
      setLoading(false);
      inFlightRef.current = false;
    }
  };

  return (
    <div className="flex flex-wrap justify-end gap-2">
      <button
        type="button"
        onClick={() => void open()}
        disabled={loading}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium text-brand-navy hover:bg-slate-50 disabled:opacity-60"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
        Download PDF
      </button>
      {fallbackUrl && (
        <a
          href={fallbackUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-teal px-3 py-2 text-sm font-semibold text-white hover:bg-brand-teal/90"
        >
          <ExternalLink className="h-4 w-4" /> Open PDF
        </a>
      )}
    </div>
  );
}
