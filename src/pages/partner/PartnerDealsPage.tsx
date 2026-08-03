import PortalShell from "@/components/portal/PortalShell";
import MyDealsList from "@/components/portal/MyDealsList";

export default function PartnerDealsPage() {
  return (
    <PortalShell portal="partner">
      <MyDealsList portal="partner" />
    </PortalShell>
  );
}
