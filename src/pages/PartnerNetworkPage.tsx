import { Activity, Network, RefreshCw, UsersRound } from "lucide-react";
import PortalShell from "@/components/portal/PortalShell";
import {
  usePartnerSubagentOperations,
  type PartnerSubagentOperation,
} from "@/hooks/usePartnerSubagentOperations";

type PartnerNetworkPageProps = { surface: "owner" | "partner" };

const STATUS_TONE: Record<PartnerSubagentOperation["membership_status"], string> = {
  invited: "bg-sky-50 text-sky-700 ring-sky-200",
  active: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  suspended: "bg-amber-50 text-amber-800 ring-amber-200",
  ended: "bg-slate-100 text-slate-600 ring-slate-200",
};

function formatDate(value: string | null) {
  if (!value) return "No activity yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleString("en-ZA", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function NetworkContent({ surface }: PartnerNetworkPageProps) {
  const operations = usePartnerSubagentOperations();
  const rows = operations.data ?? [];
  const activeCount = rows.filter((row) => row.membership_status === "active" && row.profile_is_active).length;
  const leadCount = rows.reduce((total, row) => total + row.captured_lead_count, 0);
  const dealCount = rows.reduce((total, row) => total + row.deal_count, 0);
  const summaryCards = [
    { label: "Active sub-agents", value: activeCount, icon: UsersRound },
    { label: "Leads captured", value: leadCount, icon: Activity },
    { label: "Deals created", value: dealCount, icon: Network },
  ] as const;

  return (
    <div className="space-y-6">
      <header className="rounded-2xl bg-gradient-to-r from-[#10283f] to-[#173f5f] p-6 text-white shadow-sm">
        <div className="flex items-start gap-3">
          <span className="rounded-xl bg-white/10 p-2.5"><Network className="h-6 w-6" aria-hidden="true" /></span>
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#f3c84b]">Path-B network</p>
            <h1 className="mt-1 text-2xl font-bold">{surface === "owner" ? "Partner sub-agent network" : "My sub-agents"}</h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-200">
              {surface === "owner"
                ? "See every partner-to-lead-referrer relationship and its safe operational progress."
                : "Track the lead referrers connected to your organisation. Private compensation and client details are never shown here."}
            </p>
          </div>
        </div>
      </header>

      <section aria-label="Network summary" className="grid gap-3 sm:grid-cols-3">
        {summaryCards.map(({ label, value, icon: Icon }) => (
          <div key={label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <Icon className="h-5 w-5 text-[#c58b17]" aria-hidden="true" />
            <p className="mt-3 text-2xl font-bold text-[#10283f]">{value}</p>
            <p className="text-sm text-slate-500">{label}</p>
          </div>
        ))}
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="font-bold text-[#10283f]">Operational directory</h2>
            <p className="text-xs text-slate-500">Membership, volumes and latest attribution event</p>
          </div>
          <button
            type="button"
            onClick={() => void operations.refetch()}
            disabled={operations.isFetching}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-[#10283f] hover:bg-slate-50 disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${operations.isFetching ? "animate-spin" : ""}`} aria-hidden="true" />
            Refresh
          </button>
        </div>

        {operations.isPending ? (
          <p className="p-8 text-center text-sm text-slate-500">Loading the network…</p>
        ) : operations.isError ? (
          <div className="m-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            The network could not be loaded. Refresh and try again.
          </div>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center">
            <UsersRound className="mx-auto h-8 w-8 text-slate-300" aria-hidden="true" />
            <p className="mt-3 font-semibold text-[#10283f]">No sub-agents connected yet</p>
            <p className="mt-1 text-sm text-slate-500">Invited sub-agents will appear here once their partner relationship is recorded.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {rows.map((row) => (
              <article key={row.membership_id} className="grid gap-4 p-5 md:grid-cols-[minmax(0,1.5fr)_repeat(3,minmax(90px,0.55fr))] md:items-center">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate font-bold text-[#10283f]">{row.lead_referrer_name}</h3>
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold capitalize ring-1 ring-inset ${STATUS_TONE[row.membership_status]}`}>
                      {row.profile_is_active ? row.membership_status : "deactivated"}
                    </span>
                  </div>
                  {surface === "owner" ? <p className="mt-1 text-sm text-slate-500">{row.referral_partner_name}</p> : null}
                  <p className="mt-2 text-xs text-slate-400">Joined {formatDate(row.joined_at)}</p>
                </div>
                <div><p className="text-xs text-slate-400">Leads</p><p className="mt-1 text-lg font-bold text-[#10283f]">{row.captured_lead_count}</p></div>
                <div><p className="text-xs text-slate-400">Deals</p><p className="mt-1 text-lg font-bold text-[#10283f]">{row.deal_count}</p></div>
                <div>
                  <p className="text-xs text-slate-400">Latest activity</p>
                  <p className="mt-1 text-sm font-semibold capitalize text-[#10283f]">{row.last_activity_type?.replaceAll("_", " ") ?? "None"}</p>
                  <p className="text-xs text-slate-400">{formatDate(row.last_activity_at)}</p>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export default function PartnerNetworkPage({ surface }: PartnerNetworkPageProps) {
  const content = <NetworkContent surface={surface} />;
  return surface === "partner" ? <PortalShell portal="partner">{content}</PortalShell> : content;
}
