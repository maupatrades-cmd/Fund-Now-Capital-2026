import ClientPortalShell from "@/components/client-portal/ClientPortalShell";
import SharedBookingCalendar from "@/components/calendar/SharedBookingCalendar";
import { useClientPortalIdentity } from "@/hooks/useClientPortalIdentity";

export default function ClientAppointmentsPage() {
  const identity = useClientPortalIdentity();

  return (
    <ClientPortalShell>
      <SharedBookingCalendar
        tone="client"
        clientId={identity.data?.clientId ?? null}
        clientName={identity.data?.businessName ?? null}
      />
    </ClientPortalShell>
  );
}
