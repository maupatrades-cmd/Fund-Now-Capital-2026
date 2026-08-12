import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Clock3, Download, FileCheck2, FileUp, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import ClientPortalShell from "@/components/client-portal/ClientPortalShell";
import { docTypeLabel, isPeriodScoped } from "@/lib/documents";
import { supabase } from "@/lib/supabase";

type ChecklistItem = { document_type: string; requirement: "required" | "optional"; reason: string | null };
type PortalDocument = {
  id: string; deal_id: string | null; filename: string; storage_path: string; document_type: string;
  file_size_bytes: number | null; mime_type: string | null; period_start: string | null; period_end: string | null;
  expiry_date: string | null; version_number: number; is_current_version: boolean;
  verification_status: "unverified" | "accepted" | "rejected"; rejection_reason: string | null; created_at: string;
};
type Workspace = {
  client_id: string; deal_id: string | null; stage: string | null; product_name: string | null;
  checklist: ChecklistItem[]; documents: PortalDocument[];
};
type UploadRequest = { item: ChecklistItem; file: File; periodStart: string | null; periodEnd: string | null };

const MAX_FILE_SIZE = 20 * 1024 * 1024;
const ACCEPTED_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

function safeName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(-180);
}

function fileSize(bytes: number | null) {
  if (!bytes) return "";
  return bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function statusMeta(document: PortalDocument | undefined) {
  if (!document) return { label: "Outstanding", className: "border-amber-300/20 bg-amber-400/10 text-amber-100", icon: Clock3 };
  if (document.verification_status === "accepted") return { label: "Approved", className: "border-emerald-300/20 bg-emerald-400/10 text-emerald-100", icon: CheckCircle2 };
  if (document.verification_status === "rejected") return { label: "Needs replacement", className: "border-red-300/20 bg-red-400/10 text-red-100", icon: TriangleAlert };
  return { label: "Under review", className: "border-sky-300/20 bg-sky-400/10 text-sky-100", icon: RefreshCw };
}

function UploadControl({ item, busy, onUpload }: { item: ChecklistItem; busy: boolean; onUpload: (request: UploadRequest) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const periodRequired = isPeriodScoped(item.document_type);

  const chooseFile = (file: File | null) => {
    if (!file) return;
    if (!ACCEPTED_TYPES.has(file.type)) {
      toast.error("Use PDF, JPG, PNG, or WebP only.");
      return;
    }
    if (file.size <= 0 || file.size > MAX_FILE_SIZE) {
      toast.error("The document must be between 1 byte and 20 MB.");
      return;
    }
    setPendingFile(file);
  };
  const canUpload = Boolean(pendingFile && (!periodRequired || (periodStart && periodEnd && periodStart <= periodEnd)) && !busy);

  return (
    <div className="mt-4 rounded-2xl border border-white/8 bg-black/10 p-3">
      <input ref={inputRef} type="file" className="sr-only" accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"
        onChange={(event) => chooseFile(event.target.files?.[0] ?? null)} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <button type="button" onClick={() => inputRef.current?.click()} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-white/12 bg-white/5 px-3 text-xs font-bold text-white/70">
          <FileUp className="h-4 w-4" aria-hidden="true" /> {pendingFile ? "Choose another file" : "Choose file"}
        </button>
        <p className="min-w-0 flex-1 truncate text-xs text-white/45">{pendingFile ? `${pendingFile.name} · ${fileSize(pendingFile.size)}` : "PDF or image, maximum 20 MB"}</p>
      </div>
      {periodRequired ? <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-semibold text-white/60">Period start<input type="date" value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} className="mt-1 min-h-10 w-full rounded-xl border border-white/10 bg-white/5 px-3 text-white" /></label>
        <label className="text-xs font-semibold text-white/60">Period end<input type="date" value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} className="mt-1 min-h-10 w-full rounded-xl border border-white/10 bg-white/5 px-3 text-white" /></label>
      </div> : null}
      {pendingFile ? <button type="button" disabled={!canUpload} onClick={() => onUpload({ item, file: pendingFile, periodStart: periodStart || null, periodEnd: periodEnd || null })}
        className="mt-3 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#6ec144] to-[#2ca8a8] px-4 text-xs font-extrabold text-[#06131d] disabled:opacity-40">
        {busy ? <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ShieldCheck className="h-4 w-4" aria-hidden="true" />} Upload securely
      </button> : null}
    </div>
  );
}

export default function ClientDocumentsPage() {
  const queryClient = useQueryClient();
  const [uploadingType, setUploadingType] = useState<string | null>(null);
  const workspace = useQuery({
    queryKey: ["client-document-workspace"],
    queryFn: async (): Promise<Workspace> => {
      const { data, error } = await supabase.rpc("client_portal_document_workspace");
      if (error) throw error;
      return data as Workspace;
    },
  });

  const upload = useMutation({
    mutationFn: async ({ item, file, periodStart, periodEnd }: UploadRequest) => {
      const current = workspace.data;
      if (!current?.deal_id) throw new Error("Your checklist is still being prepared by Fund Now Capital.");
      const documentId = crypto.randomUUID();
      const storagePath = `clients/${current.client_id}/${documentId}/${safeName(file.name)}`;
      const { error: uploadError } = await supabase.storage.from("documents").upload(storagePath, file, {
        upsert: false, contentType: file.type, cacheControl: "3600",
      });
      if (uploadError) throw uploadError;
      const { data, error: registerError } = await supabase.rpc("register_client_portal_document", {
        p_document_id: documentId, p_deal_id: current.deal_id, p_document_type: item.document_type,
        p_filename: file.name, p_storage_path: storagePath, p_file_size_bytes: file.size,
        p_mime_type: file.type, p_period_start: periodStart, p_period_end: periodEnd,
      });
      if (registerError || data !== documentId) {
        const { error: cleanupError } = await supabase.storage.from("documents").remove([storagePath]);
        if (cleanupError) console.warn(`Client document cleanup failed (id=${documentId})`, cleanupError.message);
        throw registerError ?? new Error("Document registration did not complete.");
      }
    },
    onMutate: ({ item }) => setUploadingType(item.document_type),
    onSuccess: async () => {
      toast.success("Document uploaded for secure review.");
      await queryClient.invalidateQueries({ queryKey: ["client-document-workspace"] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Upload failed."),
    onSettled: () => setUploadingType(null),
  });

  const download = async (document: PortalDocument) => {
    const { data, error } = await supabase.storage.from("documents").createSignedUrl(document.storage_path, 60);
    if (error) { toast.error("The secure download could not be opened."); return; }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  const currentDocuments = (workspace.data?.documents ?? []).filter((document) => document.is_current_version);
  const documentByType = new Map(currentDocuments.map((document) => [document.document_type, document]));
  const checklist = workspace.data?.checklist ?? [];
  const approvedCount = checklist.filter((item) => documentByType.get(item.document_type)?.verification_status === "accepted").length;

  return (
    <ClientPortalShell>
      <div className="mx-auto max-w-6xl">
        <header className="mb-6">
          <p className="text-[10px] font-extrabold uppercase tracking-[0.22em] text-[#86d4cf]">Smart documentation checklist</p>
          <h1 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">Documents, without the guesswork</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-white/50">Your checklist combines the funding product, Owner decisions and funder requirements. Internal funder information remains private.</p>
        </header>

        {workspace.isLoading ? <div className="client-glass rounded-[28px] p-12 text-center text-sm text-white/45">Building your secure checklist...</div> : null}
        {workspace.error ? <div className="rounded-2xl border border-red-300/20 bg-red-400/10 p-5 text-sm text-red-100">The checklist could not be loaded. Please refresh or contact Fund Now Capital.</div> : null}
        {workspace.data ? <>
          <section className="mb-6 grid gap-4 sm:grid-cols-3">
            <div className="client-glass rounded-2xl p-5"><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/35">Funding route</p><p className="mt-2 text-lg font-extrabold">{workspace.data.product_name ?? "Being prepared"}</p></div>
            <div className="client-glass rounded-2xl p-5"><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/35">Approved</p><p className="mt-2 text-lg font-extrabold">{approvedCount} of {checklist.length}</p></div>
            <div className="client-glass rounded-2xl p-5"><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/35">Privacy</p><p className="mt-2 flex items-center gap-2 text-sm font-bold text-[#9ee67d]"><ShieldCheck className="h-4 w-4" aria-hidden="true" /> Private and encrypted</p></div>
          </section>

          {!workspace.data.deal_id || checklist.length === 0 ? <section className="client-glass rounded-[28px] p-6 sm:p-9"><span className="grid h-12 w-12 place-items-center rounded-2xl bg-[#2ca8a8]/15 text-[#86d4cf]"><FileCheck2 className="h-6 w-6" aria-hidden="true" /></span><h2 className="mt-5 text-2xl font-extrabold">Your tailored checklist is being prepared</h2><p className="mt-3 max-w-2xl text-sm leading-6 text-white/50">Once the Owner connects your application to the funding route and approved document rules, the exact paperwork will appear here. You will never be asked to guess or upload into an unapproved category.</p></section> : null}

          {checklist.length ? <section className="space-y-4" aria-label="Required documents">
            {checklist.map((item) => {
              const document = documentByType.get(item.document_type);
              const status = statusMeta(document);
              const StatusIcon = status.icon;
              return <article key={item.document_type} className="client-glass rounded-[24px] p-5 sm:p-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div><div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-extrabold">{docTypeLabel(item.document_type)}</h2><span className="rounded-full border border-white/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-white/40">{item.requirement}</span></div><p className="mt-2 text-xs leading-5 text-white/45">{item.reason || "Required for the selected funding route."}</p></div>
                  <span className={`inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold ${status.className}`}><StatusIcon className={`h-3.5 w-3.5 ${document?.verification_status === "unverified" ? "animate-spin" : ""}`} aria-hidden="true" />{status.label}</span>
                </div>
                {document ? <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-white/8 bg-white/[0.03] p-4 sm:flex-row sm:items-center"><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-white/75">{document.filename}</p><p className="mt-1 text-xs text-white/35">Version {document.version_number} · {fileSize(document.file_size_bytes)} · Uploaded {new Date(document.created_at).toLocaleDateString("en-ZA")}</p>{document.verification_status === "rejected" ? <p className="mt-2 text-xs font-semibold text-red-200">Reason: {document.rejection_reason?.replaceAll("_", " ") ?? "Please upload a clearer replacement."}</p> : null}</div><button type="button" onClick={() => void download(document)} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-white/10 px-3 text-xs font-bold text-white/60"><Download className="h-4 w-4" aria-hidden="true" /> View</button></div> : null}
                {document?.verification_status !== "accepted" ? <UploadControl item={item} busy={uploadingType === item.document_type} onUpload={(request) => upload.mutate(request)} /> : null}
              </article>;
            })}
          </section> : null}
        </> : null}
      </div>
    </ClientPortalShell>
  );
}
