import PortalShell from "@/components/portal/PortalShell";
import NotificationPreferencesMatrix from "@/components/notifications/NotificationPreferencesMatrix";

// Contractor portal notification preferences (/contractor/settings/notifications).
// Same shared matrix as the owner + partner, scoped to the contractor role. RLS
// + the DEFINER RPCs keep each user editing strictly their own preferences
// (POPIA cross-role isolation).
export default function ContractorNotificationSettingsPage() {
  return (
    <PortalShell portal="contractor">
      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-brand-navy">Notification preferences</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Choose how you're notified per event. In-app and email are live; WhatsApp and SMS are
            coming in a later phase.
          </p>
        </div>
        <NotificationPreferencesMatrix role="contractor" />
      </div>
    </PortalShell>
  );
}
