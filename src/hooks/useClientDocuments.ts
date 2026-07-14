import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

const BUCKET = "documents";

export type ClientDocument = {
  id: string;
  client_id: string | null;
  deal_id: string | null;
  referral_partner_id: string | null;
  file_name: string;
  storage_path: string;
  doc_type: string;
  file_size_bytes: number | null;
  mime_type: string | null;
  uploaded_by: string | null;
  created_at: string;
};

export function useClientDocuments(clientId: string | undefined) {
  return useQuery({
    queryKey: ["client-documents", clientId],
    enabled: !!clientId,
    queryFn: async (): Promise<ClientDocument[]> => {
      const { data, error } = await supabase
        .from("documents")
        .select("*")
        .eq("client_id", clientId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ClientDocument[];
    },
  });
}

function safeName(name: string): string {
  return name.replace(/[^\w.-]+/g, "_");
}

export function useUploadDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      clientId,
      referralPartnerId,
      file,
      docType,
    }: {
      clientId: string;
      referralPartnerId: string | null;
      file: File;
      docType: string;
    }) => {
      const path = `${clientId}/${crypto.randomUUID()}-${safeName(file.name)}`;
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, { contentType: file.type || undefined, upsert: false });
      if (upErr) throw upErr;

      const uid = (await supabase.auth.getUser()).data.user?.id ?? null;
      const { error: insErr } = await supabase.from("documents").insert({
        client_id: clientId,
        referral_partner_id: referralPartnerId,
        file_name: file.name,
        storage_path: path,
        doc_type: docType,
        file_size_bytes: file.size,
        mime_type: file.type || null,
        uploaded_by: uid,
      });
      if (insErr) {
        // Best-effort rollback; surface the original insert error regardless.
        const { error: rmErr } = await supabase.storage.from(BUCKET).remove([path]);
        if (rmErr) {
          console.warn("Orphaned upload left in storage:", path, rmErr.message);
        }
        throw insErr;
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
      // Remove the file first; if that fails, keep the metadata row so the
      // document isn't orphaned in storage — the user can retry.
      const { error: rmErr } = await supabase.storage.from(BUCKET).remove([storagePath]);
      if (rmErr) throw rmErr;
      const { error } = await supabase.from("documents").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_d, vars) =>
      qc.invalidateQueries({ queryKey: ["client-documents", vars.clientId] }),
  });
}

// Private bucket: fetch a short-lived signed URL to view/download a file.
export async function getDocumentUrl(storagePath: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, 60);
  if (error) throw error;
  return data.signedUrl;
}
