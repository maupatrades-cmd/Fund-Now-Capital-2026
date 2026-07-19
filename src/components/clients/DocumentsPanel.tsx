import { useMemo, useRef, useState } from "react";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import {
  useEntityDocuments,
  useUploadDocument,
  useDeleteDocument,
  useVerifyDocument,
  openDocument,
  type DocOwner,
} from "@/hooks/useClientDocuments";
import { DocumentList } from "@/components/documents/DocumentList";
import { DocumentsEmptyState } from "@/components/documents/DocumentsEmptyState";
import {
  DOCUMENT_CATEGORIES,
  defaultExpiry,
  isPeriodScoped,
  isPartnerExcluded,
  typesInCategory,
  type DocumentType,
} from "@/lib/documents";

const ctl =
  "rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:border-brand-teal focus:ring-2 focus:ring-brand-teal/20";

export function DocumentsPanel({
  owner,
  referralPartnerId,
}: {
  owner: DocOwner;
  referralPartnerId: string | null;
}) {
  const { data: docs, isLoading } = useEntityDocuments(owner);
  const upload = useUploadDocument();
  const del = useDeleteDocument();
  const verify = useVerifyDocument();
  const fileRef = useRef<HTMLInputElement>(null);

  const [documentType, setDocumentType] = useState<DocumentType>("bank_statement");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [expiryTouched, setExpiryTouched] = useState(false);
  const [tags, setTags] = useState("");
  const [tagFilter, setTagFilter] = useState("");

  const periodScoped = isPeriodScoped(documentType);

  // Keep the expiry input pre-filled with the type's default rule until the
  // owner edits it. The DB applies the same rule server-side if left blank.
  function refreshDefaultExpiry(type: DocumentType, pEnd: string) {
    if (expiryTouched) return;
    const def = defaultExpiry(type, new Date(), pEnd || null);
    setExpiryDate(def ?? "");
  }

  function onTypeChange(next: DocumentType) {
    setDocumentType(next);
    if (!isPeriodScoped(next)) {
      setPeriodStart("");
      setPeriodEnd("");
    }
    setExpiryTouched(false);
    const def = defaultExpiry(next, new Date(), isPeriodScoped(next) ? periodEnd || null : null);
    setExpiryDate(def ?? "");
  }

  const periodMissing = periodScoped && (!periodStart || !periodEnd);
  const periodInverted = Boolean(periodStart && periodEnd && periodStart > periodEnd);
  const canUpload = !upload.isPending && !periodMissing && !periodInverted;

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      await upload.mutateAsync({
        owner,
        referralPartnerId,
        file,
        documentType,
        periodStart: periodScoped ? periodStart : null,
        periodEnd: periodScoped ? periodEnd : null,
        expiryDate: expiryDate || null,
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      });
      toast.success("Document uploaded");
      setTags("");
    } catch (e) {
      toast.error((e as Error).message || "Upload failed");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  // Tag filter (client-side) across the fetched list.
  const filtered = useMemo(() => {
    if (!docs) return [];
    const q = tagFilter.trim().toLowerCase();
    if (!q) return docs;
    return docs.filter((d) => (d.tags ?? []).some((t) => t.toLowerCase().includes(q)));
  }, [docs, tagFilter]);

  return (
    <div className="space-y-4">
      {/* Upload form */}
      <div className="space-y-3 rounded-lg border border-dashed border-border bg-slate-50 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
            Document type
            <select
              className={ctl}
              value={documentType}
              onChange={(e) => onTypeChange(e.target.value as DocumentType)}
            >
              {DOCUMENT_CATEGORIES.map((cat) => (
                <optgroup key={cat.value} label={cat.label}>
                  {typesInCategory(cat.value).map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>

          {periodScoped && (
            <>
              <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
                Period start
                <input
                  type="date"
                  className={ctl}
                  value={periodStart}
                  onChange={(e) => {
                    setPeriodStart(e.target.value);
                    refreshDefaultExpiry(documentType, periodEnd);
                  }}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
                Period end
                <input
                  type="date"
                  className={ctl}
                  value={periodEnd}
                  onChange={(e) => {
                    setPeriodEnd(e.target.value);
                    refreshDefaultExpiry(documentType, e.target.value);
                  }}
                />
              </label>
            </>
          )}

          <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
            Expiry (optional)
            <input
              type="date"
              className={ctl}
              value={expiryDate}
              onChange={(e) => {
                setExpiryTouched(true);
                setExpiryDate(e.target.value);
              }}
            />
          </label>

          <label className="flex flex-1 flex-col gap-1 text-xs font-medium text-muted-foreground">
            Tags (comma-separated)
            <input
              type="text"
              className={ctl}
              placeholder="e.g. 2025, absa"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            onChange={(e) => onFile(e.target.files?.[0])}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={!canUpload}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-teal px-4 py-2 text-sm font-semibold text-white hover:bg-brand-teal/90 disabled:opacity-60"
          >
            <Upload className="h-4 w-4" />
            {upload.isPending ? "Uploading…" : "Upload document"}
          </button>
          <span className="text-xs text-muted-foreground">
            {periodMissing
              ? "Set the statement period first."
              : periodInverted
                ? "Period start must be on or before period end."
                : isPartnerExcluded(documentType)
                  ? "Stored privately — this type is owner-only (partners never see it)."
                  : "Stored privately in the documents bucket."}
          </span>
        </div>
      </div>

      {/* Tag filter */}
      {docs && docs.length > 0 && (
        <div className="flex items-center gap-2">
          <input
            type="search"
            className={`${ctl} w-full max-w-xs`}
            placeholder="Filter by tag…"
            value={tagFilter}
            onChange={(e) => setTagFilter(e.target.value)}
          />
          {tagFilter && (
            <button
              type="button"
              onClick={() => setTagFilter("")}
              className="text-xs font-medium text-brand-teal hover:underline"
            >
              Clear
            </button>
          )}
        </div>
      )}

      {/* List */}
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading documents…</p>
      ) : filtered.length > 0 ? (
        <DocumentList
          docs={filtered}
          onDownload={(d) => openDocument(d.storage_path)}
          onDelete={(d) =>
            del.mutate(
              { id: d.id, storagePath: d.storage_path, owner },
              { onError: (e) => toast.error((e as Error).message || "Delete failed") },
            )
          }
          verifyingId={verify.isPending ? verify.variables?.id : null}
          onVerify={(input) =>
            verify.mutate(
              { ...input, owner },
              {
                onSuccess: () =>
                  toast.success(
                    input.status === "accepted"
                      ? "Document accepted"
                      : input.status === "rejected"
                        ? "Document rejected"
                        : "Verification reset",
                  ),
                onError: (e) => toast.error((e as Error).message || "Could not update verification"),
              },
            )
          }
        />
      ) : docs && docs.length > 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">No documents match that tag.</p>
      ) : (
        <DocumentsEmptyState />
      )}
    </div>
  );
}
