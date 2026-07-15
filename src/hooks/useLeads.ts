import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { one } from "@/hooks/useClients";

type Named = { name: string } | { name: string }[] | null;

export type LeadListRow = {
  id: string;
  business_name: string;
  contact_name: string;
  funding_amount: string | null;
  funding_timeline: string | null;
  qualification_stage: string;
  referred_by: string;
  entered_by: string | null;
  created_at: string;
  industry: Named;
};

// Full lead row + resolved display relations (all LEFT joins — every FK is
// nullable, so a null must never drop the row).
export type Lead = {
  id: string;
  business_name: string;
  entity_type: string | null;
  cipc_number: string | null;
  industry_id: string | null;
  sub_industry_id: string | null;
  sector_notes: string | null;
  website: string | null;
  trading_history_months: number | null;
  employee_range: string | null;
  monthly_turnover_range: string | null;
  annual_turnover: string | null;
  contact_name: string;
  contact_role: string | null;
  contact_cell: string | null;
  contact_email: string | null;
  contact_id_number: string | null;
  physical_address: string | null;
  registered_address: string | null;
  region: string | null;
  funding_amount: string | null;
  funding_purpose: string[];
  funding_timeline: string | null;
  has_existing_debt: boolean;
  existing_debt_details: { notes?: string } | null;
  security_available: string[];
  referred_by: string;
  referred_by_other: string | null;
  referral_partner_id: string | null;
  entered_by: string | null;
  loaded_on_behalf: boolean;
  original_referrer_id: string | null;
  initial_notes: string | null;
  qualification_stage: string;
  not_qualified_reason: string | null;
  not_qualified_notes: string | null;
  follow_up_date: string | null;
  created_at: string;
  updated_at: string;
  qualified_at: string | null;
  qualified_by: string | null;
  industry: Named;
  sub_industry: Named;
  referral_partner: Named;
  original_referrer: Named;
};

// Everything the owner form can write. entered_by is set server-side-ish by the
// create hook (current user); qualification fields are B2.2, not written here.
export type LeadInput = {
  business_name: string;
  entity_type: string | null;
  cipc_number: string | null;
  industry_id: string | null;
  sub_industry_id: string | null;
  sector_notes: string | null;
  website: string | null;
  trading_history_months: number | null;
  employee_range: string | null;
  monthly_turnover_range: string | null;
  annual_turnover: number | null;
  contact_name: string;
  contact_role: string | null;
  contact_cell: string | null;
  contact_email: string | null;
  contact_id_number: string | null;
  physical_address: string | null;
  registered_address: string | null;
  region: string | null;
  funding_amount: number | null;
  funding_purpose: string[];
  funding_timeline: string | null;
  has_existing_debt: boolean;
  existing_debt_details: { notes: string } | null;
  security_available: string[];
  referred_by: string;
  referred_by_other: string | null;
  referral_partner_id: string | null;
  loaded_on_behalf: boolean;
  original_referrer_id: string | null;
  initial_notes: string | null;
  follow_up_date: string | null;
};

export type LeadFilters = {
  qualificationStage?: string;
  referredBy?: string;
  from?: string; // ISO date (inclusive)
  to?: string; // ISO date (inclusive)
};

export function useLeads(filters: LeadFilters = {}) {
  return useQuery({
    queryKey: ["leads", filters],
    queryFn: async (): Promise<LeadListRow[]> => {
      let q = supabase
        .from("leads")
        .select(
          `id, business_name, contact_name, funding_amount, funding_timeline,
           qualification_stage, referred_by, entered_by, created_at,
           industry:industries!left(name)`,
        )
        .order("created_at", { ascending: false });

      if (filters.qualificationStage) q = q.eq("qualification_stage", filters.qualificationStage);
      if (filters.referredBy) q = q.eq("referred_by", filters.referredBy);
      if (filters.from) q = q.gte("created_at", filters.from);
      // `to` is a date; include the whole day by comparing against the next midnight.
      if (filters.to) q = q.lt("created_at", `${filters.to}T23:59:59.999Z`);

      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as LeadListRow[];
    },
  });
}

export function useLead(id: string | undefined) {
  return useQuery({
    queryKey: ["lead", id],
    enabled: !!id,
    queryFn: async (): Promise<Lead> => {
      // industry / sub_industry: single FK each → explicit !left.
      // referral_partner / original_referrer: leads has TWO FKs to
      // referral_partners, so each embed is disambiguated by its FK constraint
      // name. FK-hinted embeds still default to a LEFT join, so a null referrer
      // never drops the lead row.
      const { data, error } = await supabase
        .from("leads")
        .select(
          `*,
           industry:industries!left(name),
           sub_industry:sub_industries!left(name),
           referral_partner:referral_partners!leads_referral_partner_id_fkey(name),
           original_referrer:referral_partners!leads_original_referrer_id_fkey(name)`,
        )
        .eq("id", id!)
        .single();
      if (error) throw error;
      return data as unknown as Lead;
    },
  });
}

// Owner-visible profile names (id -> full_name) for the "Entered by" column.
// entered_by FKs to auth.users, which PostgREST can't embed, so resolve via
// profiles (owner RLS can read all profiles).
export function useProfileNames() {
  return useQuery({
    queryKey: ["profile-names"],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Record<string, string>> => {
      const { data, error } = await supabase.from("profiles").select("id, full_name");
      if (error) throw error;
      const map: Record<string, string> = {};
      for (const p of (data ?? []) as { id: string; full_name: string | null }[]) {
        if (p.full_name) map[p.id] = p.full_name;
      }
      return map;
    },
  });
}

export function useCreateLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: LeadInput): Promise<Lead> => {
      const { data: userData } = await supabase.auth.getUser();
      const enteredBy = userData.user?.id ?? null;
      const { data, error } = await supabase
        .from("leads")
        .insert({ ...input, entered_by: enteredBy })
        .select()
        .single();
      if (error) throw error;
      return data as unknown as Lead;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["leads"] }),
  });
}

export function useUpdateLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: Partial<LeadInput> }): Promise<Lead> => {
      const { data, error } = await supabase
        .from("leads")
        .update(input)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data as unknown as Lead;
    },
    onSuccess: (lead) => {
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["lead", lead.id] });
    },
  });
}

export { one };
