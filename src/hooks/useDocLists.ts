import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export type DocLevel = "required" | "conditional" | "optional" | "required_later";
export type DocListOverview = {
  code: string; label: string; group: string; kind: "common" | "funding_type"; includes: string | null;
  confirmed: boolean; confirmed_at: string | null; version: number; items: number; required: number;
};
export type DocListItem = { doc_code: string; title: string; level: DocLevel; note: string | null; source: string };
export type DocListDetail = {
  type: string; label: string; confirmed: boolean; version: number; entity_type: string | null; entity_notes: string[]; items: DocListItem[];
};

export const ENTITY_TYPES = [
  ["pty_ltd", "(Pty) Ltd"], ["cc", "Close corporation (CC)"], ["sole_proprietor", "Sole proprietor"], ["partnership", "Partnership"],
  ["trust", "Trust"], ["npo", "Non-profit company or NPO"], ["joint_venture", "Joint venture"], ["cooperative", "Co-operative"],
  ["foreign_owned", "Foreign-owned company"],
] as const;

export const LEVEL_LABEL: Record<DocLevel, string> = {
  required: "Required", conditional: "Conditional", optional: "Optional", required_later: "Required later",
};

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data as T;
}

export function useDocListsOverview() {
  return useQuery({ queryKey: ["doc-lists-overview"], queryFn: () => rpc<DocListOverview[]>("staff_doc_lists_overview") });
}

// Fetched only when a list is opened. COMMON has no entity view of its own, so it reads through the first funding type.
export function useDocListDetail(type: string | null, entity: string | null) {
  return useQuery({
    queryKey: ["doc-list-detail", type, entity], enabled: Boolean(type),
    queryFn: () => rpc<DocListDetail>("staff_doc_list_detail", { p_type: type, p_entity: entity }),
  });
}

export function useConfirmDocList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => rpc<void>("owner_confirm_doc_list", { p_code: code }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["doc-lists-overview"] }); void qc.invalidateQueries({ queryKey: ["doc-list-detail"] }); },
  });
}

export function useEditDocItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { list: string; doc: string; level: DocLevel | null; condition?: string | null }) =>
      rpc<number>("owner_edit_doc_item", { p_list: v.list, p_doc: v.doc, p_level: v.level, p_condition: v.condition ?? null }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["doc-lists-overview"] }); void qc.invalidateQueries({ queryKey: ["doc-list-detail"] }); },
  });
}

// Condition wording on a document an entity type adds or swaps in (entity rules are not versioned;
// each change is kept in the audit trail).
export function useEditEntityCondition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { entity: string; doc: string; condition: string }) =>
      rpc<void>("owner_edit_entity_doc_condition", { p_entity: v.entity, p_doc: v.doc, p_condition: v.condition }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["doc-list-detail"] }); },
  });
}
