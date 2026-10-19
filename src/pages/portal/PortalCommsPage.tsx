import PortalShell from "@/components/portal/PortalShell";
import { LeadReferrerShell } from "@/components/lead-referrer/LeadReferrerShell";
import { NoticesInbox } from "@/components/comms/NoticesInbox";
import { MessagesPanel } from "@/components/comms/MessagesPanel";

// Notices for sub-agents and Team Leaders, and messages to the Sales Coordinator for sub-agents (owner spec §8–9).
// The database decides who receives what; these pages only show it.
type Portal = "partner" | "contractor" | "lead_referrer";

function Notices() {
  return (
    <section className="space-y-3 rounded-2xl border border-border bg-white p-5 shadow-sm">
      <h1 className="text-lg font-bold text-brand-navy">Notices</h1>
      <p className="text-sm text-muted-foreground">Notices from Fund Now Capital. Please acknowledge any marked "Needs attention".</p>
      <NoticesInbox />
    </section>
  );
}

export default function PortalCommsPage({ portal, page }: { portal: Portal; page: "notices" | "messages" }) {
  const content = page === "notices" ? <Notices /> : <MessagesPanel />;
  if (portal === "lead_referrer") return <LeadReferrerShell>{content}</LeadReferrerShell>;
  return <PortalShell portal={portal}>{content}</PortalShell>;
}
