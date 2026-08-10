import PortalShell from "@/components/portal/PortalShell";
import ContractorInvoicesView from "@/components/portal/ContractorInvoicesView";

// Contractor invoices — his own invoices to Fund Now Capital for payable
// commission (Build 9). Amounts are his take only; no FNC gross / funder / tier
// data (S7C).
export default function ContractorInvoicesPage() {
  return (
    <PortalShell portal="contractor">
      <ContractorInvoicesView />
    </PortalShell>
  );
}
