import PortalShell from "@/components/portal/PortalShell";
import { BrightDestinyPartnerDashboard } from "@/components/portal/BrightDestinyPartnerDashboard";
import { usePartnerPortalIdentity } from "@/hooks/usePartnerPortalIdentity";

/*
 * Partner Portal home. PortalShell keeps Fund Now Capital as the platform
 * identity while this page adds the approved Bright Destiny secondary brand.
 * Operational rows still come only from the existing caller-scoped partner
 * hooks, with anonymised funder labels and no FNC-internal commission figures.
 */

export default function PartnerHomePage() {
  const identity = usePartnerPortalIdentity();

  return (
    <PortalShell portal="partner">
      <BrightDestinyPartnerDashboard
        displayName={identity.data?.displayName ?? "Partner"}
        identityLoading={identity.isPending}
      />
    </PortalShell>
  );
}
