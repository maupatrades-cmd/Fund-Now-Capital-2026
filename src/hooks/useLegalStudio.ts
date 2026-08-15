import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/lib/useSession";
import type {
  LegalDocumentRole,
  LegalDocumentType,
  LegalSourceAsset,
  LegalTemplate,
  LegalTemplateVersion,
} from "@/lib/legalTemplates";

// Owner Document Studio data layer (Build 7). Reads the owner-only legal
// registry tables directly (RLS narrows SELECT to the owner) and mutates only
// through the Build 41 SECURITY DEFINER RPCs — never raw table writes (table
// DML is revoked from every API role). Every mutation invalidates the shared
// ["legal-studio"] cache so the lists reflect the new state immediately.

const STUDIO_KEY = ["legal-studio"] as const;

export function useLegalTemplates() {
  const uid = useSession()?.user?.id ?? null;
  const query = useQuery({
    queryKey: [...STUDIO_KEY, "templates", uid],
    enabled: uid !== null,
    queryFn: async (): Promise<LegalTemplate[]> => {
      const { data, error } = await supabase
        .from("legal_document_templates")
        .select("*")
        .order("role", { ascending: true })
        .order("document_type", { ascending: true })
        .order("title", { ascending: true });
      if (error) throw error;
      return (data ?? []) as LegalTemplate[];
    },
  });
  return { ...query, isLoading: query.isLoading || uid === null };
}

export function useLegalTemplateVersions() {
  const uid = useSession()?.user?.id ?? null;
  const query = useQuery({
    queryKey: [...STUDIO_KEY, "versions", uid],
    enabled: uid !== null,
    queryFn: async (): Promise<LegalTemplateVersion[]> => {
      const { data, error } = await supabase
        .from("legal_document_template_versions")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as LegalTemplateVersion[];
    },
  });
  return { ...query, isLoading: query.isLoading || uid === null };
}

export function useLegalSourceAssets() {
  const uid = useSession()?.user?.id ?? null;
  const query = useQuery({
    queryKey: [...STUDIO_KEY, "source-assets", uid],
    enabled: uid !== null,
    queryFn: async (): Promise<LegalSourceAsset[]> => {
      const { data, error } = await supabase
        .from("legal_source_assets")
        .select("*")
        .order("source_key", { ascending: true });
      if (error) throw error;
      return (data ?? []) as LegalSourceAsset[];
    },
  });
  return { ...query, isLoading: query.isLoading || uid === null };
}

function useStudioInvalidator() {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: STUDIO_KEY });
}

export type CreateTemplateInput = {
  documentType: LegalDocumentType;
  role: LegalDocumentRole;
  legalEntity: string;
  title: string;
  jurisdiction: string;
  description: string | null;
};

export function useCreateTemplate() {
  const invalidate = useStudioInvalidator();
  return useMutation({
    mutationFn: async (input: CreateTemplateInput): Promise<LegalTemplate> => {
      const { data, error } = await supabase.rpc("create_legal_document_template", {
        p_document_type: input.documentType,
        p_role: input.role,
        p_legal_entity: input.legalEntity,
        p_title: input.title,
        p_jurisdiction: input.jurisdiction,
        p_description: input.description,
      });
      if (error) throw error;
      return data as LegalTemplate;
    },
    onSuccess: invalidate,
  });
}

export type CreateVersionInput = {
  templateId: string;
  version: string;
  contentMarkdown: string | null;
  effectiveDate: string | null;
};

export function useCreateVersion() {
  const invalidate = useStudioInvalidator();
  return useMutation({
    mutationFn: async (input: CreateVersionInput): Promise<LegalTemplateVersion> => {
      // Only markdown-authored versions are supported from the Studio for now;
      // storage-backed source uploads land with the PDF-ingestion build. A
      // version created with no content is born draft_blocked server-side (§2).
      const { data, error } = await supabase.rpc("create_legal_template_version", {
        p_template_id: input.templateId,
        p_version: input.version,
        p_content_markdown: input.contentMarkdown,
        p_source_storage_path: null,
        p_source_filename: null,
        p_content_sha256: null,
        p_effective_date: input.effectiveDate,
      });
      if (error) throw error;
      return data as LegalTemplateVersion;
    },
    onSuccess: invalidate,
  });
}

export function useSubmitVersionForReview() {
  const invalidate = useStudioInvalidator();
  return useMutation({
    mutationFn: async (versionId: string) => {
      const { data, error } = await supabase.rpc(
        "submit_legal_template_version_for_review",
        { p_version_id: versionId },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: invalidate,
  });
}

export function usePublishVersion() {
  const invalidate = useStudioInvalidator();
  return useMutation({
    mutationFn: async (versionId: string) => {
      const { data, error } = await supabase.rpc("publish_legal_template_version", {
        p_version_id: versionId,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: invalidate,
  });
}

export function useSupersedeVersion() {
  const invalidate = useStudioInvalidator();
  return useMutation({
    mutationFn: async (versionId: string) => {
      const { data, error } = await supabase.rpc("supersede_legal_template_version", {
        p_version_id: versionId,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: invalidate,
  });
}

export type IngestSourceAssetInput = {
  sourceKey: string;
  storagePath: string;
  templateId?: string | null;
  version?: string | null;
};

// Build 4 — invoke the ingest-legal-source-asset Edge Function, which hashes the
// uploaded PDF server-side and verifies it against the approved digest (and,
// optionally, creates a source-backed template version). functions.invoke
// attaches the owner's session JWT; the function authorises is_owner() itself.
export function useIngestSourceAsset() {
  const invalidate = useStudioInvalidator();
  return useMutation({
    mutationFn: async (input: IngestSourceAssetInput) => {
      const { data, error } = await supabase.functions.invoke("ingest-legal-source-asset", {
        body: {
          source_key: input.sourceKey,
          storage_path: input.storagePath,
          template_id: input.templateId ?? undefined,
          version: input.version ?? undefined,
        },
      });
      if (error) {
        // supabase-js FunctionsHttpError hides the function's JSON body in
        // error.context (a Response) — surface the real message when present.
        let message = error.message;
        try {
          const ctx = (error as { context?: Response }).context;
          if (ctx && typeof ctx.json === "function") {
            const body = await ctx.json();
            if (body?.error) message = body.error as string;
          }
        } catch {
          // keep error.message
        }
        throw new Error(message);
      }
      return data as { ok: boolean; status: string; computed_sha256?: string; version_error?: string };
    },
    onSuccess: invalidate,
  });
}
