import PortalShell from "@/components/portal/PortalShell";
import LeadSubmitForm from "@/components/portal/LeadSubmitForm";

export default function ContractorSubmitLeadPage() {
  return (
    <PortalShell portal="contractor">
      <LeadSubmitForm portal="contractor" />
    </PortalShell>
  );
}
