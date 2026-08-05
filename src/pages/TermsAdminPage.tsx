import { useState } from "react";
import { Eye, FilePlus2, Loader2, Pencil, Radio } from "lucide-react";
import { toast } from "sonner";
import { TermsMarkdown } from "@/components/terms/TermsMarkdown";
import {
  usePublishTermsVersion,
  useSaveTermsDraft,
  useTermsVersionsAdmin,
} from "@/hooks/useTermsAdmin";
import type { TermsVersion } from "@/lib/terms";

const inputClass =
  "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:border-brand-teal focus:ring-2 focus:ring-brand-teal/20";

type EditorState = {
  id: string | null;
  versionNumber: string;
  effectiveDate: string;
  contentMarkdown: string;
};

function emptyEditor(): EditorState {
  return {
    id: null,
    versionNumber: "",
    effectiveDate: new Date().toISOString().slice(0, 10),
    contentMarkdown: "# Fund Now Capital Platform Terms & Conditions\n\n",
  };
}

export default function TermsAdminPage() {
  const versions = useTermsVersionsAdmin();
  const save = useSaveTermsDraft();
  const publish = usePublishTermsVersion();
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [preview, setPreview] = useState<TermsVersion | EditorState | null>(null);

  const edit = (version: TermsVersion) => {
    setEditor({
      id: version.id,
      versionNumber: version.version_number,
      effectiveDate: version.effective_date,
      contentMarkdown: version.content_markdown,
    });
  };

  const saveDraft = async () => {
    if (!editor) return;
    try {
      await save.mutateAsync(editor);
      toast.success(editor.id ? "Terms draft updated" : "Terms draft created");
      setEditor(null);
    } catch (error) {
      toast.error((error as Error).message || "Could not save the Terms draft");
    }
  };

  const publishVersion = async (version: TermsVersion) => {
    if (!window.confirm(`Publish ${version.version_number} for Doctor and contractors? They will need to accept it.`)) return;
    try {
      await publish.mutateAsync(version.id);
      toast.success(`${version.version_number} is now live`);
    } catch (error) {
      toast.error((error as Error).message || "Could not publish this version");
    }
  };

  return (
    <div className="max-w-6xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-brand-navy">Terms administration</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Draft and publish the platform Terms accepted by Doctor and contractors. Publishing does not alter prior acceptance evidence.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setEditor(emptyEditor())}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-teal px-4 py-2 text-sm font-semibold text-white hover:bg-brand-teal/90"
        >
          <FilePlus2 className="h-4 w-4" /> New draft
        </button>
      </div>

      {versions.isLoading && <p className="text-sm text-muted-foreground">Loading Terms versions…</p>}
      {versions.isError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Could not load Terms versions. <button className="font-semibold underline" onClick={() => void versions.refetch()}>Retry</button>
        </div>
      )}

      {!versions.isLoading && !versions.isError && (
        <div className="overflow-x-auto rounded-xl border border-border bg-white shadow-sm">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr><th className="px-4 py-3">Version</th><th className="px-4 py-3">Effective</th><th className="px-4 py-3">Roles</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Actions</th></tr>
            </thead>
            <tbody>
              {(versions.data ?? []).map((version) => (
                <tr key={version.id} className="border-b border-border/60 last:border-0">
                  <td className="px-4 py-3 font-semibold text-brand-navy">{version.version_number}</td>
                  <td className="px-4 py-3 text-muted-foreground">{version.effective_date}</td>
                  <td className="px-4 py-3 text-muted-foreground">Doctor + Contractor</td>
                  <td className="px-4 py-3"><span className={version.is_current ? "rounded-full bg-green-50 px-2 py-1 text-xs font-medium text-green-700" : "rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600"}>{version.is_current ? "Live" : version.published_at ? "Historical" : "Draft"}</span></td>
                  <td className="px-4 py-3"><div className="flex justify-end gap-2">
                    <button title="Preview" onClick={() => setPreview(version)} className="rounded-lg border border-border p-2 text-brand-navy hover:bg-slate-50"><Eye className="h-4 w-4" /></button>
                    {!version.is_current && !version.published_at && <button title="Edit draft" onClick={() => edit(version)} className="rounded-lg border border-border p-2 text-brand-navy hover:bg-slate-50"><Pencil className="h-4 w-4" /></button>}
                    {!version.is_current && !version.published_at && <button title="Publish" disabled={publish.isPending} onClick={() => void publishVersion(version)} className="inline-flex items-center gap-1 rounded-lg bg-brand-teal px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"><Radio className="h-3.5 w-3.5" /> Publish</button>}
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Terms editor">
          <div className="max-h-[92vh] w-full max-w-4xl space-y-4 overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-brand-navy">{editor.id ? "Edit Terms draft" : "New Terms draft"}</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm font-medium text-brand-navy">Version number<input className={inputClass + " mt-1"} value={editor.versionNumber} onChange={(event) => setEditor({ ...editor, versionNumber: event.target.value })} placeholder="v1.1" /></label>
              <label className="text-sm font-medium text-brand-navy">Effective date<input type="date" className={inputClass + " mt-1"} value={editor.effectiveDate} onChange={(event) => setEditor({ ...editor, effectiveDate: event.target.value })} /></label>
            </div>
            <label className="block text-sm font-medium text-brand-navy">Markdown content<textarea className={inputClass + " mt-1 min-h-[360px] font-mono"} value={editor.contentMarkdown} onChange={(event) => setEditor({ ...editor, contentMarkdown: event.target.value })} /></label>
            <p className="text-xs text-muted-foreground">Legal wording must be reviewed outside the CRM. Saving creates a draft; publishing is a separate confirmed action.</p>
            <div className="flex justify-end gap-2"><button className="rounded-lg border border-border px-4 py-2 text-sm font-medium" onClick={() => setEditor(null)}>Cancel</button><button className="rounded-lg border border-brand-teal px-4 py-2 text-sm font-semibold text-brand-navy" onClick={() => setPreview(editor)}>Preview</button><button disabled={save.isPending || !editor.versionNumber.trim() || editor.contentMarkdown.trim().length < 20} className="inline-flex items-center gap-2 rounded-lg bg-brand-teal px-4 py-2 text-sm font-semibold text-white disabled:opacity-60" onClick={() => void saveDraft()}>{save.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Save draft</button></div>
          </div>
        </div>
      )}

      {preview && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label="Terms preview">
          <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl"><div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-semibold text-brand-navy">Preview</h2><button className="rounded-lg border border-border px-3 py-1.5 text-sm" onClick={() => setPreview(null)}>Close</button></div><TermsMarkdown markdown={"content_markdown" in preview ? preview.content_markdown : preview.contentMarkdown} /></div>
        </div>
      )}
    </div>
  );
}
