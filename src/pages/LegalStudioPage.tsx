import { useMemo, useState } from "react";
import {
  CheckCircle2,
  Clock,
  Eye,
  FilePlus2,
  FileText,
  Loader2,
  Radio,
  ShieldAlert,
  Undo2,
  UploadCloud,
} from "lucide-react";
import { toast } from "sonner";
import {
  useCreateTemplate,
  useCreateVersion,
  useIngestSourceAsset,
  useLegalSourceAssets,
  useLegalTemplates,
  useLegalTemplateVersions,
  usePublishVersion,
  useSubmitVersionForReview,
  useSupersedeVersion,
} from "@/hooks/useLegalStudio";
import {
  LEGAL_DOCUMENT_ROLE_LABEL,
  LEGAL_DOCUMENT_ROLES,
  LEGAL_DOCUMENT_TYPE_LABEL,
  LEGAL_DOCUMENT_TYPES,
  LEGAL_TEMPLATE_STATUS_LABEL,
  shortHash,
  type LegalDocumentRole,
  type LegalDocumentType,
  type LegalSourceAsset,
  type LegalTemplate,
  type LegalTemplateStatus,
  type LegalTemplateVersion,
} from "@/lib/legalTemplates";

const inputClass =
  "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:border-brand-teal focus:ring-2 focus:ring-brand-teal/20";

const DEFAULT_ENTITY = "Fund Now Capital (Pty) Ltd";

function statusPillClass(status: LegalTemplateStatus): string {
  switch (status) {
    case "published":
      return "bg-green-50 text-green-700";
    case "legal_review":
      return "bg-blue-50 text-blue-700";
    case "draft":
      return "bg-slate-100 text-slate-600";
    case "draft_blocked":
      return "bg-amber-50 text-amber-700";
    case "superseded":
      return "bg-slate-100 text-slate-400";
    default:
      return "bg-slate-100 text-slate-600";
  }
}

function StatusPill({ status }: { status: LegalTemplateStatus }) {
  return (
    <span className={`rounded-full px-2 py-1 text-xs font-medium ${statusPillClass(status)}`}>
      {LEGAL_TEMPLATE_STATUS_LABEL[status]}
    </span>
  );
}

function sourceAssetPill(asset: LegalSourceAsset) {
  if (asset.status === "verified") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-1 text-xs font-medium text-green-700">
        <CheckCircle2 className="h-3.5 w-3.5" /> Verified
      </span>
    );
  }
  if (asset.status === "mismatch") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-1 text-xs font-medium text-red-700">
        <ShieldAlert className="h-3.5 w-3.5" /> Hash mismatch
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-500">
      <Clock className="h-3.5 w-3.5" /> Awaiting upload
    </span>
  );
}

type TemplateForm = {
  documentType: LegalDocumentType;
  role: LegalDocumentRole;
  legalEntity: string;
  title: string;
  jurisdiction: string;
  description: string;
};

function emptyTemplateForm(): TemplateForm {
  return {
    documentType: "nda",
    role: "partner",
    legalEntity: DEFAULT_ENTITY,
    title: "",
    jurisdiction: "ZA",
    description: "",
  };
}

type VersionForm = {
  templateId: string;
  version: string;
  effectiveDate: string;
  contentMarkdown: string;
};

export default function LegalStudioPage() {
  const templates = useLegalTemplates();
  const versions = useLegalTemplateVersions();
  const sourceAssets = useLegalSourceAssets();

  const createTemplate = useCreateTemplate();
  const createVersion = useCreateVersion();
  const submitForReview = useSubmitVersionForReview();
  const publish = usePublishVersion();
  const supersede = useSupersedeVersion();
  const ingest = useIngestSourceAsset();

  const [templateForm, setTemplateForm] = useState<TemplateForm | null>(null);
  const [versionForm, setVersionForm] = useState<VersionForm | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preview, setPreview] = useState<LegalTemplateVersion | null>(null);
  const [verifyForm, setVerifyForm] = useState<{ asset: LegalSourceAsset; storagePath: string } | null>(null);

  // Group versions by template for quick lookup + current-version resolution.
  const versionsByTemplate = useMemo(() => {
    const map = new Map<string, LegalTemplateVersion[]>();
    for (const v of versions.data ?? []) {
      const list = map.get(v.template_id) ?? [];
      list.push(v);
      map.set(v.template_id, list);
    }
    return map;
  }, [versions.data]);

  const selectedTemplate: LegalTemplate | null =
    (templates.data ?? []).find((t) => t.id === selectedId) ?? null;
  const selectedVersions = selectedId ? versionsByTemplate.get(selectedId) ?? [] : [];

  const currentStatus = (templateId: string): LegalTemplateVersion | null => {
    const list = versionsByTemplate.get(templateId) ?? [];
    return list.find((v) => v.is_current) ?? list[0] ?? null;
  };

  const submitTemplate = async () => {
    if (!templateForm) return;
    try {
      const created = await createTemplate.mutateAsync({
        documentType: templateForm.documentType,
        role: templateForm.role,
        legalEntity: templateForm.legalEntity,
        title: templateForm.title,
        jurisdiction: templateForm.jurisdiction,
        description: templateForm.description.trim() || null,
      });
      toast.success(`Template “${created.title}” created`);
      setTemplateForm(null);
      setSelectedId(created.id);
    } catch (error) {
      toast.error((error as Error).message || "Could not create the template");
    }
  };

  const submitVersion = async () => {
    if (!versionForm) return;
    try {
      const created = await createVersion.mutateAsync({
        templateId: versionForm.templateId,
        version: versionForm.version,
        contentMarkdown: versionForm.contentMarkdown.trim() || null,
        effectiveDate: versionForm.effectiveDate || null,
      });
      toast.success(
        created.status === "draft_blocked"
          ? `Version ${created.version} registered (blocked — no wording attached yet)`
          : `Version ${created.version} drafted`,
      );
      setVersionForm(null);
    } catch (error) {
      toast.error((error as Error).message || "Could not create the version");
    }
  };

  const runVerify = async () => {
    if (!verifyForm) return;
    try {
      const res = await ingest.mutateAsync({
        sourceKey: verifyForm.asset.source_key,
        storagePath: verifyForm.storagePath,
      });
      if (res.status === "verified") {
        toast.success(`${verifyForm.asset.source_key} verified — hash matches the approved digest`);
      } else if (res.status === "mismatch") {
        toast.error(`${verifyForm.asset.source_key}: hash MISMATCH — the uploaded file does not match the approved digest. Publication stays blocked.`);
      } else {
        toast.message(`${verifyForm.asset.source_key}: ${res.status}`);
      }
      setVerifyForm(null);
    } catch (error) {
      toast.error((error as Error).message || "Could not verify the uploaded PDF");
    }
  };

  const runSubmitForReview = async (v: LegalTemplateVersion) => {
    try {
      await submitForReview.mutateAsync(v.id);
      toast.success(`Version ${v.version} sent to legal review`);
    } catch (error) {
      toast.error((error as Error).message || "Could not send to review");
    }
  };

  const runPublish = async (v: LegalTemplateVersion) => {
    if (!window.confirm(`Publish version ${v.version}? It becomes the live copy and supersedes the current one.`)) return;
    try {
      await publish.mutateAsync(v.id);
      toast.success(`Version ${v.version} is now live`);
    } catch (error) {
      toast.error((error as Error).message || "Could not publish this version");
    }
  };

  const runSupersede = async (v: LegalTemplateVersion) => {
    if (!window.confirm(`Withdraw the live version ${v.version}? The template will have no current published version.`)) return;
    try {
      await supersede.mutateAsync(v.id);
      toast.success(`Version ${v.version} withdrawn`);
    } catch (error) {
      toast.error((error as Error).message || "Could not withdraw this version");
    }
  };

  const busy = submitForReview.isPending || publish.isPending || supersede.isPending;

  return (
    <div className="max-w-6xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-brand-navy">Document Studio</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Draft, review and publish the version-controlled legal templates. Published versions are immutable —
            an amendment is always a new version. Legal wording is authored and reviewed outside the CRM; the Studio
            never generates contract text.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setTemplateForm(emptyTemplateForm())}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-teal px-4 py-2 text-sm font-semibold text-white hover:bg-brand-teal/90"
        >
          <FilePlus2 className="h-4 w-4" /> New template
        </button>
      </div>

      {/* Source-asset provenance strip (read-only) --------------------------- */}
      <section className="rounded-xl border border-border bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-brand-navy">Approved source documents</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          The owner-approved source PDFs. A version can only be published from approved wording; each source is
          hash-verified on upload.
        </p>
        {sourceAssets.isLoading && <p className="mt-3 text-sm text-muted-foreground">Loading source assets…</p>}
        {!sourceAssets.isLoading && (
          <div className="mt-3 flex flex-wrap gap-2">
            {(sourceAssets.data ?? []).map((asset) => (
              <div key={asset.id} className="flex items-center gap-2 rounded-lg border border-border/70 px-3 py-2">
                <FileText className="h-4 w-4 text-brand-navy/60" />
                <div className="leading-tight">
                  <div className="text-xs font-medium text-brand-navy">{asset.source_key}</div>
                  <div className="text-[11px] text-muted-foreground">{shortHash(asset.expected_sha256)}</div>
                </div>
                {sourceAssetPill(asset)}
                {asset.status !== "verified" && (
                  <button
                    type="button"
                    title="Verify an uploaded PDF against this approved hash"
                    onClick={() => setVerifyForm({ asset, storagePath: `${asset.source_key}.pdf` })}
                    className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[11px] font-semibold text-brand-navy hover:bg-slate-50"
                  >
                    <UploadCloud className="h-3.5 w-3.5" /> Verify
                  </button>
                )}
              </div>
            ))}
            {(sourceAssets.data ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">No source assets registered yet.</p>
            )}
          </div>
        )}
      </section>

      {/* Templates table ---------------------------------------------------- */}
      {templates.isLoading && <p className="text-sm text-muted-foreground">Loading templates…</p>}
      {templates.isError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Could not load templates.{" "}
          <button className="font-semibold underline" onClick={() => void templates.refetch()}>Retry</button>
        </div>
      )}
      {!templates.isLoading && !templates.isError && (
        <div className="overflow-x-auto rounded-xl border border-border bg-white shadow-sm">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Template</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Current status</th>
                <th className="px-4 py-3 text-right">Versions</th>
              </tr>
            </thead>
            <tbody>
              {(templates.data ?? []).map((t) => {
                const cur = currentStatus(t.id);
                const count = (versionsByTemplate.get(t.id) ?? []).length;
                return (
                  <tr
                    key={t.id}
                    onClick={() => setSelectedId(t.id === selectedId ? null : t.id)}
                    className={`cursor-pointer border-b border-border/60 last:border-0 hover:bg-slate-50 ${t.id === selectedId ? "bg-slate-50" : ""}`}
                  >
                    <td className="px-4 py-3">
                      <div className="font-semibold text-brand-navy">{t.title}</div>
                      <div className="text-xs text-muted-foreground">{t.legal_entity} · {t.jurisdiction}</div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{LEGAL_DOCUMENT_ROLE_LABEL[t.role]}</td>
                    <td className="px-4 py-3 text-muted-foreground">{LEGAL_DOCUMENT_TYPE_LABEL[t.document_type]}</td>
                    <td className="px-4 py-3">{cur ? <StatusPill status={cur.status} /> : <span className="text-xs text-muted-foreground">No versions</span>}</td>
                    <td className="px-4 py-3 text-right text-muted-foreground">{count}</td>
                  </tr>
                );
              })}
              {(templates.data ?? []).length === 0 && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">No templates yet. Create the first one to begin.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Selected template — versions panel --------------------------------- */}
      {selectedTemplate && (
        <section className="rounded-xl border border-border bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-brand-navy">{selectedTemplate.title}</h2>
              <p className="text-xs text-muted-foreground">
                {LEGAL_DOCUMENT_ROLE_LABEL[selectedTemplate.role]} · {LEGAL_DOCUMENT_TYPE_LABEL[selectedTemplate.document_type]}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setVersionForm({ templateId: selectedTemplate.id, version: "", effectiveDate: new Date().toISOString().slice(0, 10), contentMarkdown: "" })}
              className="inline-flex items-center gap-2 rounded-lg border border-brand-teal px-3 py-2 text-sm font-semibold text-brand-navy hover:bg-brand-teal/5"
            >
              <FilePlus2 className="h-4 w-4" /> New version
            </button>
          </div>

          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Version</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Effective</th>
                  <th className="px-3 py-2">Content hash</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {selectedVersions.map((v) => (
                  <tr key={v.id} className="border-b border-border/60 last:border-0">
                    <td className="px-3 py-2 font-semibold text-brand-navy">
                      v{v.version}{v.is_current && <span className="ml-2 text-[11px] font-medium text-green-700">LIVE</span>}
                    </td>
                    <td className="px-3 py-2"><StatusPill status={v.status} /></td>
                    <td className="px-3 py-2 text-muted-foreground">{v.effective_date ?? "—"}</td>
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{shortHash(v.content_sha256)}</td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-2">
                        <button title="Preview wording" onClick={() => setPreview(v)} className="rounded-lg border border-border p-2 text-brand-navy hover:bg-slate-50"><Eye className="h-4 w-4" /></button>
                        {v.status === "draft" && (
                          <button title="Send to legal review" disabled={busy} onClick={() => void runSubmitForReview(v)} className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-brand-navy hover:bg-slate-50 disabled:opacity-60">To review</button>
                        )}
                        {(v.status === "draft" || v.status === "legal_review") && (
                          <button title="Publish" disabled={busy} onClick={() => void runPublish(v)} className="inline-flex items-center gap-1 rounded-lg bg-brand-teal px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"><Radio className="h-3.5 w-3.5" /> Publish</button>
                        )}
                        {v.status === "published" && v.is_current && (
                          <button title="Withdraw the live version" disabled={busy} onClick={() => void runSupersede(v)} className="inline-flex items-center gap-1 rounded-lg border border-amber-300 px-3 py-2 text-xs font-semibold text-amber-700 hover:bg-amber-50 disabled:opacity-60"><Undo2 className="h-3.5 w-3.5" /> Withdraw</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {selectedVersions.length === 0 && (
                  <tr><td colSpan={5} className="px-3 py-6 text-center text-sm text-muted-foreground">No versions yet. Create the first version to attach wording.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Create-template modal ---------------------------------------------- */}
      {templateForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="New template">
          <div className="max-h-[92vh] w-full max-w-2xl space-y-4 overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-brand-navy">New legal template</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm font-medium text-brand-navy">Document type
                <select className={inputClass + " mt-1"} value={templateForm.documentType} onChange={(e) => setTemplateForm({ ...templateForm, documentType: e.target.value as LegalDocumentType })}>
                  {LEGAL_DOCUMENT_TYPES.map((t) => <option key={t} value={t}>{LEGAL_DOCUMENT_TYPE_LABEL[t]}</option>)}
                </select>
              </label>
              <label className="text-sm font-medium text-brand-navy">Agreement role
                <select className={inputClass + " mt-1"} value={templateForm.role} onChange={(e) => setTemplateForm({ ...templateForm, role: e.target.value as LegalDocumentRole })}>
                  {LEGAL_DOCUMENT_ROLES.map((r) => <option key={r} value={r}>{LEGAL_DOCUMENT_ROLE_LABEL[r]}</option>)}
                </select>
              </label>
              <label className="text-sm font-medium text-brand-navy">Legal entity
                <input className={inputClass + " mt-1"} value={templateForm.legalEntity} onChange={(e) => setTemplateForm({ ...templateForm, legalEntity: e.target.value })} />
              </label>
              <label className="text-sm font-medium text-brand-navy">Jurisdiction
                <input className={inputClass + " mt-1"} value={templateForm.jurisdiction} onChange={(e) => setTemplateForm({ ...templateForm, jurisdiction: e.target.value })} placeholder="ZA" />
              </label>
            </div>
            <label className="block text-sm font-medium text-brand-navy">Title
              <input className={inputClass + " mt-1"} value={templateForm.title} onChange={(e) => setTemplateForm({ ...templateForm, title: e.target.value })} placeholder="e.g. Bright Destiny Referral Partner Agreement" />
            </label>
            <label className="block text-sm font-medium text-brand-navy">Description (optional)
              <input className={inputClass + " mt-1"} value={templateForm.description} onChange={(e) => setTemplateForm({ ...templateForm, description: e.target.value })} />
            </label>
            <div className="flex justify-end gap-2">
              <button className="rounded-lg border border-border px-4 py-2 text-sm font-medium" onClick={() => setTemplateForm(null)}>Cancel</button>
              <button disabled={createTemplate.isPending || !templateForm.title.trim() || !templateForm.legalEntity.trim()} className="inline-flex items-center gap-2 rounded-lg bg-brand-teal px-4 py-2 text-sm font-semibold text-white disabled:opacity-60" onClick={() => void submitTemplate()}>
                {createTemplate.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Create template
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create-version modal ----------------------------------------------- */}
      {versionForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="New version">
          <div className="max-h-[92vh] w-full max-w-4xl space-y-4 overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-brand-navy">New version</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm font-medium text-brand-navy">Version label
                <input className={inputClass + " mt-1"} value={versionForm.version} onChange={(e) => setVersionForm({ ...versionForm, version: e.target.value })} placeholder="1.0" />
              </label>
              <label className="text-sm font-medium text-brand-navy">Effective date (optional)
                <input type="date" className={inputClass + " mt-1"} value={versionForm.effectiveDate} onChange={(e) => setVersionForm({ ...versionForm, effectiveDate: e.target.value })} />
              </label>
            </div>
            <label className="block text-sm font-medium text-brand-navy">Approved wording (markdown)
              <textarea className={inputClass + " mt-1 min-h-[300px] font-mono"} value={versionForm.contentMarkdown} onChange={(e) => setVersionForm({ ...versionForm, contentMarkdown: e.target.value })} placeholder="Paste the owner-approved wording. Leave empty to register the version as blocked until wording is approved." />
            </label>
            <p className="text-xs text-muted-foreground">
              Legal wording must be reviewed outside the CRM. An empty version is registered as “blocked” (no wording) rather than fabricated.
              Publishing is a separate confirmed step.
            </p>
            <div className="flex justify-end gap-2">
              <button className="rounded-lg border border-border px-4 py-2 text-sm font-medium" onClick={() => setVersionForm(null)}>Cancel</button>
              <button disabled={createVersion.isPending || !versionForm.version.trim()} className="inline-flex items-center gap-2 rounded-lg bg-brand-teal px-4 py-2 text-sm font-semibold text-white disabled:opacity-60" onClick={() => void submitVersion()}>
                {createVersion.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Create version
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Preview modal ------------------------------------------------------- */}
      {preview && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label="Version preview">
          <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-brand-navy">v{preview.version} — {LEGAL_TEMPLATE_STATUS_LABEL[preview.status]}</h2>
              <button className="rounded-lg border border-border px-3 py-1.5 text-sm" onClick={() => setPreview(null)}>Close</button>
            </div>
            {preview.content_markdown ? (
              <pre className="whitespace-pre-wrap rounded-lg bg-slate-50 p-4 text-sm text-brand-navy">{preview.content_markdown}</pre>
            ) : (
              <p className="text-sm text-muted-foreground">
                No wording is attached to this version{preview.source_filename ? ` (source file: ${preview.source_filename})` : ""}.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Verify-upload modal ------------------------------------------------- */}
      {verifyForm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Verify uploaded PDF">
          <div className="w-full max-w-lg space-y-4 rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-brand-navy">Verify uploaded PDF</h2>
            <p className="text-xs text-muted-foreground">
              Confirm the file you uploaded to the private <span className="font-mono">legal-source-approved</span> bucket for
              <span className="font-semibold"> {verifyForm.asset.source_key}</span>. Its SHA-256 is computed server-side and
              checked against the approved digest — a mismatch is recorded and keeps publication blocked.
            </p>
            <label className="block text-sm font-medium text-brand-navy">Storage path (in legal-source-approved)
              <input className={inputClass + " mt-1 font-mono"} value={verifyForm.storagePath} onChange={(e) => setVerifyForm({ ...verifyForm, storagePath: e.target.value })} placeholder="client_nda.pdf" />
            </label>
            <p className="text-[11px] text-muted-foreground">Approved digest: <span className="font-mono">{shortHash(verifyForm.asset.expected_sha256)}</span></p>
            <div className="flex justify-end gap-2">
              <button className="rounded-lg border border-border px-4 py-2 text-sm font-medium" onClick={() => setVerifyForm(null)}>Cancel</button>
              <button disabled={ingest.isPending || !verifyForm.storagePath.trim()} className="inline-flex items-center gap-2 rounded-lg bg-brand-teal px-4 py-2 text-sm font-semibold text-white disabled:opacity-60" onClick={() => void runVerify()}>
                {ingest.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Verify
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
