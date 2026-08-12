import { CalendarDays } from "lucide-react";
import ClientPortalPlaceholder from "@/components/client-portal/ClientPortalPlaceholder";

export default function ClientAppointmentsPage() {
  return <ClientPortalPlaceholder eyebrow="Owner calendar" title="Book time with Fund Now Capital" description="Request an available consultation, presentation, call or paperwork-review slot with the Owner." icon={CalendarDays} />;
}
