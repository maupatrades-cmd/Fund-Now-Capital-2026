import { CalendarClock, CircleCheck, Coins, LockKeyhole } from "lucide-react";
import { Link } from "react-router-dom";
import { formatZAR } from "@/lib/format";
import { useQualifiedRewardPayroll } from "@/hooks/useQualifiedRewardPayroll";

export function QualifiedRewardSummary({ href }: { href: string }) {
  const query = useQualifiedRewardPayroll();
  const rows = query.data ?? [];
  const locked = rows.filter((row) => row.current_status === "locked").length;
  const pending = rows.filter((row) => ["scheduled", "held", "released", "carried_forward"].includes(row.current_status)).length;
  const paid = rows.filter((row) => row.current_status === "paid").length;

  return (
    <section className="rounded-xl border border-border bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-semibold text-brand-navy"><Coins className="h-5 w-5 text-brand-teal" />R100 qualification rewards</h2>
          <p className="mt-1 text-xs text-muted-foreground">Separate from commission. Locked once only after approved full documents reach a funder.</p>
        </div>
        <Link to={href} className="text-sm font-semibold text-brand-teal hover:underline">View reward history</Link>
      </div>
      {query.isLoading ? <p className="mt-4 text-sm text-muted-foreground">Loading rewards…</p> : null}
      {query.isError ? <p className="mt-4 text-sm text-red-700">Rewards are temporarily unavailable.</p> : null}
      {!query.isLoading && !query.isError ? (
        <div className="mt-4 grid grid-cols-3 gap-2">
          <Stat icon={LockKeyhole} label="Locked" value={formatZAR(locked * 100)} />
          <Stat icon={CalendarClock} label="Pending" value={formatZAR(pending * 100)} />
          <Stat icon={CircleCheck} label="Paid" value={formatZAR(paid * 100)} />
        </div>
      ) : null}
    </section>
  );
}

function Stat({ icon: Icon, label, value }: { icon: typeof Coins; label: string; value: string }) {
  return <div className="rounded-lg bg-slate-50 p-3"><Icon className="h-4 w-4 text-brand-teal" /><p className="mt-2 text-xs text-muted-foreground">{label}</p><p className="text-sm font-bold text-brand-navy">{value}</p></div>;
}
