import PortalShell from "@/components/portal/PortalShell";
import { BadgesView } from "@/components/portal/BadgesView";

export default function ContractorBadgesPage() {
  return (
    <PortalShell portal="contractor">
      <BadgesView />
    </PortalShell>
  );
}
