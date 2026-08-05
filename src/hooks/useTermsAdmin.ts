import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/lib/useSession";
import type { TermsVersion } from "@/lib/terms";

export type TermsDraftInput = {
  id: string | null;
  versionNumber: string;
  effectiveDate: string;
  contentMarkdown: string;
};

export function useTermsVersionsAdmin() {
  const uid = useSession()?.user?.id ?? null;
  const query = useQuery({
    queryKey: ["terms-admin", uid],
    enabled: uid !== null,
    queryFn: async (): Promise<TermsVersion[]> => {
      const { data, error } = await supabase
        .from("terms_versions")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as TermsVersion[];
    },
  });
  return { ...query, isLoading: query.isLoading || uid === null };
}

function useTermsAdminInvalidator() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["terms-admin"] });
    void queryClient.invalidateQueries({ queryKey: ["terms-acceptance"] });
  };
}

export function useSaveTermsDraft() {
  const invalidate = useTermsAdminInvalidator();
  return useMutation({
    mutationFn: async (input: TermsDraftInput) => {
      const { data, error } = await supabase.rpc("owner_save_terms_version", {
        p_id: input.id,
        p_version_number: input.versionNumber,
        p_effective_date: input.effectiveDate,
        p_content_markdown: input.contentMarkdown,
      });
      if (error) throw error;
      return data as TermsVersion;
    },
    onSuccess: invalidate,
  });
}

export function usePublishTermsVersion() {
  const invalidate = useTermsAdminInvalidator();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.rpc("owner_publish_terms_version", { p_id: id });
      if (error) throw error;
      return data as TermsVersion;
    },
    onSuccess: invalidate,
  });
}

export function useRetireTermsVersion() {
  const invalidate = useTermsAdminInvalidator();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.rpc("owner_retire_terms_version", { p_id: id });
      if (error) throw error;
      return data as TermsVersion;
    },
    onSuccess: invalidate,
  });
}
