import PortalShell from "@/components/portal/PortalShell";
import MyLeadsView from "@/components/portal/MyLeadsView";

export default function ContractorMyLeadsPage() {
  return (
    <PortalShell portal="contractor">
      <MyLeadsView portal="contractor" />
    </PortalShell>
  );
}
