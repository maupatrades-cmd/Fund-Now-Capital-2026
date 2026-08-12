import { useQuery } from "@tanstack/react-query";
import { ArrowRight, FilePlus2 } from "lucide-react";
import { Link } from "react-router-dom";
import { LeadReferrerShell } from "@/components/lead-referrer/LeadReferrerShell";
import { supabase } from "@/lib/supabase";

type LeadSummary = {
  id: string;
  business_name: string;
  status: string;
  created_at: string;
  funding_amount: number | null;
};

function formatMoney(value: number | null) {
  return value == null ? "Amount pending" : new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR", maximumFractionDigits: 0 }).format(value);
}

export default function LeadReferrerHomePage() {
  const leads = useQuery({
    queryKey: ["lead-referrer", "leads"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leads")
        .select("id,business_name,status,created_at,funding_amount")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as LeadSummary[];
    },
  });

  const summary = useQuery({
    queryKey: ["lead-referrer", "lead-counts"],
    queryFn: async () => {
      const [totalResult, activeResult] = await Promise.all([
        supabase.from("leads").select("id", { count: "exact", head: true }),
        supabase.from("leads").select("id", { count: "exact", head: true }).not("status", "in", "(declined,lost)"),
      ]);
      if (totalResult.error) throw totalResult.error;
      if (activeResult.error) throw activeResult.error;
      return { total: totalResult.count ?? 0, active: activeResult.count ?? 0 };
    },
  });

  return (
    <LeadReferrerShell>
      <section className="overflow-hidden rounded-2xl bg-gradient-to-br from-brand-navy to-[#143c57] p-6 text-white shadow-lg sm:p-8">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand-teal">Fund Now Capital</p>
        <div className="mt-3 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div>
            <h1 className="text-3xl font-bold">Your referral dashboard</h1>
            <p className="mt-2 max-w-2xl text-sm text-white/70">Submit funding opportunities and track only the leads attributed to you.</p>
          </div>
          <Link to="/lead-referrer/submit-lead" className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-teal px-5 py-3 text-sm font-bold text-white hover:brightness-95">
            <FilePlus2 className="h-4 w-4" aria-hidden="true" /> New lead
          </Link>
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2">
        <article className="rounded-xl border border-border bg-white p-5 shadow-sm">
          <p className="text-sm text-muted-foreground">Leads submitted</p>
          <p className="mt-2 text-3xl font-bold text-brand-navy">{summary.data?.total ?? 0}</p>
        </article>
        <article className="rounded-xl border border-border bg-white p-5 shadow-sm">
          <p className="text-sm text-muted-foreground">Active opportunities</p>
          <p className="mt-2 text-3xl font-bold text-brand-navy">{summary.data?.active ?? 0}</p>
        </article>
      </div>

      <section className="rounded-xl border border-border bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-bold text-brand-navy">My recent leads</h2>
            <p className="text-xs text-muted-foreground">Database access is restricted to your own attribution.</p>
          </div>
          <Link to="/lead-referrer/submit-lead" className="inline-flex items-center gap-1 text-sm font-semibold text-brand-teal">Add lead <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
        </div>
        {leads.isLoading ? <p className="py-8 text-sm text-muted-foreground">Loading leads...</p> : null}
        {leads.isError ? <p className="mt-4 rounded-lg bg-red-50 p-4 text-sm text-red-700">Could not load your leads.</p> : null}
        {!leads.isLoading && !leads.isError && (leads.data?.length ?? 0) === 0 ? (
          <p className="py-8 text-sm text-muted-foreground">No leads submitted yet.</p>
        ) : null}
        <div className="mt-3 divide-y divide-border">
          {(leads.data ?? []).map((lead) => (
            <article key={lead.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
              <div>
                <p className="font-semibold text-brand-navy">{lead.business_name}</p>
                <p className="text-xs text-muted-foreground">{formatMoney(lead.funding_amount)} · {new Date(lead.created_at).toLocaleDateString("en-ZA")}</p>
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold capitalize text-slate-700">{lead.status.replaceAll("_", " ")}</span>
            </article>
          ))}
        </div>
      </section>
    </LeadReferrerShell>
  );
}
