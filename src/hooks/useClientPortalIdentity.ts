import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/lib/useSession";

export type ClientPortalIdentity = {
  clientId: string;
  businessName: string;
  registrationNumber: string | null;
  industry: string | null;
  contactName: string | null;
  contactEmail: string | null;
};

export function useClientPortalIdentity() {
  const session = useSession();
  const userId = session?.user.id ?? null;

  return useQuery({
    queryKey: ["client-portal-identity", userId],
    enabled: Boolean(userId),
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<ClientPortalIdentity> => {
      const { data: clientId, error: identityError } = await supabase.rpc("current_client_id");
      if (identityError) throw identityError;
      if (typeof clientId !== "string" || !clientId) {
        throw new Error("Your portal account is not linked to a client business yet.");
      }

      const [{ data: business, error: businessError }, { data: contact, error: contactError }] =
        await Promise.all([
          supabase
            .from("clients")
            .select("id,business_name,registration_number,industry")
            .eq("id", clientId)
            .single(),
          supabase
            .from("client_contacts")
            .select("full_name,email")
            .eq("client_id", clientId)
            .eq("is_primary", true)
            .maybeSingle(),
        ]);

      if (businessError) throw businessError;
      if (contactError) throw contactError;

      return {
        clientId: business.id as string,
        businessName: business.business_name as string,
        registrationNumber: (business.registration_number as string | null) ?? null,
        industry: (business.industry as string | null) ?? null,
        contactName: (contact?.full_name as string | null | undefined) ?? null,
        contactEmail:
          (contact?.email as string | null | undefined) ?? session?.user.email ?? null,
      };
    },
  });
}
