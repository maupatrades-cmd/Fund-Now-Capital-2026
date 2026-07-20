import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { invalidateActivity } from "@/hooks/useActivity";
import type { RateStructure, RateStructureInput } from "@/lib/funderCommissions";

const RATE_COLUMNS =
  "id, funder_id, deal_type, rate_type, rate_fraction, flat_amount, " +
  "effective_from, effective_to, contract_clause_ref, payment_terms_days, " +
  "contract_reference, notes, created_at, updated_at";

// All per-funder rate structures (owner-only via RLS). Ordered so the active
// (open-ended) row surfaces first per (funder, deal_type), history below it.
export function useRateStructures() {
  return useQuery({
    queryKey: ["funder-rate-structures"],
    queryFn: async (): Promise<RateStructure[]> => {
      const { data, error } = await supabase
        .from("funder_commission_structures")
        .select(RATE_COLUMNS)
        .order("funder_id", { ascending: true })
        .order("deal_type", { ascending: true })
        .order("effective_from", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as RateStructure[];
    },
  });
}

// Map the DB constraint errors this table can raise into owner-friendly copy.
// 23P01 = exclusion_violation (fcs_no_overlap); 23514 = check_violation
// (fcs_rate_bounds_ck / fcs_effective_range_ck).
function friendlyRateError(error: { code?: string; message?: string }): Error {
  if (error.code === "23P01") {
    return new Error(
      "This funder already has an active rate for that deal type. Close the current rate " +
        "(set an end date) before adding a new one — you can't have two open rates for the same deal type.",
    );
  }
  if (error.code === "23514") {
    return new Error(
      "Check the rate and dates: a percentage rate must be between 0% and 100%, a flat amount can't be " +
        "negative, and an end date (if set) must be after the start date.",
    );
  }
  return new Error(error.message || "Could not save the rate structure.");
}

// Create-or-update. RETURNING id + row-count check surfaces a silent RLS failure
// loudly (CLAUDE.md standing rule).
export function useSaveRateStructure() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: { id?: string; input: RateStructureInput }) => {
      if (id) {
        const { data, error } = await supabase
          .from("funder_commission_structures")
          .update(input)
          .eq("id", id)
          .select("id");
        if (error) throw friendlyRateError(error);
        if (!data || data.length !== 1) throw new Error("Rate structure was not updated (no row written).");
        return;
      }
      const { data, error } = await supabase
        .from("funder_commission_structures")
        .insert(input)
        .select("id");
      if (error) throw friendlyRateError(error);
      if (!data || data.length !== 1) throw new Error("Rate structure was not saved (no row written).");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["funder-rate-structures"] });
      invalidateActivity(qc);
    },
  });
}

// Delete (for corrections / mistaken entries). Row-count-checked.
export function useDeleteRateStructure() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase
        .from("funder_commission_structures")
        .delete()
        .eq("id", id)
        .select("id");
      if (error) throw error;
      if (!data || data.length !== 1) throw new Error("Rate structure was not deleted (no row removed).");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["funder-rate-structures"] });
      invalidateActivity(qc);
    },
  });
}
