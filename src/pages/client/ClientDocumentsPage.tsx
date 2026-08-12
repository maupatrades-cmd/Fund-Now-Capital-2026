import { Files } from "lucide-react";
import ClientPortalPlaceholder from "@/components/client-portal/ClientPortalPlaceholder";

export default function ClientDocumentsPage() {
  return <ClientPortalPlaceholder eyebrow="Smart checklist" title="Your documents" description="See exactly what is required, upload securely and follow Owner verification without exposing private funder information." icon={Files} />;
}
