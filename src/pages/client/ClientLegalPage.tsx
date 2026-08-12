import { FileSignature } from "lucide-react";
import ClientPortalPlaceholder from "@/components/client-portal/ClientPortalPlaceholder";

export default function ClientLegalPage() {
  return <ClientPortalPlaceholder eyebrow="Legal package" title="Review and sign" description="Review your current mandate, NDA and consent documents, provide informed consent and download executed copies." icon={FileSignature} />;
}
