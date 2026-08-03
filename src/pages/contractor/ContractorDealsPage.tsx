import PortalShell from "@/components/portal/PortalShell";
import MyDealsList from "@/components/portal/MyDealsList";

export default function ContractorDealsPage() {
  return (
    <PortalShell portal="contractor">
      <MyDealsList portal="contractor" />
    </PortalShell>
  );
}
