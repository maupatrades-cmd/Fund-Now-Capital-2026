import PortalShell from "@/components/portal/PortalShell";
import MyLeadsView from "@/components/portal/MyLeadsView";

export default function PartnerMyLeadsPage() {
  return (
    <PortalShell portal="partner">
      <MyLeadsView portal="partner" />
    </PortalShell>
  );
}
