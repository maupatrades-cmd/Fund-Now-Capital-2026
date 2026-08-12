import { BadgeCheck } from "lucide-react";
import ClientPortalPlaceholder from "@/components/client-portal/ClientPortalPlaceholder";

export default function ClientOffersPage() {
  return <ClientPortalPlaceholder eyebrow="Funding decisions" title="Review your outcomes" description="View client-safe decision summaries and acknowledge the next step once the Owner publishes an outcome." icon={BadgeCheck} />;
}
