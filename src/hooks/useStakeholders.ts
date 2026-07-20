import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { invalidateActivity } from "@/hooks/useActivity";
import type { StakeholderRole, StakeholderIdType } from "@/lib/stakeholders";

// A stakeholder's owning entity — a lead (pre-qualification) or a client. Drives
// the list filter and the owning FK column (client_id XOR lead_id), mirroring
// the documents DocEntity pattern.
export type StakeEntity = { kind: "client" | "lead"; id: string };

function entityColumn(kind: StakeEntity["kind"]): "client_id" | "lead_id" {
  return kind === "lead" ? "lead_id" : "client_id";
}

function stakeQueryKey(entity: StakeEntity | undefined) {
  return ["stakeholders", entity?.kind, entity?.id] as const;
}

export type Stakeholder = {
  id: string;
  client_id: string | null;
  lead_id: string | null;
  full_name: string;
  id_type: StakeholderIdType;
  id_number: string | null;
  passport_country: string | null;
  roles: StakeholderRole[];
  shareholding_percent: number | null;
  is_beneficial_owner: boolean;
  cell: string | null;
  email: string | null;
  physical_address: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

// Fields the owner writes (ownership + audit cols are set by the hook / server).
export type StakeholderInput = {
  full_name: string;
  id_type: StakeholderIdType;
  id_number: string | null;
  passport_country: string | null;
  roles: StakeholderRole[];
  shareholding_percent: number | null;
  is_beneficial_owner: boolean;
  cell: string | null;
  email: string | null;
  physical_address: string | null;
  notes: string | null;
};

const STAKEHOLDER_COLUMNS =
  "id, client_id, lead_id, full_name, id_type, id_number, passport_country, roles, " +
  "shareholding_percent, is_beneficial_owner, cell, email, physical_address, notes, " +
  "created_at, updated_at";

export function useStakeholders(entity: StakeEntity | undefined) {
  return useQuery({
    queryKey: stakeQueryKey(entity),
    enabled: !!entity?.id,
    queryFn: async (): Promise<Stakeholder[]> => {
      const { data, error } = await supabase
        .from("client_stakeholders")
        .select(STAKEHOLDER_COLUMNS)
        .eq(entityColumn(entity!.kind), entity!.id)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as Stakeholder[];
    },
  });
}

// Create + update in one mutation. RETURNING id + row-count check surfaces a
// silent RLS failure loudly (CLAUDE.md standing rule).
export function useSaveStakeholder(entity: StakeEntity) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: { id?: string; input: StakeholderInput }) => {
      if (id) {
        // Scope by the owning entity too, not just the PK — a stale id from a
        // different client/lead can never be edited through this entity's panel.
        const { data, error } = await supabase
          .from("client_stakeholders")
          .update(input)
          .eq("id", id)
          .eq(entityColumn(entity.kind), entity.id)
          .select("id");
        if (error) throw error;
        if (!data || data.length !== 1) throw new Error("Stakeholder was not updated (no row written).");
        return;
      }
      const { data, error } = await supabase
        .from("client_stakeholders")
        .insert({ [entityColumn(entity.kind)]: entity.id, ...input })
        .select("id");
      if (error) throw error;
      if (!data || data.length !== 1) throw new Error("Stakeholder was not saved (no row written).");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: stakeQueryKey(entity) });
      invalidateActivity(qc);
    },
  });
}

export function useDeleteStakeholder(entity: StakeEntity) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase
        .from("client_stakeholders")
        .delete()
        .eq("id", id)
        .eq(entityColumn(entity.kind), entity.id)
        .select("id");
      if (error) throw error;
      if (!data || data.length !== 1) throw new Error("Stakeholder was not deleted (no row removed).");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: stakeQueryKey(entity) });
      invalidateActivity(qc);
    },
  });
}
