import PortalShell from "@/components/portal/PortalShell";
import PaymentSettingsView from "@/components/portal/PaymentSettingsView";

// Partner portal payment details (/partner/settings/payment).
export default function PartnerPaymentSettingsPage() {
  return (
    <PortalShell portal="partner">
      <PaymentSettingsView portal="partner" />
    </PortalShell>
  );
}
