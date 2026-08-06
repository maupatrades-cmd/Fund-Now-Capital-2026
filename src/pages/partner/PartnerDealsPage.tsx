import PortalShell from "@/components/portal/PortalShell";
import PortalDealPipeline from "@/components/portal/PortalDealPipeline";

export default function PartnerDealsPage() {
  return (
    <PortalShell portal="partner">
      <PortalDealPipeline portal="partner" title="My Doctor pipeline" />
    </PortalShell>
  );
}
