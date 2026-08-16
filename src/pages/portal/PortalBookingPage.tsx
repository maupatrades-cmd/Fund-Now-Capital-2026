import SharedBookingCalendar from "@/components/calendar/SharedBookingCalendar";
import PortalShell, { type PortalKind } from "@/components/portal/PortalShell";

export default function PortalBookingPage({ portal }: { portal: PortalKind }) {
  return (
    <PortalShell portal={portal}>
      <SharedBookingCalendar />
    </PortalShell>
  );
}
