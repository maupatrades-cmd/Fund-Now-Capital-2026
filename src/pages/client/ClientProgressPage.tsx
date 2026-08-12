import { Milestone } from "lucide-react";
import ClientPortalPlaceholder from "@/components/client-portal/ClientPortalPlaceholder";

export default function ClientProgressPage() {
  return <ClientPortalPlaceholder eyebrow="Live progress" title="Follow your funding journey" description="Track application, document review, funder matching and decision milestones in clear client-safe language." icon={Milestone} />;
}
