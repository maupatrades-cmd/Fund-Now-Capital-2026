import PortalShell from "@/components/portal/PortalShell";
import { BadgeCollectionView } from "@/components/portal/BadgeCollectionView";

export default function PartnerBadgesPage() {
  return (
    <PortalShell portal="partner">
      <BadgeCollectionView portal="partner" />
    </PortalShell>
  );
}
