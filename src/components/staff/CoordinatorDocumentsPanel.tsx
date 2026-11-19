import { useState, type FormEvent } from "react";
import { Download, Eye, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { errorText, primaryButton, selectClass } from "@/components/staff/StaffShell";
import { UploadedByBadge } from "@/components/documents/DocumentBadges";
import { DOCUMENT_CATEGORIES, DOCUMENT_TYPES, docTypeLabel, formatFileSize, isPeriodScoped, type DocumentType } from "@/lib/documents";
import {
  DOC_MIME, MAX_DOC_BYTES, openCoordinatorDocument, useCoordinatorDocuments, useCoordinatorUpload,
  type CoordDocument, type CoordEntity,
} from "@/hooks/useCoordinatorDocuments";

// The Sales Coordinator's Documents panel on a submission (owner decision 19 Nov 2026). Upload any client document,
// bank statements included; open (logged). No delete and no verification: those stay with the Director.
const inputClass = "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm";

function monthBounds(month: string): { start: string; end: string } | null {
  if (!/^\d{4}-\d{2}$/.test(month)) return null;
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${month}-01`, end: `${month}-${String(last).padStart(2, "0")}` };
}

function periodText(d: CoordDocument): string {
  if (!d.period_start) return "";
  const s = new Date(`${d.period_start}T00:00:00`);
  return ` · ${s.toLocaleDateString("en-ZA", { month: "short", year: "numeric" })}`;
}

export function CoordinatorDocumentsPanel({ leadId }: { leadId: string }) {
  const [open, setOpen] = useState(false);
  const entity: CoordEntity = { kind: "lead", id: leadId };
  const docs = useCoordinatorDocuments(open ? entity : null);
  const upload = useCoordinatorUpload();
  const [type, setType] = useState<DocumentType | "">("");
  const [month, setMonth] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const periodic = type !== "" && isPeriodScoped(type);

  const pickFile = (f: File | null) => {
    if (!f) return setFile(null);
    if (!(DOC_MIME as readonly string[]).includes(f.type)) { toast.error(`${f.name}: only PDF, JPG or PNG files can be uploaded. Save it as a PDF and try again.`); return; }
    if (f.size > MAX_DOC_BYTES) { toast.error(`${f.name} is larger than 20 MB`); return; }
    setFile(f);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!type) return toast.error("Choose the document type");
    if (!file) return toast.error("Attach the file");
    const period = periodic ? monthBounds(month) : null;
    if (periodic && !period) return toast.error("Choose the month this document covers");
    try {
      await upload.mutateAsync({ entity, file, documentType: type, periodStart: period?.start ?? null, periodEnd: period?.end ?? null, notes: note.trim() || null });
      toast.success(`${docTypeLabel(type)} uploaded`);
      setFile(null); setNote(""); setMonth("");
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  const openDoc = async (d: CoordDocument, purpose: "view" | "download") => {
    setBusy(`${d.id}-${purpose}`);
    try { await openCoordinatorDocument(d.id, purpose, d.filename); }
    catch (err) { toast.error(errorText(err)); }
    finally { setBusy(null); }
  };

  return (
    <details className="rounded-lg border border-border bg-slate-50/60 px-3 py-2" onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer text-xs font-semibold text-brand-navy">Documents</summary>
      <div className="mt-2 space-y-3">
        {docs.isLoading ? <p className="text-xs text-muted-foreground">Loading documents…</p> : null}
        {docs.error ? <p role="alert" className="text-xs text-red-600">{errorText(docs.error)}</p> : null}
        {docs.data && docs.data.length === 0 ? <p className="text-xs text-muted-foreground">No documents uploaded yet.</p> : null}
        {docs.data && docs.data.length > 0 ? (
          <ul className="divide-y divide-border rounded-md border border-border bg-white">
            {docs.data.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-2 py-1.5 text-xs">
                <span className="min-w-0">
                  <span className="font-semibold text-brand-navy">{docTypeLabel(d.document_type)}</span>{periodText(d)}
                  {!d.is_current_version ? <span className="ml-1 text-muted-foreground">(older version)</span> : null}
                  <span className="block truncate text-muted-foreground">
                    {d.filename} · {formatFileSize(d.file_size_bytes)} · {d.uploaded_by_name ?? "—"} · {new Date(d.created_at).toLocaleDateString("en-ZA")}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <UploadedByBadge source={d.upload_source} />
                  <button type="button" className="inline-flex items-center gap-1 font-semibold text-brand-teal hover:underline disabled:opacity-50" disabled={busy !== null} onClick={() => void openDoc(d, "view")}>
                    {busy === `${d.id}-view` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Eye className="h-3 w-3" />} Open
                  </button>
                  <button type="button" className="inline-flex items-center gap-1 font-semibold text-brand-teal hover:underline disabled:opacity-50" disabled={busy !== null} onClick={() => void openDoc(d, "download")}>
                    {busy === `${d.id}-download` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />} Download
                  </button>
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        <form onSubmit={submit} className="grid gap-2 sm:grid-cols-2">
          <label className="text-xs font-semibold text-brand-navy">Document type
            <select className={selectClass} value={type} onChange={(e) => setType(e.target.value as DocumentType)} aria-label="Document type">
              <option value="">Choose…</option>
              {DOCUMENT_CATEGORIES.map((c) => {
                const types = DOCUMENT_TYPES.filter((t) => t.category === c.value);
                return types.length ? (
                  <optgroup key={c.value} label={c.label}>
                    {types.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </optgroup>
                ) : null;
              })}
            </select>
          </label>
          {periodic ? (
            <label className="text-xs font-semibold text-brand-navy">Month it covers
              <input type="month" className={inputClass} value={month} onChange={(e) => setMonth(e.target.value)} required />
            </label>
          ) : <span />}
          <label className="text-xs font-semibold text-brand-navy sm:col-span-2">File (PDF, JPG or PNG, up to 20 MB; put several pages in one PDF)
            <input type="file" accept="application/pdf,image/jpeg,image/png" className="block w-full text-xs" onChange={(e) => { pickFile(e.target.files?.[0] ?? null); e.target.value = ""; }} />
            {file ? <span className="mt-1 block font-normal text-muted-foreground">{file.name} · {formatFileSize(file.size)}</span> : null}
          </label>
          <label className="text-xs font-semibold text-brand-navy sm:col-span-2">Note (optional)
            <input className={inputClass} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="No ID or account numbers" />
          </label>
          <button type="submit" className={`${primaryButton} gap-2 sm:col-span-2`} disabled={upload.isPending || !file || !type}>
            {upload.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {!file ? "Attach the file first" : "Upload document"}
          </button>
        </form>
      </div>
    </details>
  );
}
