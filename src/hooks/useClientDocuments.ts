import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type {
  DocumentCategory,
  DocumentStatus,
  DocumentType,
  UploadSource,
} from "@/lib/documents";

const BUCKET = "documents";

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
  "is_period_scoped, superseded_by, status, received_from, notes, tags, created_at, updated_at";

export type UploadDocumentInput = {
  clientId: string;
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

export function useClientDocuments(clientId: string | undefined) {
  return useQuery({
    queryKey: ["client-documents", clientId],
    enabled: !!clientId,
    queryFn: async (): Promise<DocumentRow[]> => {
      const { data, error } = await supabase
        .from("documents")
        .select(DOCUMENT_COLUMNS)
        .eq("client_id", clientId!)
        .order("document_type", { ascending: true })
        .order("version_number", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as DocumentRow[];
    },
  });
}

export function useUploadDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UploadDocumentInput) => {
      const { clientId, referralPartnerId, file, documentType } = input;
      // Storage path convention (Gap 2): {entity_type}/{entity_id}/{uuid}-{name}.
      const path = `clients/${clientId}/${crypto.randomUUID()}-${safeName(file.name)}`;
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, { contentType: file.type || undefined, upsert: false });
      if (upErr) throw upErr;

      // uploaded_by defaults to auth.uid() server-side (audit-truth, immutable);
      // upload_source defaults to 'owner'. We RETURNING id and check the row
      // count so a silent RLS failure surfaces loudly (CLAUDE.md standing rule).
      const { data, error: insErr } = await supabase
        .from("documents")
        .insert({
          client_id: clientId,
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
        // Best-effort rollback of the orphaned file; surface the real error.
        const { error: rmErr } = await supabase.storage.from(BUCKET).remove([path]);
        if (rmErr) console.warn("Orphaned upload left in storage:", path, rmErr.message);
        throw insErr ?? new Error("Upload was blocked (no row created).");
      }
    },
    onSuccess: (_d, vars) =>
      qc.invalidateQueries({ queryKey: ["client-documents", vars.clientId] }),
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
      clientId: string;
    }) => {
      const { error: rmErr } = await supabase.storage.from(BUCKET).remove([storagePath]);
      if (rmErr) throw rmErr;
      const { data, error } = await supabase
        .from("documents")
        .delete()
        .eq("id", id)
        .select("id");
      if (error) throw error;
      if (!data || data.length !== 1) throw new Error("Delete was blocked (no row removed).");
    },
    onSuccess: (_d, vars) =>
      qc.invalidateQueries({ queryKey: ["client-documents", vars.clientId] }),
  });
}

// Private bucket: short-lived signed URL to view/download.
export async function getDocumentUrl(storagePath: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, 60);
  if (error) throw error;
  return data.signedUrl;
}
