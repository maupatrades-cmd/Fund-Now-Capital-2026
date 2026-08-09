import { useQuery } from "@tanstack/react-query";
import PortalShell from "@/components/portal/PortalShell";
import { BrightDestinyPartnerDashboard } from "@/components/portal/BrightDestinyPartnerDashboard";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/lib/useSession";

/*
 * Partner Portal home. PortalShell keeps Fund Now Capital as the platform
 * identity while this page adds the approved Bright Destiny secondary brand.
 * Operational rows still come only from the existing caller-scoped partner
 * hooks, with anonymised funder labels and no FNC-internal commission figures.
 */

// The query key carries the user id so a different account signing in on the
// same tab can never be served the previous partner's cached organisation name.
function usePartnerName(user: { id: string; email?: string } | undefined) {
  const uid = user?.id;
  return useQuery({
    queryKey: ["partner-name", uid],
    enabled: !!uid,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<string | null> => {
      if (!uid) return null;

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("full_name, referral_partner_id")
        .eq("id", uid)
        .maybeSingle();
      if (profileError) throw profileError;

      if (profile?.referral_partner_id) {
        const { data: partner, error: partnerError } = await supabase
          .from("referral_partners")
          .select("name")
          .eq("id", profile.referral_partner_id)
          .maybeSingle();
        if (partnerError) throw partnerError;
        if (partner?.name) return partner.name;
      }

      return profile?.full_name ?? user?.email?.split("@")[0] ?? null;
    },
  });
}

export default function PartnerHomePage() {
  const session = useSession();
  const { data: partnerName, isPending } = usePartnerName(session?.user);
  const organisationName = partnerName ?? "Partner business";

  return (
    <PortalShell portal="partner">
      <BrightDestinyPartnerDashboard
        displayName={partnerName ?? "Partner"}
        organisationName={organisationName}
        showBrightDestinyBrand={/bright\s+destin/i.test(organisationName)}
        identityLoading={isPending}
      />
    </PortalShell>
  );
}
