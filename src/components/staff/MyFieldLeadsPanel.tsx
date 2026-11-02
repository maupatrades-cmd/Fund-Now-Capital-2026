import { Link } from "react-router-dom";
import { card, errorText } from "@/components/staff/StaffShell";
import { LEAD_FEE_STATUS_LABEL, rand, useFieldSummary, useMyLeadFees } from "@/hooks/useFieldLeads";

// The field landing page: this month's leads (the Field Supervisor's are the whole field team's) and the person's own
// lead fees, in rand only.
export function MyFieldLeadsPanel({ supervisor }: { supervisor: boolean }) {
  const summary = useFieldSummary(true);
  const fees = useMyLeadFees(true);
  const s = summary.data;
  const tiles = [
    { label: supervisor ? "Team leads captured this month" : "Leads captured this month", value: s?.captured_mtd ?? "–" },
    { label: supervisor ? "Team ready for sale this month" : "Ready for sale this month", value: s?.ready_mtd ?? "–" },
    { label: "Open leads", value: s?.open_leads ?? "–" },
    { label: "My lead fees waiting", value: s ? rand(s.fees_pending) : "–" },
    { label: "My lead fees approved", value: s ? rand(s.fees_approved) : "–" },
  ];
  return (
    <section className={`${card} space-y-3`}>
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold text-brand-navy">{supervisor ? "Field team leads" : "My leads"}</h2>
        <Link className="text-sm font-semibold text-brand-teal underline" to="/staff/field-leads">Capture or update a lead</Link>
      </div>
      {summary.error ? <p role="alert" className="text-sm text-red-600">{errorText(summary.error)}</p> : null}
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-xl bg-slate-50 p-3">
            <dt className="text-xs text-muted-foreground">{t.label}</dt>
            <dd className="text-lg font-bold text-brand-navy">{t.value}</dd>
          </div>
        ))}
      </dl>
      {fees.data && fees.data.length ? (
        <ul className="divide-y divide-border text-sm">
          {fees.data.slice(0, 10).map((f) => (
            <li key={f.id} className="flex flex-wrap justify-between gap-2 py-1.5">
              <span>{f.business_name}</span>
              <span className="text-muted-foreground">{rand(f.amount)} · {LEAD_FEE_STATUS_LABEL[f.status]}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
