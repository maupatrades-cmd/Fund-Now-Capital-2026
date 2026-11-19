import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { DocumentType, UploadSource, VerificationStatus } from "@/lib/documents";

// The Sales Coordinator's client documents (owner decision 19 Nov 2026: she uploads and opens client documents,
// bank statements included). Everything goes through SECURITY DEFINER RPCs (20261119101000): she has no direct read
// of public.documents, a file opens only through coordinator_open_document (logged, 2-minute ticket), and she can
// never delete or verify a document.
const BUCKET = "documents";
export const MAX_DOC_BYTES = 20 * 1024 * 1024;
export const DOC_MIME = ["application/pdf", "image/jpeg", "image/png"] as const;

export type CoordEntity = { kind: "lead" | "client"; id: string };

export type CoordDocument = {
  id: string; client_id: string | null; lead_id: string | null; filename: string; document_type: DocumentType;
  upload_source: UploadSource; period_start: string | null; period_end: string | null; expiry_date: string | null;
  version_number: number; is_current_version: boolean; status: string; verification_status: VerificationStatus;
  mime_type: string | null; file_size_bytes: number | null; uploaded_by_name: string | null; created_at: string;
};

const key = (e: CoordEntity | null) => ["coordinator-documents", e?.kind, e?.id] as const;

export function useCoordinatorDocuments(entity: CoordEntity | null) {
  return useQuery({
    queryKey: key(entity),
    enabled: !!entity,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("coordinator_list_documents", { p_kind: entity!.kind, p_entity_id: entity!.id });
      if (error) throw error;
      return (data ?? []) as CoordDocument[];
    },
  });
}

function safeName(name: string): string {
  return name.replace(/[^\w.-]+/g, "_").slice(0, 120) || "document";
}

export type CoordUploadInput = {
  entity: CoordEntity; file: File; documentType: DocumentType;
  periodStart: string | null; periodEnd: string | null; notes: string | null;
};

// File first (path {kind}s/{id}/{document id}/{name}), then the RPC registers the row. If registering fails, the file
// is removed again (a storage policy lets her remove only her own file that no document points at).
export function useCoordinatorUpload() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (i: CoordUploadInput) => {
      if (!(DOC_MIME as readonly string[]).includes(i.file.type)) throw new Error(`${i.file.name}: only PDF, JPG or PNG files can be uploaded`);
      if (i.file.size > MAX_DOC_BYTES) throw new Error(`${i.file.name} is larger than 20 MB`);
      const documentId = crypto.randomUUID();
      const path = `${i.entity.kind}s/${i.entity.id}/${documentId}/${safeName(i.file.name)}`;
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, i.file, { contentType: i.file.type, upsert: false });
      if (upErr) throw upErr;
      const { data, error } = await supabase.rpc("coordinator_add_document", {
        p_document_id: documentId, p_kind: i.entity.kind, p_entity_id: i.entity.id, p_filename: i.file.name.slice(0, 255),
        p_storage_path: path, p_document_type: i.documentType, p_file_size_bytes: i.file.size, p_mime_type: i.file.type,
        p_period_start: i.periodStart, p_period_end: i.periodEnd, p_notes: i.notes,
      });
      if (error || !data) {
        const { error: rmErr } = await supabase.storage.from(BUCKET).remove([path]);
        if (rmErr) console.warn(`Document cleanup failed (type=${i.documentType} ${i.entity.kind}=${i.entity.id}):`, rmErr.message);
        throw error ?? new Error("The document was not saved. Try again.");
      }
      return data as string;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: key(v.entity) });
      qc.invalidateQueries({ queryKey: ["coordinator-documents"] });
      qc.invalidateQueries({ queryKey: ["staff-intake-queue"] });
    },
  });
}

// View or download one document. The tab is opened before any await so popup blockers allow it; the RPC logs the open
// and issues a 2-minute ticket, then a 60-second signed URL is created.
export async function openCoordinatorDocument(documentId: string, purpose: "view" | "download", fileName?: string) {
  const tab = purpose === "view" ? window.open("", "_blank") : null;
  try {
    const { data: path, error } = await supabase.rpc("coordinator_open_document", { p_document_id: documentId, p_purpose: purpose });
    if (error) throw error;
    const { data, error: urlErr } = await supabase.storage.from(BUCKET)
      .createSignedUrl(path as string, 60, purpose === "download" ? { download: fileName ?? true } : undefined);
    if (urlErr) throw urlErr;
    if (tab) tab.location.href = data.signedUrl;
    else window.location.assign(data.signedUrl);
  } catch (e) {
    tab?.close();
    throw e;
  }
}
