import { useMemo, useState, type FormEvent } from "react";
import { Camera, Loader2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Field, errorText, primaryButton, selectClass } from "@/components/staff/StaffShell";
import {
  ACCEPTED_MIME, CATEGORY_LABEL, MAX_TOTAL_BYTES, useClientDealsForForms, useFormCatalogue, useLinkOptions, useRegisterScannedForm,
  type CatalogueForm, type LinkKind,
} from "@/hooks/useScannedForms";

// Where the upload is started from decides the link: a client/deal page fixes the client (and deal); a person's
// page fixes the person; the Forms library leaves both open.
export type UploadPreset =
  | { kind: "client"; clientId: string; clientName?: string; dealId?: string | null }
  | { kind: "person"; profileId: string; name?: string }
  | null;

const PERSON_LINKS: LinkKind[] = ["staff", "agent", "person", "field_contractor"];
const inputClass = "flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm";
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" });

function fitsPreset(f: CatalogueForm, preset: UploadPreset): boolean {
  if (!preset) return true;
  if (preset.kind === "client") return f.link_kind === "client";
  return PERSON_LINKS.includes(f.link_kind);
}

export function UploadScannedFormDialog({ preset, onClose }: { preset: UploadPreset; onClose: () => void }) {
  const catalogue = useFormCatalogue();
  const register = useRegisterScannedForm();
  const [search, setSearch] = useState("");
  const [code, setCode] = useState("");
  const [linkSearch, setLinkSearch] = useState("");
  const [clientId, setClientId] = useState<string | null>(preset?.kind === "client" ? preset.clientId : null);
  const [dealId, setDealId] = useState<string | null>(preset?.kind === "client" ? preset.dealId ?? null : null);
  const [subjectId, setSubjectId] = useState<string | null>(preset?.kind === "person" ? preset.profileId : null);
  const [periodDate, setPeriodDate] = useState(today());
  const [signedBy, setSignedBy] = useState("");
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<File[]>([]);

  const forms = useMemo(
    () => (catalogue.data ?? []).filter((f) => f.can_upload && fitsPreset(f, preset)
      && `${f.code} ${f.title}`.toLowerCase().includes(search.trim().toLowerCase())),
    [catalogue.data, preset, search],
  );
  const form = (catalogue.data ?? []).find((f) => f.code === code) ?? null;
  const needsClient = form?.link_kind === "client" && preset?.kind !== "client";
  const needsPerson = form && PERSON_LINKS.includes(form.link_kind) && preset?.kind !== "person";
  const options = useLinkOptions(needsClient || needsPerson ? form!.link_kind : null, linkSearch);
  const deals = useClientDealsForForms(form?.link_kind === "client" ? clientId : null);
  const total = files.reduce((n, f) => n + f.size, 0);

  // Refuse a wrong file type the moment it is picked (a phone's HEIC photo, a Word file), naming the file, instead of
  // only at Upload time.
  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const picked = Array.from(list);
    const ok = picked.filter((f) => (ACCEPTED_MIME as readonly string[]).includes(f.type));
    const bad = picked.filter((f) => !ok.includes(f));
    if (bad.length) toast.error(`${bad.map((f) => f.name).join(", ")}: only PDF, JPG or PNG files can be uploaded. Save it as a PDF and try again.`);
    if (ok.length) setFiles((prev) => [...prev, ...ok]);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form) return toast.error("Choose the form");
    if (form.link_kind === "client" && form.link_required && !clientId) return toast.error("Choose the client");
    if (PERSON_LINKS.includes(form.link_kind) && form.link_required && !subjectId) return toast.error("Choose the person");
    if (!signedBy.trim()) return toast.error("Enter who signed the form");
    if (files.length === 0) return toast.error("Attach the scanned pages");
    if (total > MAX_TOTAL_BYTES) return toast.error("The pages together are larger than 20 MB");
    try {
      await register.mutateAsync({
        formCode: form.code,
        clientId: form.link_kind === "client" ? clientId : null,
        dealId: form.link_kind === "client" ? dealId : null,
        subjectProfileId: PERSON_LINKS.includes(form.link_kind) ? subjectId : null,
        periodDate, signedBy: signedBy.trim(), note: note.trim(), files,
      });
      toast.success(`${form.code} uploaded`);
      onClose();
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  const dateLabel = form?.period_kind === "week" ? "Any day in the week the register covers"
    : form?.period_kind === "month" ? "Any day in the month the register covers"
    : form?.period_kind === "day" ? "Day the register covers" : "Date on the form";

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Upload scanned form">
      <form onSubmit={submit} className="max-h-[92vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-brand-navy">Upload scanned form</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>

        <Field label="Form">
          <input className={inputClass} placeholder="Search by code or title" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search forms" />
          <select className={selectClass} value={code} onChange={(e) => { setCode(e.target.value); setLinkSearch(""); }} size={6} aria-label="Form">
            {forms.map((f) => <option key={f.code} value={f.code}>{f.code} · {f.title} ({CATEGORY_LABEL[f.category]})</option>)}
          </select>
          {catalogue.isLoading ? <span className="text-xs font-normal text-muted-foreground">Loading forms…</span> : null}
          {!catalogue.isLoading && forms.length === 0 ? <span className="text-xs font-normal text-muted-foreground">No form you may upload matches.</span> : null}
        </Field>

        {form && (needsClient || needsPerson) ? (
          <Field label={needsClient ? `Client${form.link_required ? "" : " (optional)"}` : `Person${form.link_required ? "" : " (optional)"}`}>
            <input className={inputClass} placeholder="Search by name" value={linkSearch} onChange={(e) => setLinkSearch(e.target.value)} aria-label="Search" />
            <select className={selectClass} value={(needsClient ? clientId : subjectId) ?? ""} aria-label={needsClient ? "Client" : "Person"}
              onChange={(e) => (needsClient ? (setClientId(e.target.value || null), setDealId(null)) : setSubjectId(e.target.value || null))}>
              <option value="">Choose…</option>
              {(options.data ?? []).map((o) => <option key={o.id} value={o.id}>{o.label}{o.detail ? ` · ${o.detail.replaceAll("_", " ")}` : ""}</option>)}
            </select>
          </Field>
        ) : null}
        {form?.link_kind === "client" && clientId ? (
          <Field label="Deal (optional)">
            <select className={selectClass} value={dealId ?? ""} onChange={(e) => setDealId(e.target.value || null)} aria-label="Deal">
              <option value="">No specific deal</option>
              {(deals.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.reference ?? d.id.slice(0, 8)} · {d.stage.replaceAll("_", " ")}</option>)}
            </select>
          </Field>
        ) : null}
        {preset?.kind === "client" ? <p className="text-xs text-muted-foreground">Linked to {preset.clientName ?? "this client"}.</p> : null}
        {preset?.kind === "person" ? <p className="text-xs text-muted-foreground">Linked to {preset.name ?? "this person"}.</p> : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={dateLabel}>
            <input type="date" className={inputClass} required max={today()} value={periodDate} onChange={(e) => setPeriodDate(e.target.value)} />
          </Field>
          <Field label="Signed by">
            <input className={inputClass} required maxLength={120} value={signedBy} onChange={(e) => setSignedBy(e.target.value)} placeholder="Name on the signature line" />
          </Field>
        </div>
        <Field label="Note (optional)" hint="No ID numbers, bank account numbers or salary details.">
          <textarea className="flex min-h-20 w-full rounded-md border border-input px-3 py-2 text-sm" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>

        <div className="space-y-2">
          <p className="text-sm font-semibold text-brand-navy">Scanned pages</p>
          <div className="flex flex-wrap gap-2">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-semibold text-brand-navy hover:bg-slate-50">
              <Upload className="h-4 w-4" aria-hidden="true" /> Choose files
              <input type="file" className="sr-only" multiple accept="application/pdf,image/jpeg,image/png" onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
            </label>
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-semibold text-brand-navy hover:bg-slate-50">
              <Camera className="h-4 w-4" aria-hidden="true" /> Take photo
              <input type="file" className="sr-only" accept="image/*" capture="environment" onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
            </label>
          </div>
          {files.length === 0 ? (
            <p className="rounded-lg border border-dashed border-amber-400 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              No pages attached yet. Click <strong>Choose files</strong> and pick the scan from this computer (for a file in
              Dropbox or email, download it first; it goes to the Downloads folder).
            </p>
          ) : null}
          <ul className="space-y-1 text-xs">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-2 rounded border border-border px-2 py-1">
                <span className="truncate">Page {i + 1}: {f.name} · {(f.size / 1024 / 1024).toFixed(1)} MB</span>
                <button type="button" className="text-red-600" onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label={`Remove page ${i + 1}`}>Remove</button>
              </li>
            ))}
          </ul>
          <p className={`text-xs ${total > MAX_TOTAL_BYTES ? "text-red-600" : "text-muted-foreground"}`}>
            PDF, JPG or PNG · {(total / 1024 / 1024).toFixed(1)} of 20 MB · pages are kept in the order added.
          </p>
        </div>

        <button type="submit" className={`${primaryButton} w-full gap-2`} disabled={register.isPending || files.length === 0}>
          {register.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          {files.length === 0 ? "Attach the scanned pages first" : `Upload ${files.length} page${files.length === 1 ? "" : "s"}`}
        </button>
      </form>
    </div>
  );
}
