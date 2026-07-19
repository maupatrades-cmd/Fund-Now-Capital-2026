import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import type {
  DocumentCategory,
  DocumentStatus,
  DocumentType,
  RejectionReason,
  UploadSource,
  VerificationStatus,
} from "@/lib/documents";

const BUCKET = "documents";

// A document's owning entity — a lead (pre-qualification) or a client. Drives the
// list filter, the upload storage path ({kind}s/{id}/…), and the owning FK column.
export type DocEntity = { kind: "client" | "lead"; id: string };

function entityColumn(kind: DocEntity["kind"]): "client_id" | "lead_id" {
  return kind === "lead" ? "lead_id" : "client_id";
}

function docsQueryKey(entity: DocEntity | undefined) {
  return ["entity-documents", entity?.kind, entity?.id] as const;
}

// The gate query (B3.2) is keyed by lead id; verifying/deleting a lead-owned
// document changes which required categories are satisfied, so those mutations
// must refresh it alongside the document list.
function invalidateEntity(
  qc: { invalidateQueries: (o: { queryKey: readonly unknown[] }) => void },
  entity: DocEntity,
) {
  qc.invalidateQueries({ queryKey: docsQueryKey(entity) });
  if (entity.kind === "lead") {
    qc.invalidateQueries({ queryKey: ["lead-required-docs-missing", entity.id] });
  }
}

// A row of public.documents (B3.1 schema). Shared by every document surface.
export type DocumentRow = {
  id: string;
  client_id: string | null;
  lead_id: string | null;
  deal_id: string | null;
  referral_partner_id: string | null;
  filename: string;
  storage_path: string;
  document_type: DocumentType;
  category: DocumentCategory;
  upload_source: UploadSource;
  file_size_bytes: number | null;
  mime_type: string | null;
  uploaded_by: string | null;
  period_start: string | null;
  period_end: string | null;
  expiry_date: string | null;
  version_number: number;
  is_current_version: boolean;
  is_period_scoped: boolean;
  superseded_by: string | null;
  status: DocumentStatus;
  verification_status: VerificationStatus;
  rejection_reason: RejectionReason | null;
  verification_notes: string | null;
  verified_by: string | null;
  verified_at: string | null;
  received_from: string | null;
  notes: string | null;
  tags: string[] | null;
  created_at: string;
  updated_at: string;
};

// Columns every surface selects. Explicit (not "*") so a future column can't
// silently change payload shape, and so the list stays readable.
export const DOCUMENT_COLUMNS =
  "id, client_id, lead_id, deal_id, referral_partner_id, filename, storage_path, " +
  "document_type, category, upload_source, file_size_bytes, mime_type, uploaded_by, " +
  "period_start, period_end, expiry_date, version_number, is_current_version, " +
  "is_period_scoped, superseded_by, status, verification_status, rejection_reason, " +
  "verification_notes, verified_by, verified_at, received_from, notes, tags, created_at, updated_at";

export type UploadDocumentInput = {
  entity: DocEntity;
  referralPartnerId: string | null;
  file: File;
  documentType: DocumentType;
  // Period-scoped types (bank statements etc.) carry a coverage window.
  periodStart?: string | null;
  periodEnd?: string | null;
  // Optional owner override; when omitted the DB applies the default-expiry rule.
  expiryDate?: string | null;
  tags?: string[];
  notes?: string | null;
};

function safeName(name: string): string {
  return name.replace(/[^\w.-]+/g, "_");
}

// Documents for a single owning entity (lead OR client). The generalized query;
// the storage path, list filter, and owning FK all key off the descriptor.
export function useEntityDocuments(entity: DocEntity | undefined) {
  return useQuery({
    queryKey: docsQueryKey(entity),
    enabled: !!entity?.id,
    queryFn: async (): Promise<DocumentRow[]> => {
      const { data, error } = await supabase
        .from("documents")
        .select(DOCUMENT_COLUMNS)
        .eq(entityColumn(entity!.kind), entity!.id)
        .order("document_type", { ascending: true })
        .order("version_number", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as DocumentRow[];
    },
  });
}

// Back-compat convenience for the client surfaces (deal view etc.) that only
// ever pass a client id.
export function useClientDocuments(clientId: string | undefined) {
  return useEntityDocuments(clientId ? { kind: "client", id: clientId } : undefined);
}

export function useUploadDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UploadDocumentInput) => {
      const { entity, referralPartnerId, file, documentType } = input;
      // Entity-prefixed path convention (B3.2): {kind}s/{id}/{document_id}/{name}.
      // The document id is generated client-side and used as BOTH the row id and
      // the path segment, so the storage layout is stable + self-describing.
      const documentId = crypto.randomUUID();
      const path = `${entity.kind}s/${entity.id}/${documentId}/${safeName(file.name)}`;
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, { contentType: file.type || undefined, upsert: false });
      if (upErr) throw upErr;

      // uploaded_by defaults to auth.uid() server-side (audit-truth, immutable);
      // upload_source defaults to 'owner'. deal_id is left null — a lead/client
      // document is never attached to a deal at upload (DB CHECK enforces lead XOR
      // deal). We RETURNING id and check the row count so a silent RLS failure
      // surfaces loudly (CLAUDE.md standing rule).
      const { data, error: insErr } = await supabase
        .from("documents")
        .insert({
          id: documentId,
          [entityColumn(entity.kind)]: entity.id,
          referral_partner_id: referralPartnerId,
          filename: file.name,
          storage_path: path,
          document_type: documentType,
          upload_source: "owner",
          file_size_bytes: file.size,
          mime_type: file.type || null,
          period_start: input.periodStart ?? null,
          period_end: input.periodEnd ?? null,
          expiry_date: input.expiryDate ?? null,
          tags: input.tags && input.tags.length ? input.tags : null,
          notes: input.notes ?? null,
        })
        .select("id");
      if (insErr || !data || data.length !== 1) {
        // Best-effort rollback of the orphaned file. Log a NON-PII trace id
        // (document type + owning UUID + timestamp) so a "my upload didn't save"
        // report is traceable — never the storage path, which embeds the entity
        // id and the original filename.
        const { error: rmErr } = await supabase.storage.from(BUCKET).remove([path]);
        if (rmErr) {
          console.warn(
            `Document storage rollback failed (type=${documentType} ${entity.kind}=${entity.id} at=${new Date().toISOString()}):`,
            rmErr.message,
          );
        }
        throw insErr ?? new Error("Upload was blocked (no row created).");
      }
    },
    onSuccess: (_d, vars) => invalidateEntity(qc, vars.entity),
  });
}

export function useDeleteDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      storagePath,
    }: {
      id: string;
      storagePath: string;
      entity: DocEntity;
    }) => {
      // Delete the metadata row FIRST (RETURNING id + affected-row-count check
      // per standing rule 4) so an RLS-blocked or stale delete can't destroy the
      // file while leaving orphan metadata behind. Only after the row is gone do
      // we remove the storage object; a cleanup failure is a warning, not a crash
      // (worst case is an orphan file, never an orphan row pointing at nothing).
      const { data, error } = await supabase
        .from("documents")
        .delete()
        .eq("id", id)
        .select("id");
      if (error) throw error;
      if (!data || data.length !== 1) throw new Error("Delete was blocked (no row removed).");

      const { error: rmErr } = await supabase.storage.from(BUCKET).remove([storagePath]);
      if (rmErr) {
        console.warn(
          `Document storage cleanup failed (id=${id} at=${new Date().toISOString()}):`,
          rmErr.message,
        );
      }
    },
    onSuccess: (_d, vars) => invalidateEntity(qc, vars.entity),
  });
}

// Owner-only accept / reject / reset via the set_document_verification RPC
// (SECURITY DEFINER; stamps verified_by/at + writes the activity row). A reject
// requires a reason; the RPC also enforces it server-side.
export type VerifyDocumentInput = {
  id: string;
  entity: DocEntity;
  status: VerificationStatus;
  reason?: RejectionReason | null;
  notes?: string | null;
};

export function useVerifyDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: VerifyDocumentInput) => {
      const { data, error } = await supabase.rpc("set_document_verification", {
        p_document_id: input.id,
        p_status: input.status,
        p_reason: input.status === "rejected" ? (input.reason ?? null) : null,
        p_notes: input.notes ?? null,
      });
      if (error) throw error;
      if (!data) throw new Error("Verification did not return a document id.");
      return data as string;
    },
    onSuccess: (_d, vars) => invalidateEntity(qc, vars.entity),
  });
}

// Private bucket: short-lived signed URL to view/download.
export async function getDocumentUrl(storagePath: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, 60);
  if (error) throw error;
  return data.signedUrl;
}

// Open a private document in a new tab. The single implementation shared by every
// download surface (client tab, deal view, global page) so their behaviour can't
// diverge. The tab is opened SYNCHRONOUSLY — before awaiting the signed URL — to
// preserve the click's user-activation, otherwise Safari/Firefox popup blockers
// kill the tab across the async boundary. Falls back to same-tab navigation when
// a strict blocker returns null.
export function openDocument(storagePath: string): void {
  const tab = window.open("", "_blank");
  if (tab) tab.opener = null;
  getDocumentUrl(storagePath)
    .then((url) => {
      if (tab) tab.location.href = url;
      else window.location.href = url;
    })
    .catch((e: unknown) => {
      tab?.close();
      toast.error((e as Error).message || "Couldn't open document");
    });
}
