import { UserRoundCog } from "lucide-react";
import ClientPortalPlaceholder from "@/components/client-portal/ClientPortalPlaceholder";

export default function ClientProfilePage() {
  return <ClientPortalPlaceholder eyebrow="Secure profile" title="Your business and contact details" description="Review the identity linked to your portal and request corrections without silently changing verified CRM data." icon={UserRoundCog} />;
}
