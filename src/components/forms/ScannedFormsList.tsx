import { useState } from "react";
import { Download, Eye, History, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { errorText } from "@/components/staff/StaffShell";
import {
  CATEGORY_LABEL, openScannedPage, periodLabel, useDeleteScannedForm, useFormCatalogue, useFormVersions,
  useReplaceScannedForm, type ScannedForm,
} from "@/hooks/useScannedForms";

// One list of uploads, shared by the Forms library and every "Scanned forms" tab.
export function ScannedFormsList({ forms, isOwner }: { forms: ScannedForm[]; isOwner: boolean }) {
  if (forms.length === 0) return <p className="text-sm text-muted-foreground">No scanned forms yet.</p>;
  return (
    <ul className="divide-y divide-border">
      {forms.map((f) => <FormRow key={f.id} f={f} isOwner={isOwner} />)}
    </ul>
  );
}

function FormRow({ f, isOwner }: { f: ScannedForm; isOwner: boolean }) {
  const catalogue = useFormCatalogue();
  const canReplace = Boolean(catalogue.data?.find((c) => c.code === f.form_code)?.can_upload);
  const replace = useReplaceScannedForm();
  const remove = useDeleteScannedForm();
  const [showHistory, setShowHistory] = useState(false);
  const versions = useFormVersions(showHistory ? f.id : null);
  const open = (fileId: string, purpose: "view" | "download", name: string) =>
    openScannedPage(fileId, purpose, name).catch((e) => toast.error(errorText(e)));

  const doReplace = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    const reason = window.prompt("Why is this scan being replaced? The old version is kept.") ?? "";
    if (!reason.trim()) return;
    replace.mutate({ formId: f.id, formCode: f.form_code, files: Array.from(list), reason },
      { onSuccess: (v) => toast.success(`Version ${v} uploaded`), onError: (e) => toast.error(errorText(e)) });
  };
  const doDelete = () => {
    const reason = window.prompt(`Delete ${f.form_code} for good? Give a reason (it is logged).`) ?? "";
    if (!reason.trim()) return;
    remove.mutate({ formId: f.id, reason }, { onSuccess: () => toast.success("Deleted"), onError: (e) => toast.error(errorText(e)) });
  };

  const linked = [f.client_name, f.deal_reference, f.subject_name].filter(Boolean).join(" · ");
  return (
    <li className="space-y-2 py-3 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-semibold text-brand-navy">
          {f.form_code} · {f.title}
          <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-normal text-slate-700">{CATEGORY_LABEL[f.category]}</span>
          {f.current_version > 1 ? <span className="ml-1 text-xs font-normal text-muted-foreground">v{f.current_version}</span> : null}
        </p>
        <span className="text-xs text-muted-foreground">{periodLabel(f)}</span>
      </div>
      <p className="text-xs text-muted-foreground">
        {linked ? `${linked} · ` : ""}Signed by {f.signed_by} · uploaded by {f.created_by_name ?? "someone"} ({f.created_role.replaceAll("_", " ")}) on {new Date(f.created_at).toLocaleDateString("en-ZA")}
      </p>
      {f.note ? <p className="text-xs text-brand-navy">{f.note}</p> : null}
      <div className="flex flex-wrap gap-2">
        {f.pages.map((p) => (
          <span key={p.id} className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs">
            Page {p.page_no}
            <button type="button" className="text-brand-teal" onClick={() => open(p.id, "view", p.file_name)} aria-label={`View page ${p.page_no}`}><Eye className="h-3.5 w-3.5" /></button>
            <button type="button" className="text-brand-teal" onClick={() => open(p.id, "download", p.file_name)} aria-label={`Download page ${p.page_no}`}><Download className="h-3.5 w-3.5" /></button>
          </span>
        ))}
        <button type="button" className="inline-flex items-center gap-1 text-xs font-semibold text-brand-navy underline" onClick={() => setShowHistory(!showHistory)}>
          <History className="h-3.5 w-3.5" aria-hidden="true" /> {showHistory ? "Hide history" : "History"}
        </button>
        {canReplace ? (
          <label className="inline-flex cursor-pointer items-center gap-1 text-xs font-semibold text-brand-navy underline">
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> {replace.isPending ? "Uploading…" : "Replace"}
            <input type="file" className="sr-only" multiple accept="application/pdf,image/jpeg,image/png" onChange={(e) => { void doReplace(e.target.files); e.target.value = ""; }} />
          </label>
        ) : null}
        {isOwner ? (
          <button type="button" className="inline-flex items-center gap-1 text-xs font-semibold text-red-700 underline" onClick={doDelete} disabled={remove.isPending}>
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Delete
          </button>
        ) : null}
      </div>
      {showHistory ? (
        <ul className="ml-3 space-y-1 border-l border-border pl-3 text-xs">
          {versions.isLoading ? <li className="text-muted-foreground">Loading…</li> : null}
          {(versions.data ?? []).map((v) => (
            <li key={v.file_id} className="flex flex-wrap items-center gap-2">
              <span>v{v.version} page {v.page_no} · {v.uploaded_by_name ?? "someone"} · {new Date(v.uploaded_at).toLocaleString("en-ZA")}</span>
              <button type="button" className="text-brand-teal underline" onClick={() => open(v.file_id, "view", v.file_name)}>View</button>
              <button type="button" className="text-brand-teal underline" onClick={() => open(v.file_id, "download", v.file_name)}>Download</button>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}
