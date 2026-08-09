import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/lib/useSession";

export type PartnerPortalIdentity = {
  displayName: string;
  organisationName: string;
  showBrightDestinyBrand: boolean;
};

const BRIGHT_DESTINY_NAME = /bright\s+destin/i;

export function usePartnerPortalIdentity() {
  const user = useSession()?.user;
  const uid = user?.id;

  return useQuery({
    queryKey: ["partner-portal-identity", uid],
    enabled: !!uid,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<PartnerPortalIdentity> => {
      if (!uid) throw new Error("Partner session is unavailable.");

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("full_name, referral_partner_id")
        .eq("id", uid)
        .maybeSingle();
      if (profileError) throw profileError;

      let organisationName = "Partner business";
      if (profile?.referral_partner_id) {
        const { data: partner, error: partnerError } = await supabase
          .from("referral_partners")
          .select("name")
          .eq("id", profile.referral_partner_id)
          .maybeSingle();
        if (partnerError) throw partnerError;
        if (partner?.name) organisationName = partner.name;
      }

      return {
        displayName: profile?.full_name ?? user.email?.split("@")[0] ?? "Partner",
        organisationName,
        showBrightDestinyBrand: BRIGHT_DESTINY_NAME.test(organisationName),
      };
    },
  });
}
