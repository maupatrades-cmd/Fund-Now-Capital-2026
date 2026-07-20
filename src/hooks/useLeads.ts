import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { invalidateActivity } from "@/hooks/useActivity";

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
  // Deal(s) created from this lead on qualify (one-per-lead by unique index).
  linked_deals: { id: string; reference: string | null; stage: string }[];
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

// One candidate match from find_lead_duplicates (B2.3). severity 'block' is the
// CIPC-vs-lead hard stop (the server rejects it too); 'warn' is advisory.
export type LeadDuplicate = {
  match_kind: "cipc" | "name" | "email" | "cell";
  severity: "block" | "warn";
  entity: "lead" | "client";
  entity_id: string;
  business_name: string;
  similarity: number;
};

export type DuplicateCheckArgs = {
  business_name: string;
  cipc_number?: string | null;
  contact_email?: string | null;
  contact_cell?: string | null; // already normalised (0XXXXXXXXX)
  exclude_lead_id?: string | null;
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

      // "awaiting" is a quick-filter spanning both pre-decision stages.
      if (filters.qualificationStage === "awaiting") {
        q = q.in("qualification_stage", ["new_lead", "under_qualification"]);
      } else if (filters.qualificationStage) {
        q = q.eq("qualification_stage", filters.qualificationStage);
      }
      if (filters.referredBy) q = q.eq("referred_by", filters.referredBy);
      // Date filters are calendar days in SAST (UTC+2, no DST). Anchor both
      // bounds to SAST midnight so a lead created in the first ~2 hours of a
      // local day isn't dropped: from = start of that SAST day; to = exclusive
      // upper bound at the start of the following SAST day.
      if (filters.from) q = q.gte("created_at", `${filters.from}T00:00:00+02:00`);
      if (filters.to) {
        // Advance the parsed SAST instant by one day in UTC terms (setUTCDate,
        // not setDate) so the cutoff can't drift by an hour in a browser whose
        // local zone observes DST.
        const end = new Date(`${filters.to}T00:00:00+02:00`);
        end.setUTCDate(end.getUTCDate() + 1);
        q = q.lt("created_at", end.toISOString());
      }

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
           original_referrer:referral_partners!leads_original_referrer_id_fkey(name),
           linked_deals:deals!deals_lead_id_fkey(id, reference, stage)`,
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

// Advisory duplicate lookup (B2.3). Returns candidate matches; the caller (the
// Add-Lead form) hard-blocks on any severity='block' and requires typed
// confirmation on 'warn' rows. The DB also independently rejects a CIPC-vs-lead
// collision, so a bypassed warning can never create a CIPC duplicate.
export function useCheckLeadDuplicates() {
  return useMutation({
    mutationFn: async (args: DuplicateCheckArgs): Promise<LeadDuplicate[]> => {
      const { data, error } = await supabase.rpc("find_lead_duplicates", {
        p_business_name: args.business_name,
        p_cipc: args.cipc_number ?? null,
        p_email: args.contact_email ?? null,
        p_cell: args.contact_cell ?? null,
        p_exclude_lead_id: args.exclude_lead_id ?? null,
      });
      if (error) throw error;
      return (data ?? []) as LeadDuplicate[];
    },
  });
}

export function useCreateLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: LeadInput): Promise<Lead> => {
      // entered_by is authoritative in the DB: the column defaults to auth.uid()
      // and a restrictive INSERT policy (leads_entered_by_is_caller) requires
      // entered_by = auth.uid(), so it can't be spoofed from the client.
      const { data, error } = await supabase
        .from("leads")
        .insert(input)
        .select()
        .single();
      if (error) throw error;
      return data as unknown as Lead;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["leads"] });
      invalidateActivity(qc); // the leads trigger writes an activity row (B2.3)
    },
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
      invalidateActivity(qc);
    },
  });
}

// ---- Qualification workflow (B2.2) ----

// new_lead -> under_qualification. Guarded to only fire from new_lead so a stale
// button can't skip stages; the returned-row check surfaces a no-op loudly.
export function useStartQualifying() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase
        .from("leads")
        .update({ qualification_stage: "under_qualification" })
        .eq("id", id)
        .eq("qualification_stage", "new_lead")
        .select("id");
      if (error) throw error;
      if (!data?.length) throw new Error("Lead was not updated — it may have already moved on.");
    },
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: ["lead", id] });
      qc.invalidateQueries({ queryKey: ["leads"] });
      invalidateActivity(qc);
    },
  });
}

// The document verification gate (B3.2): the human labels of required categories
// still missing accepted documents on this lead. Empty array ⇒ ready to qualify.
// Drives the disabled Qualify button + tooltip; the RPC is the same rule the
// qualify_lead server-side gate enforces.
export function useLeadRequiredDocsMissing(leadId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ["lead-required-docs-missing", leadId],
    enabled: !!leadId && enabled,
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await supabase.rpc("lead_required_docs_missing", { p_lead_id: leadId });
      if (error) throw error;
      return (data ?? []) as string[];
    },
  });
}

// The jsonb audit shape qualify_lead returns (B5.2). match_kind is 'cipc'/'name'
// when the lead re-pointed onto an existing client, null for a genuinely new
// client, 'idempotent' on a re-qualify. The migrated counts show the re-point
// triggers actually fired.
export type QualifyResult = {
  deal_id: string;
  deal_reference: string | null;
  client_id: string;
  client_business_name: string | null;
  matched_existing: boolean;
  match_kind: "cipc" | "name" | "idempotent" | null;
  stakeholder_count_migrated: number;
  document_count_migrated: number;
  story_count_migrated: number;
  story_notes_count_migrated: number;
};

// Qualify → atomic client + deal creation via the qualify_lead RPC. Returns the
// audit jsonb (Path A: re-points onto an existing client matched by CIPC or name
// rather than duplicating). When the document gate isn't met the RPC rejects
// unless `override` is passed (which also writes an activity_logs audit row).
export function useQualifyLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, override }: { id: string; override?: boolean }): Promise<QualifyResult> => {
      const { data, error } = await supabase.rpc("qualify_lead", {
        p_lead_id: id,
        p_override: override ?? false,
      });
      if (error) throw error;
      if (!data) throw new Error("Qualification did not return a result");
      return data as QualifyResult;
    },
    onSuccess: (_result, { id }) => {
      qc.invalidateQueries({ queryKey: ["lead", id] });
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["deals"] });
      qc.invalidateQueries({ queryKey: ["lead-required-docs-missing", id] });
      invalidateActivity(qc);
    },
  });
}

// Mark not qualified with a reason (+ optional notes). The DB trigger stamps
// qualified_at / qualified_by and rejects a null reason.
export function useMarkNotQualified() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reason, notes }: { id: string; reason: string; notes: string | null }) => {
      const { data, error } = await supabase
        .from("leads")
        .update({
          qualification_stage: "not_qualified",
          not_qualified_reason: reason,
          not_qualified_notes: notes,
        })
        .eq("id", id)
        .select("id");
      if (error) throw error;
      if (!data?.length) throw new Error("Lead was not updated");
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["lead", vars.id] });
      qc.invalidateQueries({ queryKey: ["leads"] });
      invalidateActivity(qc);
    },
  });
}
