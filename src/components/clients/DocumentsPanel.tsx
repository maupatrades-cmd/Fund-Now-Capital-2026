import { useRef, useState } from "react";
import { Upload, Download, Trash2, FileText, Lock } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import {
  useClientDocuments,
  useUploadDocument,
  useDeleteDocument,
  getDocumentUrl,
  type ClientDocument,
} from "@/hooks/useClientDocuments";
import { DOCUMENT_TYPES, docTypeLabel, isBankStatement } from "@/lib/clients";

function formatSize(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DocumentsPanel({
  clientId,
  referralPartnerId,
}: {
  clientId: string;
  referralPartnerId: string | null;
}) {
  const { data: docs, isLoading } = useClientDocuments(clientId);
  const upload = useUploadDocument();
  const del = useDeleteDocument();
  const fileRef = useRef<HTMLInputElement>(null);
  const [docType, setDocType] = useState("bank_statement");

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      await upload.mutateAsync({ clientId, referralPartnerId, file, docType });
      toast.success("Document uploaded");
    } catch (e) {
      toast.error((e as Error).message || "Upload failed");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const onDownload = async (d: ClientDocument) => {
    try {
      const url = await getDocumentUrl(d.storage_path);
      window.open(url, "_blank", "noopener");
    } catch (e) {
      toast.error((e as Error).message || "Couldn't open document");
    }
  };

  return (
    <div className="space-y-4">
      {/* Upload row */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-border bg-slate-50 p-4">
        <select
          value={docType}
          onChange={(e) => setDocType(e.target.value)}
          className="rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:border-brand-teal"
        >
          {DOCUMENT_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          onChange={(e) => onFile(e.target.files?.[0])}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={upload.isPending}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-teal px-4 py-2 text-sm font-semibold text-white hover:bg-brand-teal/90 disabled:opacity-60"
        >
          <Upload className="h-4 w-4" />
          {upload.isPending ? "Uploading…" : "Upload document"}
        </button>
        <span className="text-xs text-muted-foreground">
          Stored privately. Bank statements are owner-only.
        </span>
      </div>

      {/* List */}
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading documents…</p>
      ) : docs && docs.length > 0 ? (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {docs.map((d) => (
            <li key={d.id} className="flex items-center gap-3 p-3">
              <FileText className="h-5 w-5 shrink-0 text-brand-teal" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-medium text-brand-navy">
                    {d.file_name}
                  </span>
                  <Badge className="bg-slate-100 text-slate-600 ring-slate-500/20">
                    {docTypeLabel(d.doc_type)}
                  </Badge>
                  {isBankStatement(d.doc_type) && (
                    <Badge className="bg-amber-100 text-amber-800 ring-amber-600/20">
                      <Lock className="mr-1 h-3 w-3" /> Owner-only
                    </Badge>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  {formatSize(d.file_size_bytes)}
                  {d.file_size_bytes ? " · " : ""}
                  {new Date(d.created_at).toLocaleDateString("en-ZA", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onDownload(d)}
                className="text-muted-foreground hover:text-brand-teal"
                aria-label={`Download ${d.file_name}`}
              >
                <Download className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => del.mutate({ id: d.id, storagePath: d.storage_path, clientId })}
                className="text-muted-foreground hover:text-red-600"
                aria-label={`Delete ${d.file_name}`}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="py-6 text-center text-sm text-muted-foreground">
          No documents uploaded yet.
        </p>
      )}
    </div>
  );
}
