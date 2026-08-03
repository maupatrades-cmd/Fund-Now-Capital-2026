import PortalShell from "@/components/portal/PortalShell";
import PartnerInvoicesView from "@/components/portal/PartnerInvoicesView";

// Partner "My Invoices" landing (/partner/invoices). Doctor invoices FNC for the
// commission he's owed; he sees his own take only + fictional funder names (S7C).
export default function PartnerInvoicesPage() {
  return (
    <PortalShell portal="partner">
      <PartnerInvoicesView />
    </PortalShell>
  );
}
