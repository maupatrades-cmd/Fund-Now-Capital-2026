import PortalShell from "@/components/portal/PortalShell";
import PaymentSettingsView from "@/components/portal/PaymentSettingsView";

// Contractor portal payment details (/contractor/settings/payment).
export default function ContractorPaymentSettingsPage() {
  return (
    <PortalShell portal="contractor">
      <PaymentSettingsView portal="contractor" />
    </PortalShell>
  );
}
