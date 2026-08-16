import SharedBookingCalendar from "@/components/calendar/SharedBookingCalendar";
import { LeadReferrerShell } from "@/components/lead-referrer/LeadReferrerShell";

export default function LeadReferrerBookingPage() {
  return (
    <LeadReferrerShell>
      <SharedBookingCalendar />
    </LeadReferrerShell>
  );
}
