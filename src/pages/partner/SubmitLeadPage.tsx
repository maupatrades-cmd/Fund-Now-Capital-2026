import PortalShell from "@/components/portal/PortalShell";
import LeadSubmitForm from "@/components/portal/LeadSubmitForm";

export default function PartnerSubmitLeadPage() {
  return (
    <PortalShell portal="partner">
      <LeadSubmitForm portal="partner" />
    </PortalShell>
  );
}
