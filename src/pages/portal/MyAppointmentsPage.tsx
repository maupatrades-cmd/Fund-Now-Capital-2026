import { useMemo } from "react";
import PortalShell, { type PortalKind } from "@/components/portal/PortalShell";
import { LeadReferrerShell } from "@/components/lead-referrer/LeadReferrerShell";
import { TeamAppointmentsList } from "@/components/team-diary/TeamAppointmentsList";
import { useTeamAppointments } from "@/hooks/useTeamDiary";

// "My appointments" for direct agents, sub-agents, Team Leaders and partners: client meetings the Sales
// Coordinator or Reception booked on your diary. You can move or cancel one; the client is emailed.

function Content() {
  const range = useMemo(() => {
    const from = new Date(); from.setDate(from.getDate() - 7); from.setHours(0, 0, 0, 0);
    const to = new Date(from); to.setDate(to.getDate() + 90);
    return { from: from.toISOString(), to: to.toISOString() };
  }, []);
  const list = useTeamAppointments(null, range.from, range.to);
  return (
    <section className="space-y-3 rounded-2xl border border-border bg-white p-5 shadow-sm">
      <div>
        <h1 className="text-lg font-bold text-brand-navy">My appointments</h1>
        <p className="text-sm text-muted-foreground">
          Client meetings booked for you by Fund Now Capital. If you move or cancel one, the client is emailed automatically.
        </p>
      </div>
      {list.error ? <p role="alert" className="text-sm text-red-600">{(list.error as Error).message}</p> : null}
      {list.data ? <TeamAppointmentsList rows={list.data} showMember={false} /> : <p className="text-sm text-muted-foreground">Loading…</p>}
    </section>
  );
}

export default function MyAppointmentsPage({ portal }: { portal: PortalKind | "lead_referrer" }) {
  if (portal === "lead_referrer") return <LeadReferrerShell><Content /></LeadReferrerShell>;
  return <PortalShell portal={portal}><Content /></PortalShell>;
}
