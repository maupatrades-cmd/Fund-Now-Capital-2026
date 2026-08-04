import PortalShell from "@/components/portal/PortalShell";
import { BadgeCollectionView } from "@/components/portal/BadgeCollectionView";

export default function ContractorBadgesPage() {
  return (
    <PortalShell portal="contractor">
      <BadgeCollectionView portal="contractor" />
    </PortalShell>
  );
}
