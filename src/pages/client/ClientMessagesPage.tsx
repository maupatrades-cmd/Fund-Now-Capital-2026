import { MessagesSquare } from "lucide-react";
import ClientPortalPlaceholder from "@/components/client-portal/ClientPortalPlaceholder";

export default function ClientMessagesPage() {
  return <ClientPortalPlaceholder eyebrow="Support" title="One clear conversation" description="See operational updates and contact the Fund Now Capital team from one secure place." icon={MessagesSquare} />;
}
