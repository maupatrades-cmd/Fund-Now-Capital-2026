import NotificationPreferencesMatrix from "@/components/notifications/NotificationPreferencesMatrix";

// Owner notification preferences (/settings/notifications). Renders the shared
// matrix scoped to the owner role (sees every event). Partner and contractor
// portals render the same component with their own role.
export default function NotificationPreferencesPage() {
  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-brand-navy">Notification preferences</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose how you're notified per event. In-app and email are live; WhatsApp and SMS are
          coming in a later phase.
        </p>
      </div>

      <NotificationPreferencesMatrix role="owner" />
    </div>
  );
}
