import PortalShell from "@/components/portal/PortalShell";
import PortalDealPipeline from "@/components/portal/PortalDealPipeline";

export default function ContractorDealsPage() {
  return (
    <PortalShell portal="contractor">
      <PortalDealPipeline portal="contractor" title="My contractor pipeline" />
    </PortalShell>
  );
}
