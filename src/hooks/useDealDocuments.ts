import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { ClientDocument } from "@/hooks/useClientDocuments";

const BUCKET = "documents";

function safeName(name: string): string {
  return name.replace(/[^\w.-]+/g, "_");
}

export function useDealDocuments(dealId: string | undefined) {
  return useQuery({
    queryKey: ["deal-documents", dealId],
    enabled: !!dealId,
    queryFn: async (): Promise<ClientDocument[]> => {
      const { data, error } = await supabase
        .from("documents")
        .select("*")
        .eq("deal_id", dealId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ClientDocument[];
    },
  });
}

export function useUploadDealDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      dealId,
      clientId,
      referralPartnerId,
      file,
      docType,
    }: {
      dealId: string;
      clientId: string | null;
      referralPartnerId: string | null;
      file: File;
      docType: string;
    }) => {
      const path = `deals/${dealId}/${crypto.randomUUID()}-${safeName(file.name)}`;
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, { contentType: file.type || undefined, upsert: false });
      if (upErr) throw upErr;

      const uid = (await supabase.auth.getUser()).data.user?.id ?? null;
      const { error: insErr } = await supabase.from("documents").insert({
        deal_id: dealId,
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
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ["deal-documents", v.dealId] }),
  });
}

export function useDeleteDealDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      storagePath,
    }: {
      id: string;
      storagePath: string;
      dealId: string;
    }) => {
      // Remove the file first; if that fails, keep the metadata row so the
      // document isn't orphaned in storage — the user can retry.
      const { error: rmErr } = await supabase.storage.from(BUCKET).remove([storagePath]);
      if (rmErr) throw rmErr;
      const { error } = await supabase.from("documents").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ["deal-documents", v.dealId] }),
  });
}
