import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export type Funder = {
  id: string;
  name: string;
  display_name_for_partner: string;
  funder_type: string | null;
  agreement_status: string | null;
  ticket_min: number | string | null;
  ticket_max: number | string | null;
  is_active: boolean;
  // C0.3: true when FNC has a signed agreement with this funder. Only contracted
  // funders can carry rate structures + be invoiced. short_code feeds the C1
  // invoice payment reference (POLLEN → POLLEN-INV0032-CHICKANOS).
  is_contracted: boolean;
  short_code: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type FunderContact = {
  id: string;
  funder_id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  position: string | null;
  created_at: string;
};

// Payload for create/update — only the owner-editable columns.
// is_contracted / short_code are optional: the funder create/edit form
// (FunderFormPage) omits them, so they fall to their DB defaults (false / null);
// the /settings/funders rate page sets them via a partial update.
export type FunderInput = {
  name: string;
  display_name_for_partner: string;
  funder_type: string | null;
  agreement_status: string | null;
  ticket_min: number | null;
  ticket_max: number | null;
  is_active: boolean;
  notes: string | null;
  is_contracted?: boolean;
  short_code?: string | null;
};

export function useFunders() {
  return useQuery({
    queryKey: ["funders"],
    queryFn: async (): Promise<Funder[]> => {
      const { data, error } = await supabase
        .from("funders")
        .select("*")
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Funder[];
    },
  });
}

export function useFunder(id: string | undefined) {
  return useQuery({
    queryKey: ["funder", id],
    enabled: !!id,
    queryFn: async (): Promise<Funder> => {
      const { data, error } = await supabase
        .from("funders")
        .select("*")
        .eq("id", id!)
        .single();
      if (error) throw error;
      return data as Funder;
    },
  });
}

export function useFunderContacts(funderId: string | undefined) {
  return useQuery({
    queryKey: ["funder-contacts", funderId],
    enabled: !!funderId,
    queryFn: async (): Promise<FunderContact[]> => {
      const { data, error } = await supabase
        .from("funder_contacts")
        .select("*")
        .eq("funder_id", funderId!)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as FunderContact[];
    },
  });
}

export function useCreateFunder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: FunderInput): Promise<Funder> => {
      const { data, error } = await supabase
        .from("funders")
        .insert(input)
        .select()
        .single();
      if (error) throw error;
      return data as Funder;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["funders"] }),
  });
}

export function useUpdateFunder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      input,
    }: {
      id: string;
      input: Partial<FunderInput>;
    }): Promise<Funder> => {
      const { data, error } = await supabase
        .from("funders")
        .update(input)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data as Funder;
    },
    onSuccess: (funder) => {
      qc.invalidateQueries({ queryKey: ["funders"] });
      qc.invalidateQueries({ queryKey: ["funder", funder.id] });
    },
  });
}

export function useAddFunderContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      contact: Omit<FunderContact, "id" | "created_at">,
    ): Promise<FunderContact> => {
      const { data, error } = await supabase
        .from("funder_contacts")
        .insert(contact)
        .select()
        .single();
      if (error) throw error;
      return data as FunderContact;
    },
    onSuccess: (c) =>
      qc.invalidateQueries({ queryKey: ["funder-contacts", c.funder_id] }),
  });
}

export function useDeleteFunderContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string; funderId: string }) => {
      const { error } = await supabase.from("funder_contacts").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_data, vars) =>
      qc.invalidateQueries({ queryKey: ["funder-contacts", vars.funderId] }),
  });
}
