import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useClient, one } from "@/hooks/useClients";
import { ContactsManager } from "@/components/clients/ContactsManager";
import { DocumentsPanel } from "@/components/clients/DocumentsPanel";
import { referredByMeta } from "@/lib/clients";
import { formatZAR } from "@/lib/format";
import { ActivityFeed } from "@/components/activity/ActivityFeed";

type Tab = "overview" | "documents" | "notes" | "activity";

export default function ClientDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: client, isLoading, isError, error } = useClient(id);
  const [tab, setTab] = useState<Tab>("overview");

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
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {one(client.industry)?.name || client.sector || "Industry not set"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate(`/clients/${client.id}/edit`)}
          className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-brand-navy hover:bg-slate-50"
        >
          <Pencil className="h-4 w-4" /> Edit
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        <TabButton active={tab === "overview"} onClick={() => setTab("overview")}>
          Overview
        </TabButton>
        <TabButton active={tab === "documents"} onClick={() => setTab("documents")}>
          Documents
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
        </div>
      )}

      {tab === "documents" && (
        <section className="rounded-xl border border-border bg-white p-5 shadow-sm">
          <DocumentsPanel owner={{ type: "client", id: client.id }} referralPartnerId={client.referral_partner_id} />
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
