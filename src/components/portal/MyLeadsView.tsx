import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { FileUp, ListChecks, Paperclip, PlusCircle, X } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/ui/empty-state";
import { formatZAR } from "@/lib/format";
import { formatFileSize } from "@/lib/documents";
import {
  MAX_FILE_BYTES,
  useAttachLeadDocuments,
  usePortalLeads,
  leadStatus,
  STATUS_BADGE,
} from "@/hooks/usePortalLeads";
import type { PortalKind } from "@/components/portal/PortalShell";

/*
 * The submitter's own leads (partner or contractor), with a simple 4-state
 * status derived from the owner's qualification stage. A submitter can attach
 * documents after creation to recover from a partial-success upload. RLS
 * guarantees a partner/contractor can act only on their own attributed leads.
 */
export default function MyLeadsView({ portal }: { portal: PortalKind }) {
  const { data, isLoading, isError, error, refetch } = usePortalLeads(portal);
  const attach = useAttachLeadDocuments(portal);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [targetLeadId, setTargetLeadId] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);

  const closeAttach = () => {
    if (attach.isPending) return;
    setTargetLeadId(null);
    setFiles([]);
    setFileError(null);
  };

  const chooseFiles = (incoming: FileList | null) => {
    if (!incoming) return;
    setFileError(null);
    const next = [...files];
    for (const file of Array.from(incoming)) {
      if (file.size > MAX_FILE_BYTES) {
        setFileError(`"${file.name}" is larger than 10MB and was not added.`);
        continue;
      }
      const alreadySelected = next.some(
        (existing) =>
          existing.name === file.name &&
          existing.size === file.size &&
          existing.lastModified === file.lastModified,
      );
      if (!alreadySelected) next.push(file);
    }
    setFiles(next);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const uploadFiles = async () => {
    if (!targetLeadId || files.length === 0 || attach.isPending) return;
    const result = await attach.mutateAsync({ leadId: targetLeadId, files });
    if (result.attachedCount > 0) {
      toast.success(
        result.attachedCount === 1
          ? "1 document attached"
          : `${result.attachedCount} documents attached`,
      );
    }
    if (result.failedCount > 0) {
      // Keep only failed files selected. Retrying must not re-upload files that
      // already succeeded during this batch.
      setFiles(result.failedFiles);
      toast.warning(
        result.failedCount === 1
          ? "1 document could not be attached. Please retry it."
          : `${result.failedCount} documents could not be attached. Please retry them.`,
      );
      return;
    }
    setTargetLeadId(null);
    setFiles([]);
    setFileError(null);
  };

  const submitCta = (
    <Link
      to={`/${portal}/submit-lead`}
      className="inline-flex items-center gap-2 rounded-lg bg-brand-teal px-4 py-2 text-sm font-semibold text-white hover:bg-brand-teal/90"
    >
      <PlusCircle className="h-4 w-4" />
      Submit a new lead
    </Link>
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold text-brand-navy">My leads</h1>
          <p className="text-sm text-muted-foreground">Leads you've submitted and where they stand.</p>
        </div>
        <div className="hidden sm:block">{submitCta}</div>
      </div>

      {isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}

      {isError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Couldn't load your leads: {(error as Error)?.message ?? "unknown error"}.{" "}
          <button type="button" onClick={() => void refetch()} className="font-medium underline">
            Retry
          </button>
        </div>
      )}

      {!isLoading && !isError && (data?.length ?? 0) === 0 && (
        <EmptyState
          icon={ListChecks}
          title="You haven't submitted any leads yet"
          description="When you submit a business that needs funding, it'll show up here with its status."
          action={submitCta}
        />
      )}

      {!isLoading && !isError && (data?.length ?? 0) > 0 && (
        <div className="overflow-x-auto rounded-xl border border-border bg-white shadow-sm">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 font-medium">Business</th>
                <th className="px-4 py-3 font-medium">Contact</th>
                <th className="px-4 py-3 font-medium">Amount</th>
                <th className="px-4 py-3 font-medium">Submitted</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Documents</th>
              </tr>
            </thead>
            <tbody>
              {(data ?? []).map((row) => {
                const status = leadStatus(row.qualification_stage);
                return (
                  <tr key={row.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3 font-medium text-brand-navy">{row.business_name}</td>
                    <td className="px-4 py-3 text-muted-foreground">{row.contact_name}</td>
                    <td className="px-4 py-3 text-brand-navy">
                      {row.funding_amount ? formatZAR(row.funding_amount) : "—"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {new Date(row.created_at).toLocaleDateString("en-ZA", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_BADGE[status]}`}
                      >
                        {status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => {
                          setTargetLeadId(row.id);
                          setFiles([]);
                          setFileError(null);
                        }}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-brand-navy hover:bg-slate-50"
                      >
                        <FileUp className="h-3.5 w-3.5" /> Attach
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {targetLeadId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="attach-documents-title"
        >
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            onClick={closeAttach}
            aria-label="Close attach documents dialog"
          />
          <div className="relative w-full max-w-lg rounded-xl bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="attach-documents-title" className="text-lg font-semibold text-brand-navy">
                  Attach lead documents
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Add paperwork that was missed or failed during submission. Up to 10MB per file.
                </p>
              </div>
              <button
                type="button"
                onClick={closeAttach}
                disabled={attach.isPending}
                className="rounded p-1 text-muted-foreground hover:bg-slate-100"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={attach.isPending}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-slate-50 px-4 py-5 text-sm font-medium text-brand-navy hover:border-brand-teal hover:bg-brand-teal/5 disabled:opacity-50"
            >
              <Paperclip className="h-4 w-4 text-brand-teal" /> Choose files
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(event) => chooseFiles(event.target.files)}
            />
            {fileError && <p className="mt-2 text-xs text-red-600">{fileError}</p>}

            {files.length > 0 && (
              <ul className="mt-3 max-h-48 space-y-2 overflow-y-auto">
                {files.map((file, index) => (
                  <li
                    key={`${file.name}-${file.size}-${file.lastModified}`}
                    className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm"
                  >
                    <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate text-brand-navy">{file.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatFileSize(file.size)}
                    </span>
                    <button
                      type="button"
                      onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}
                      disabled={attach.isPending}
                      className="rounded p-1 text-muted-foreground hover:bg-slate-100 hover:text-red-600"
                      aria-label={`Remove ${file.name}`}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeAttach}
                disabled={attach.isPending}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-brand-navy disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void uploadFiles()}
                disabled={files.length === 0 || attach.isPending}
                className="rounded-lg bg-brand-teal px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {attach.isPending ? "Attaching…" : `Attach${files.length > 0 ? ` (${files.length})` : ""}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
