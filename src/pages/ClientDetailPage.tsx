import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Pencil, Plus, Repeat2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useClient, useClientDeals, one } from "@/hooks/useClients";
import { NewDealDialog } from "@/components/pipeline/NewDealDialog";
import { stageLabel, type DealStage } from "@/lib/dealStages";
import { ContactsManager } from "@/components/clients/ContactsManager";
import { DocumentsPanel } from "@/components/clients/DocumentsPanel";
import { StoryPanel } from "@/components/clients/StoryPanel";
import { CallLogPanel } from "@/components/clients/CallLogPanel";
import { StakeholdersPanel } from "@/components/stakeholders/StakeholdersPanel";
import { referredByMeta } from "@/lib/clients";
import { formatZAR } from "@/lib/format";
import { ActivityFeed } from "@/components/activity/ActivityFeed";

type Tab = "overview" | "story" | "stakeholders" | "documents" | "calllog" | "notes" | "activity";

export default function ClientDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: client, isLoading, isError, error } = useClient(id);
  const deals = useClientDeals(id);
  const [tab, setTab] = useState<Tab>("overview");
  const [newDealOpen, setNewDealOpen] = useState(false);

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading client…</div>;
  if (isError || !client) {
    return (
      <div className="space-y-3">
        <BackLink />
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Couldn't load client: {(error as Error)?.message ?? "not found"}
        </div>
      </div>
    );
  }

  // referral_partner isn't embedded on the single query; the badge only needs to
  // distinguish Self (no partner) from a referred client.
  const referred = referredByMeta(client.referral_partner_id ? "Bright Destiny" : null);

  return (
    <div className="max-w-4xl space-y-5">
      <BackLink />

      <div className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-border bg-white p-6 shadow-sm">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-brand-navy">{client.business_name}</h1>
            <Badge className={referred.className}>{referred.label}</Badge>
            {(deals.data?.length ?? 0) > 1 && <Badge className="bg-violet-100 text-violet-700"><Repeat2 className="mr-1 h-3 w-3" />Repeat client</Badge>}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {one(client.industry)?.name || client.sector || "Industry not set"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2"><button type="button" onClick={() => setNewDealOpen(true)} className="flex items-center gap-2 rounded-lg bg-brand-teal px-4 py-2 text-sm font-semibold text-white"><Plus className="h-4 w-4" />New deal</button><button
          type="button"
          onClick={() => navigate(`/clients/${client.id}/edit`)}
          className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-brand-navy hover:bg-slate-50"
        >
          <Pencil className="h-4 w-4" /> Edit
        </button></div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        <TabButton active={tab === "overview"} onClick={() => setTab("overview")}>
          Overview
        </TabButton>
        <TabButton active={tab === "story"} onClick={() => setTab("story")}>
          Story
        </TabButton>
        <TabButton active={tab === "stakeholders"} onClick={() => setTab("stakeholders")}>
          Stakeholders
        </TabButton>
        <TabButton active={tab === "documents"} onClick={() => setTab("documents")}>
          Documents
        </TabButton>
        <TabButton active={tab === "calllog"} onClick={() => setTab("calllog")}>
          Call Log
        </TabButton>
        <TabButton active={tab === "notes"} onClick={() => setTab("notes")}>
          Notes
        </TabButton>
        <TabButton active={tab === "activity"} onClick={() => setTab("activity")}>
          Activity
        </TabButton>
      </div>

      {tab === "overview" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <section className="rounded-xl border border-border bg-white p-5 shadow-sm">
            <h3 className="mb-3 text-sm font-semibold text-brand-navy">Business info</h3>
            <dl className="space-y-2 text-sm">
              <Info label="CIPC number" value={client.cipc_number} />
              <Info label="Industry" value={one(client.industry)?.name ?? null} />
              <Info label="Sub-industry" value={one(client.sub_industry)?.name ?? null} />
              <Info label="Sector notes" value={client.sector_notes} />
              {client.sector && <Info label="Legacy sector" value={client.sector} />}
              <Info
                label="Monthly turnover"
                value={client.monthly_turnover != null ? formatZAR(client.monthly_turnover) : null}
              />
              <Info label="Referred by" value={referred.label} />
              <Info label="Address" value={client.address} />
            </dl>
          </section>

          <section className="rounded-xl border border-border bg-white p-5 shadow-sm">
            <ContactsManager clientId={client.id} />
          </section>
          <section className="rounded-xl border border-border bg-white p-5 shadow-sm lg:col-span-2">
            <h3 className="mb-3 text-sm font-semibold text-brand-navy">Funding history</h3>
            {deals.isLoading && <p className="text-sm text-muted-foreground">Loading deals...</p>}
            {!deals.isLoading && (deals.data?.length ?? 0) === 0 && <p className="text-sm text-muted-foreground">No deals yet.</p>}
            <div className="divide-y">{(deals.data ?? []).map((deal) => <Link key={deal.id} to={`/deals/${deal.id}`} className="flex items-center justify-between gap-3 py-3 text-sm hover:text-brand-teal"><span className="font-medium">{deal.reference ?? "Deal"}</span><span className="text-muted-foreground">{stageLabel(deal.stage as DealStage)} · {deal.amount_requested ? formatZAR(deal.amount_requested) : "Amount not set"}</span></Link>)}</div>
          </section>
        </div>
      )}

      {newDealOpen && <NewDealDialog defaultClientId={client.id} onClose={() => setNewDealOpen(false)} onCreated={(dealId) => navigate(`/deals/${dealId}`)} />}

      {tab === "story" && (
        <section className="rounded-xl border border-border bg-white p-5 shadow-sm">
          <StoryPanel entity={{ kind: "client", id: client.id }} title={client.business_name} />
        </section>
      )}

      {tab === "stakeholders" && (
        <section className="rounded-xl border border-border bg-white p-5 shadow-sm">
          <h3 className="mb-1 text-sm font-semibold text-brand-navy">Directors &amp; Shareholders</h3>
          <p className="mb-4 text-xs text-muted-foreground">
            Directors, shareholders, sureties, and beneficial owners (FICA) — SA ID or passport, with
            shareholding and beneficial-owner tracking.
          </p>
          <StakeholdersPanel entity={{ kind: "client", id: client.id }} />
        </section>
      )}

      {tab === "documents" && (
        <section className="rounded-xl border border-border bg-white p-5 shadow-sm">
          <DocumentsPanel entity={{ kind: "client", id: client.id }} referralPartnerId={client.referral_partner_id} />
        </section>
      )}

      {tab === "calllog" && (
        <section className="rounded-xl border border-border bg-white p-5 shadow-sm">
          <CallLogPanel clientId={client.id} />
        </section>
      )}

      {tab === "notes" && (
        <section className="rounded-xl border border-border bg-white p-5 shadow-sm">
          {client.notes ? (
            <p className="whitespace-pre-wrap text-sm text-brand-navy">{client.notes}</p>
          ) : (
            <p className="text-sm text-muted-foreground">No notes yet.</p>
          )}
        </section>
      )}

      {tab === "activity" && (
        <section className="rounded-xl border border-border bg-white p-5 shadow-sm">
          <ActivityFeed entityId={client.id} />
        </section>
      )}
    </div>
  );
}

function BackLink() {
  return (
    <Link to="/clients" className="inline-flex items-center gap-1.5 text-sm text-brand-teal hover:underline">
      <ArrowLeft className="h-4 w-4" /> Back to clients
    </Link>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "px-4 py-2.5 text-sm font-medium -mb-px border-b-2 transition-colors " +
        (active
          ? "border-brand-teal text-brand-navy"
          : "border-transparent text-muted-foreground hover:text-brand-navy")
      }
    >
      {children}
    </button>
  );
}

function Info({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium text-brand-navy">{value || "—"}</dd>
    </div>
  );
}
