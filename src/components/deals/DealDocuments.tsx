import { AlertTriangle } from "lucide-react";
import { Link } from "react-router-dom";
import { useClientDocuments, openDocument } from "@/hooks/useClientDocuments";
import { DocumentList } from "@/components/documents/DocumentList";
import { docTypeLabel, expiryStatus, formatDocDate } from "@/lib/documents";

// Deal detail shows the linked CLIENT's documents, READ-ONLY, with expiry
// warnings surfaced. Deal-side attachment (documents pinned to the deal itself)
// is Phase E3 — B3.1 only reads.
export function DealDocuments({ clientId }: { clientId: string | null }) {
  const { data: docs, isLoading } = useClientDocuments(clientId ?? undefined);

  const current = (docs ?? []).filter((d) => d.is_current_version);
  const expiring = current.filter((d) => {
    const s = expiryStatus(d.expiry_date);
    return s === "expired" || s === "urgent" || s === "soon";
  });

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-brand-navy">Client documents</h3>
        {clientId && (
          <Link
            to={`/clients/${clientId}`}
            className="text-xs font-medium text-brand-teal hover:underline"
          >
            Manage on client →
          </Link>
        )}
      </div>

      {expiring.length > 0 && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-amber-800">
            <AlertTriangle className="h-4 w-4" />
            {expiring.length} document{expiring.length === 1 ? "" : "s"} need attention
          </div>
          <ul className="mt-1 space-y-0.5 text-xs text-amber-800">
            {expiring.map((d) => (
              <li key={d.id}>
                {docTypeLabel(d.document_type)} —{" "}
                {expiryStatus(d.expiry_date) === "expired" ? "expired" : "expires"}{" "}
                {formatDocDate(d.expiry_date)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : docs && docs.length > 0 ? (
        <DocumentList docs={docs} onDownload={(d) => openDocument(d.storage_path)} />
      ) : (
        <p className="text-sm text-muted-foreground">
          No documents on the linked client yet.
        </p>
      )}
    </div>
  );
}
