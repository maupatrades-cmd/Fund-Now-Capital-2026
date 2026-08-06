import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { invalidateActivity } from "@/hooks/useActivity";

type Named = { name: string } | { name: string }[] | null;

export function one<T>(rel: T | T[] | null): T | null {
  return Array.isArray(rel) ? (rel[0] ?? null) : (rel ?? null);
}

export type ClientListRow = {
  id: string;
  business_name: string;
  sector: string | null;
  monthly_turnover: string | null;
  referral_partner_id: string | null;
  created_at: string;
  referral_partner: Named;
  contacts: { full_name: string; position: string | null; is_primary_director: boolean }[];
  deals: { count: number }[];
};

export type Client = {
  id: string;
  business_name: string;
  cipc_number: string | null;
  sector: string | null; // legacy free-text; deprecated in favour of industry_id (B1). Kept for manual reconciliation.
  sector_notes: string | null;
  industry_id: string | null;
  sub_industry_id: string | null;
  monthly_turnover: string | null;
  address: string | null;
  referral_partner_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  industry: Named;
  sub_industry: Named;
};

export type ClientContact = {
  id: string;
  client_id: string;
  full_name: string;
  position: string | null;
  phone: string | null;
  email: string | null;
  id_number: string | null;
  is_primary_director: boolean;
  created_at: string;
};

export type ClientInput = {
  business_name: string;
  cipc_number: string | null;
  sector: string | null;
  sector_notes: string | null;
  industry_id: string | null;
  sub_industry_id: string | null;
  monthly_turnover: number | null;
  address: string | null;
  referral_partner_id: string | null;
  notes: string | null;
};

export type ContactInput = Omit<ClientContact, "id" | "client_id" | "created_at">;

export function useReferralPartners() {
  return useQuery({
    queryKey: ["referral-partners"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("referral_partners")
        .select("id, name, slug")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string; slug: string | null }[];
    },
  });
}

export function useClients() {
  return useQuery({
    queryKey: ["clients"],
    queryFn: async (): Promise<ClientListRow[]> => {
      const { data, error } = await supabase
        .from("clients")
        .select(
          `id, business_name, sector, monthly_turnover, referral_partner_id, created_at,
           referral_partner:referral_partners(name),
           contacts:client_contacts(full_name, position, is_primary_director),
           deals:deals(count)`,
        )
        .order("business_name");
      if (error) throw error;
      return (data ?? []) as unknown as ClientListRow[];
    },
  });
}

export function useClient(id: string | undefined) {
  return useQuery({
    queryKey: ["client", id],
    enabled: !!id,
    queryFn: async (): Promise<Client> => {
      // Use LEFT joins (!left) so legacy clients without industry_id (created
      // pre-B1) still load — manual industry assignment surfaces the dropdown for
      // the owner to set. (PostgREST embeds default to LEFT; !left makes it
      // explicit and guards against a later switch to !inner, which would hide
      // those rows.)
      const { data, error } = await supabase
        .from("clients")
        .select("*, industry:industries!left(name), sub_industry:sub_industries!left(name)")
        .eq("id", id!)
        .single();
      if (error) throw error;
      return data as unknown as Client;
    },
  });
}

export type ClientDeal = { id: string; reference: string | null; stage: string; created_at: string; amount_requested: string | null };

export function useClientDeals(clientId: string | undefined) {
  return useQuery({
    queryKey: ["client-deals", clientId],
    enabled: !!clientId,
    queryFn: async (): Promise<ClientDeal[]> => {
      const { data, error } = await supabase.from("deals")
        .select("id,reference,stage,created_at,amount_requested")
        .eq("client_id", clientId!).order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ClientDeal[];
    },
  });
}

export function useClientContacts(clientId: string | undefined) {
  return useQuery({
    queryKey: ["client-contacts", clientId],
    enabled: !!clientId,
    queryFn: async (): Promise<ClientContact[]> => {
      const { data, error } = await supabase
        .from("client_contacts")
        .select("*")
        .eq("client_id", clientId!)
        .order("is_primary_director", { ascending: false })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as ClientContact[];
    },
  });
}

export function useCreateClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ClientInput): Promise<Client> => {
      const { data, error } = await supabase.from("clients").insert(input).select().single();
      if (error) throw error;
      return data as unknown as Client;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["clients"] });
      invalidateActivity(qc);
    },
  });
}

export function useUpdateClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      input,
    }: {
      id: string;
      input: Partial<ClientInput>;
    }): Promise<Client> => {
      const { data, error } = await supabase
        .from("clients")
        .update(input)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data as unknown as Client;
    },
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ["clients"] });
      qc.invalidateQueries({ queryKey: ["client", c.id] });
      invalidateActivity(qc);
    },
  });
}

// One candidate match from find_client_duplicates (B5.2). severity 'block' is the
// CIPC-vs-client hard stop (the server rejects it too); 'warn' is advisory.
export type ClientDuplicate = {
  match_kind: "cipc" | "name";
  severity: "block" | "warn";
  entity: "client" | "lead";
  entity_id: string;
  business_name: string;
  similarity: number;
};

export type ClientDuplicateCheckArgs = {
  business_name: string;
  cipc_number?: string | null;
  exclude_client_id?: string | null;
};

export function useCheckClientDuplicates() {
  return useMutation({
    mutationFn: async (args: ClientDuplicateCheckArgs): Promise<ClientDuplicate[]> => {
      const { data, error } = await supabase.rpc("find_client_duplicates", {
        p_business_name: args.business_name,
        p_cipc: args.cipc_number ?? null,
        p_exclude_client_id: args.exclude_client_id ?? null,
      });
      if (error) throw error;
      return (data ?? []) as ClientDuplicate[];
    },
  });
}

export function useSaveClientContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      clientId,
      contactId,
      input,
    }: {
      clientId: string;
      contactId?: string;
      input: ContactInput;
    }): Promise<ClientContact> => {
      if (contactId) {
        const { data, error } = await supabase
          .from("client_contacts")
          .update(input)
          .eq("id", contactId)
          .select()
          .single();
        if (error) throw error;
        return data as ClientContact;
      }
      const { data, error } = await supabase
        .from("client_contacts")
        .insert({ ...input, client_id: clientId })
        .select()
        .single();
      if (error) throw error;
      return data as ClientContact;
    },
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ["client-contacts", c.client_id] });
      invalidateActivity(qc);
    },
  });
}

export function useDeleteClientContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string; clientId: string }) => {
      const { error } = await supabase.from("client_contacts").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["client-contacts", vars.clientId] });
      invalidateActivity(qc);
    },
  });
}
