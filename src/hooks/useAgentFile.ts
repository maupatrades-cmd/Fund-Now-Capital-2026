import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

// Agent file (owner, 17 Nov 2026): the Director, HR and the Office Administrator capture an agent's details and bank
// details on the agent's behalf. Reads are masked; full ID and bank numbers come only from staff_get_agent_sensitive,
// which the server allows for HR and the Director alone.
export type BankAccountType = "cheque" | "savings" | "transmission" | "business" | "other";
export type VatStatus = "not_registered" | "registered" | "pending";

export type AgentFile = {
  profile_id: string;
  full_name: string | null;
  email: string | null;
  phone_number: string | null;
  role: "partner" | "contractor" | "lead_referrer";
  is_active: boolean;
  agent_code: string | null;
  partner_linked: boolean;
  contract_type: "SAA-01" | "DRA-01" | null;
  physical_address: string | null;
  has_id_number: boolean;
  details_updated_at: string | null;
  can_view_sensitive: boolean;
  bank: null | {
    verification_status: "incomplete" | "pending_verification" | "verified" | "rejected";
    account_holder_name: string | null;
    bank_name: string | null;
    branch_code: string | null;
    account_type: BankAccountType | null;
    account_last_four: string | null;
    has_tax_number: boolean;
    vat_status: VatStatus;
    has_vat_number: boolean;
    has_banking_proof: boolean;
    rejection_reason: string | null;
    captured_by_name: string | null;
    captured_by_role: string | null;
    updated_at: string;
  };
};

export type AgentSensitive = { id_number: string | null; account_number: string | null; tax_number: string | null; vat_number: string | null };

const key = (profileId: string) => ["agent-file", profileId] as const;

export function useAgentFile(profileId: string | undefined) {
  return useQuery({
    queryKey: key(profileId ?? ""),
    enabled: Boolean(profileId),
    queryFn: async (): Promise<AgentFile> => {
      const { data, error } = await supabase.rpc("staff_get_agent_file", { p_profile: profileId });
      if (error) throw error;
      if (!data) throw new Error("Agent file not found");
      return data as AgentFile;
    },
  });
}

export type AgentDetailsInput = {
  fullName?: string | null; phone?: string | null; address?: string | null; contractType?: string | null; idNumber?: string | null;
};

export function useSaveAgentDetails(profileId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (i: AgentDetailsInput) => {
      const { data, error } = await supabase.rpc("staff_save_agent_details", {
        p_profile: profileId, p_full_name: i.fullName ?? null, p_phone_number: i.phone ?? null,
        p_physical_address: i.address ?? null, p_contract_type: i.contractType ?? null, p_id_number: i.idNumber ?? null,
      });
      if (error) throw error;
      if (!data) throw new Error("The details were not saved");
      return data as string;
    },
    onSuccess: () => client.invalidateQueries({ queryKey: key(profileId) }),
  });
}

export type AgentBankInput = {
  holder?: string | null; bank?: string | null; branch?: string | null; accountType?: BankAccountType | null;
  accountNumber?: string | null; taxNumber?: string | null; vatStatus?: VatStatus | null; vatNumber?: string | null;
};

export function useSaveAgentBank(profileId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (i: AgentBankInput) => {
      const { data, error } = await supabase.rpc("staff_save_agent_payee", {
        p_profile: profileId, p_account_holder_name: i.holder ?? null, p_bank_name: i.bank ?? null,
        p_branch_code: i.branch ?? null, p_account_type: i.accountType ?? null, p_account_number: i.accountNumber ?? null,
        p_tax_number: i.taxNumber ?? null, p_vat_status: i.vatStatus ?? null, p_vat_number: i.vatNumber ?? null,
        // Proof of banking arrives with the scanned-forms feature; until then the profile stays "incomplete".
        p_banking_proof_storage_path: null,
      });
      if (error) throw error;
      if (!data) throw new Error("The bank details were not saved");
      return data as string;
    },
    onSuccess: () => client.invalidateQueries({ queryKey: key(profileId) }),
  });
}

export function useRevealAgentSensitive(profileId: string) {
  return useMutation({
    mutationFn: async (): Promise<AgentSensitive> => {
      const { data, error } = await supabase.rpc("staff_get_agent_sensitive", { p_profile: profileId });
      if (error) throw error;
      const row = (Array.isArray(data) ? data[0] : data) as AgentSensitive | undefined;
      return row ?? { id_number: null, account_number: null, tax_number: null, vat_number: null };
    },
  });
}

// Correct an agent's type (owner, 19 Nov 2026): the Office Administrator and the Director fix a capture mistake
// (e.g. added as Direct agent instead of Sub-agent). The server refuses once the agent has leads.
export type AgentType = "direct" | "sub" | "team_leader";
export type AgentTypeState = {
  type: AgentType; organisation_id: string | null; organisation_name: string | null; has_bank_details: boolean;
  type_locked: boolean; type_locked_reason: string | null;
};

export function useAgentTypeState(profileId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["agent-type-state", profileId],
    enabled,
    queryFn: async (): Promise<AgentTypeState> => {
      const { data, error } = await supabase.rpc("staff_agent_type_state", { p_profile: profileId });
      if (error) throw error;
      return data as AgentTypeState;
    },
  });
}

export function useOrganisationOptions(enabled: boolean) {
  return useQuery({
    queryKey: ["team-leader-options"],
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<{ id: string; name: string }[]> => {
      const { data, error } = await supabase.rpc("staff_team_leader_options");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
  });
}

export function useCorrectAgent(profileId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (i: { type: AgentType; organisationId: string | null; reason: string }) => {
      const { data, error } = await supabase.rpc("staff_correct_agent", {
        p_profile: profileId, p_full_name: null, p_phone: null, p_type: i.type, p_organisation_id: i.organisationId,
        p_reason: i.reason,
      });
      if (error) throw error;
      if (!data) throw new Error("The agent was not corrected");
      return data as string;
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: key(profileId) });
      void client.invalidateQueries({ queryKey: ["agent-type-state", profileId] });
      void client.invalidateQueries({ queryKey: ["agent-onboarding"] });
    },
  });
}
