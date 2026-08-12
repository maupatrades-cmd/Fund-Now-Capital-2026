import { ClipboardList } from "lucide-react";
import ClientPortalPlaceholder from "@/components/client-portal/ClientPortalPlaceholder";

export default function ClientApplicationPage() {
  return <ClientPortalPlaceholder eyebrow="Funding application" title="Build your funding request" description="Complete a guided application that saves as you go and adapts to your selected funding product." icon={ClipboardList} />;
}
