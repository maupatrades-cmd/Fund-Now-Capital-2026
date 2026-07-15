import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";

// ---- Types (hand-authored, matching the B1 schema; no generated DB types) ----
export type AppetiteLevel = "high" | "medium" | "low" | "avoid";

export type Industry = {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  sort_order: number;
};

export type SubIndustry = {
  id: string;
  industry_id: string;
  name: string;
  active: boolean;
  sort_order: number;
};

export type IndustryWithSubs = Industry & { sub_industries: SubIndustry[] };

export type FunderAppetite = {
  id: string;
  funder_id: string;
  industry_id: string;
  appetite_level: AppetiteLevel;
  notes: string | null;
};

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

// Full taxonomy tree: industries (by sort_order) each with their sub-industries
// (by sort_order). Reference data — readable by any authenticated app user.
export function useIndustries() {
  return useQuery({
    queryKey: ["industries"],
    queryFn: async (): Promise<IndustryWithSubs[]> => {
      const { data, error } = await supabase
        .from("industries")
        .select(
          "id, name, description, active, sort_order, sub_industries(id, industry_id, name, active, sort_order)",
        )
        .order("sort_order")
        .order("sort_order", { referencedTable: "sub_industries" });
      if (error) throw error;
      return (data ?? []) as unknown as IndustryWithSubs[];
    },
  });
}

// Minimal funder list (id + real name) for the owner-only appetite matrix rows.
// The funders table is owner-only in RLS, so this only resolves for the owner.
export function useFundersMinimal() {
  return useQuery({
    queryKey: ["funders-minimal"],
    queryFn: async (): Promise<{ id: string; name: string }[]> => {
      // The CRM only holds funders with signed/verbal contracts (currently 21 —
      // see SPEC.md S1). The 200 limit is intentional safety headroom, not a
      // pagination boundary. If the operational panel ever approaches 100,
      // revisit with pagination — but this is deliberately expected to grow
      // slowly and predictably.
      const { data, error } = await supabase
        .from("funders")
        .select("id, name")
        .order("name")
        .limit(200);
      if (error) throw error;
      const rows = (data ?? []) as { id: string; name: string }[];
      // Tripwire: if we ever hit the cap, the matrix may be silently truncating.
      if (rows.length === 200) {
        console.warn(
          "useFundersMinimal returned exactly 200 funders — the limit has been reached. Consider adding pagination before the next funder is contracted. See SPEC.md S1.",
        );
      }
      return rows;
    },
  });
}

// The full owner appetite matrix, keyed by `${funder_id}:${industry_id}`.
export function useFunderAppetite() {
  return useQuery({
    queryKey: ["funder-appetite"],
    queryFn: async (): Promise<Record<string, FunderAppetite>> => {
      const { data, error } = await supabase
        .from("funder_industry_preferences")
        .select("id, funder_id, industry_id, appetite_level, notes");
      if (error) throw error;
      const byCell: Record<string, FunderAppetite> = {};
      for (const row of (data ?? []) as FunderAppetite[]) {
        byCell[`${row.funder_id}:${row.industry_id}`] = row;
      }
      return byCell;
    },
  });
}

export const appetiteCellKey = (funderId: string, industryId: string) =>
  `${funderId}:${industryId}`;

// ---------------------------------------------------------------------------
// Mutations (owner-only; each checks the returned row so a silent RLS no-op
// surfaces loudly — CLAUDE.md working-style rule).
// ---------------------------------------------------------------------------

export function useAddIndustry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ name, sortOrder }: { name: string; sortOrder: number }) => {
      const { data, error } = await supabase
        .from("industries")
        .insert({ name, sort_order: sortOrder })
        .select("id")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["industries"] }),
  });
}

export function useAddSubIndustry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      industryId,
      name,
      sortOrder,
    }: {
      industryId: string;
      name: string;
      sortOrder: number;
    }) => {
      const { data, error } = await supabase
        .from("sub_industries")
        .insert({ industry_id: industryId, name, sort_order: sortOrder })
        .select("id")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["industries"] }),
  });
}

export function useToggleIndustryActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { data, error } = await supabase
        .from("industries")
        .update({ active })
        .eq("id", id)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("Industry was not updated");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["industries"] }),
  });
}

export function useToggleSubIndustryActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { data, error } = await supabase
        .from("sub_industries")
        .update({ active })
        .eq("id", id)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("Sub-industry was not updated");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["industries"] }),
  });
}

// Upsert (or clear) one appetite cell for (funder, industry).
export function useUpsertAppetite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      funderId,
      industryId,
      level,
      notes,
    }: {
      funderId: string;
      industryId: string;
      level: AppetiteLevel;
      notes: string | null;
    }) => {
      const { data, error } = await supabase
        .from("funder_industry_preferences")
        .upsert(
          {
            funder_id: funderId,
            industry_id: industryId,
            appetite_level: level,
            notes,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "funder_id,industry_id" },
        )
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("Appetite was not saved");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["funder-appetite"] }),
  });
}

// Delete one appetite cell with an optimistic-delete pattern: hide the cell
// immediately, roll back the cache on failure, and reconcile with the server on
// settle. The row-count check still fires so a silent RLS no-op throws (which
// triggers the rollback path) rather than looking like success.
export function useClearAppetite() {
  const qc = useQueryClient();
  const key = ["funder-appetite"] as const;
  return useMutation({
    mutationFn: async ({ id }: { id: string; funderId: string; industryId: string }) => {
      const { data, error } = await supabase
        .from("funder_industry_preferences")
        .delete()
        .eq("id", id)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("Appetite was not cleared");
    },
    onMutate: async ({ funderId, industryId }) => {
      // Cancel in-flight refetches so they can't clobber the optimistic write.
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<Record<string, FunderAppetite>>(key);
      if (previous) {
        const next = { ...previous };
        delete next[appetiteCellKey(funderId, industryId)];
        qc.setQueryData(key, next);
      }
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
      toast.error("Couldn't delete — try again");
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });
}

// ---- Shared appetite badge metadata (colour-coded per SPEC S1 / brief) ----
export const APPETITE_META: Record<AppetiteLevel, { label: string; className: string }> = {
  high: { label: "High", className: "bg-green-50 text-green-700 ring-green-600/20" },
  medium: { label: "Medium", className: "bg-teal-50 text-teal-700 ring-teal-600/20" },
  low: { label: "Low", className: "bg-slate-100 text-slate-600 ring-slate-500/20" },
  avoid: { label: "Avoid", className: "bg-red-50 text-red-700 ring-red-600/20" },
};

export const APPETITE_LEVELS: AppetiteLevel[] = ["high", "medium", "low", "avoid"];
