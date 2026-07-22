import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Star } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { DEAL_STAGES, stageLabel, type DealStage } from "@/lib/dealStages";
import { formatZAR, daysSince } from "@/lib/format";
import { stageUrgency, URGENCY_BADGE } from "@/lib/deals";
import { one } from "@/hooks/useDeals";
import { useToggleDealPriority } from "@/hooks/useDeals";
import { useDeal, useUpdateDeal, useReopenDeal } from "@/hooks/useDealDetail";
import { useCelebrate } from "@/lib/celebration/ConfettiProvider";
import { FunderSubmissions } from "@/components/deals/FunderSubmissions";
import { DealInvoices } from "@/components/deals/DealInvoices";
import { CommunicationsLog } from "@/components/deals/CommunicationsLog";
import { DealDocuments } from "@/components/deals/DealDocuments";
import { StageHistory } from "@/components/deals/StageHistory";
import { ActivityFeed } from "@/components/activity/ActivityFeed";

export default function DealDetailPage() {
  const { id } = useParams();
  const { data: deal, isLoading, isError, error } = useDeal(id);
  const updateDeal = useUpdateDeal();
  const { celebrateOnce } = useCelebrate();
  const togglePriority = useToggleDealPriority();
  const reopen = useReopenDeal();
  const [notes, setNotes] = useState<string | null>(null);
  const [reopenTo, setReopenTo] = useState<string | null>(null);

  // Drop any local notes draft when navigating to a different deal so it can't
  // be saved back to the wrong record.
  useEffect(() => {
    setNotes(null);
    setReopenTo(null);
  }, [id]);

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading deal…</div>;
  if (isError || !deal) {
    return (
      <div className="space-y-3">
        <BackLink />
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Couldn't load deal: {(error as Error)?.message ?? "not found"}
        </div>
      </div>
    );
  }

  const client = one(deal.client);
  const days = daysSince(deal.stage_entered_at);
  const urgency = stageUrgency(days);
  const notesValue = notes ?? deal.notes ?? "";

  const changeStage = (stage: string) => {
    if (stage === deal.stage) return;
    // Declined is terminal — leaving it is the deliberate reopen path (confirm first).
    if (deal.stage === "declined") {
      setReopenTo(stage);
      return;
    }
    updateDeal.mutate(
      { id: deal.id, input: { stage } },
      {
        onSuccess: () => {
          // Deal reaching Funded is the money-real moment — celebrate once per deal.
          if (stage === "funded") {
            const commission =
              deal.gross_commission != null ? ` Commission earned: ${formatZAR(deal.gross_commission)}` : "";
            celebrateOnce(`funded:${deal.id}`, {
              message: `🎉 ${client?.business_name ?? "Client"} — ${deal.reference ?? "Deal"} Funded!${commission}`,
            });
          }
        },
        onError: (e) => toast.error((e as Error).message || "Could not update stage"),
      },
    );
  };

  const confirmReopen = async () => {
    if (!reopenTo) return;
    try {
      await reopen.mutateAsync({ id: deal.id, stage: reopenTo as DealStage });
      toast.success("Deal reopened");
      setReopenTo(null);
    } catch (e) {
      toast.error((e as Error).message || "Could not reopen deal");
    }
  };

  const saveNotes = async () => {
    try {
      await updateDeal.mutateAsync({ id: deal.id, input: { notes: notesValue || null } });
      toast.success("Notes saved");
    } catch (e) {
      toast.error((e as Error).message || "Could not save notes");
    }
  };

  return (
    <div className="max-w-5xl space-y-5">
      <BackLink />

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-border bg-white p-6 shadow-sm">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold text-brand-navy">{deal.reference ?? "Deal"}</h1>
            <Badge className={"ring-1 ring-inset " + URGENCY_BADGE[urgency] + " ring-black/5"}>
              {stageLabel(deal.stage)} · {days}d
            </Badge>
            {deal.is_purchase_order && (
              <Badge className="bg-brand-navy/10 text-brand-navy ring-brand-navy/20">PO deal</Badge>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {client ? (
              <Link to={`/clients/${client.id}`} className="text-brand-teal hover:underline">
                {client.business_name}
              </Link>
            ) : (
              "Unknown client"
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={() =>
            togglePriority.mutate(
              { id: deal.id, isPriority: !deal.is_priority },
              {
                onError: (e) =>
                  toast.error((e as Error).message || "Could not update priority"),
              },
            )
          }
          className={
            "flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium " +
            (deal.is_priority
              ? "border-brand-teal bg-brand-teal/10 text-brand-teal"
              : "border-border text-brand-navy hover:bg-slate-50")
          }
        >
          <Star className={"h-4 w-4 " + (deal.is_priority ? "fill-brand-teal" : "")} />
          {deal.is_priority ? "Priority" : "Mark priority"}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Deal info */}
        <section className="rounded-xl border border-border bg-white p-5 shadow-sm">
          <h3 className="mb-3 text-sm font-semibold text-brand-navy">Deal info</h3>
          <div className="space-y-3 text-sm">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Stage</label>
              <select
                value={deal.stage}
                onChange={(e) => changeStage(e.target.value)}
                className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:border-brand-teal"
              >
                {DEAL_STAGES.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>
            <Info label="Amount requested" value={deal.amount_requested != null ? formatZAR(deal.amount_requested) : "—"} />
            <Info label="Gross commission" value={deal.gross_commission != null ? formatZAR(deal.gross_commission) : "—"} />
            <Info label="Deal type" value={deal.is_purchase_order ? "Purchase Order" : "Standard"} />
            <Info label="Referred by" value={deal.referral_partner_id ? "Referral partner" : "Self"} />
          </div>
        </section>

        {/* Notes */}
        <section className="rounded-xl border border-border bg-white p-5 shadow-sm">
          <h3 className="mb-3 text-sm font-semibold text-brand-navy">Notes</h3>
          <textarea
            rows={5}
            value={notesValue}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Add notes about this deal…"
            className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:border-brand-teal focus:ring-2 focus:ring-brand-teal/20"
          />
          <button
            type="button"
            onClick={saveNotes}
            disabled={updateDeal.isPending}
            className="mt-2 rounded-lg bg-brand-teal px-4 py-2 text-sm font-semibold text-white hover:bg-brand-teal/90 disabled:opacity-60"
          >
            Save notes
          </button>
        </section>
      </div>

      {/* Funder submissions with embedded commission calculator */}
      <section className="rounded-xl border border-border bg-white p-5 shadow-sm">
        <FunderSubmissions dealId={deal.id} isPurchaseOrder={deal.is_purchase_order} />
      </section>

      {/* Invoices — generate/track FNC → funder invoices for this deal (C1.2) */}
      <section className="rounded-xl border border-border bg-white p-5 shadow-sm">
        <DealInvoices
          dealId={deal.id}
          clientId={deal.client_id}
          isPurchaseOrder={deal.is_purchase_order}
          stage={deal.stage}
        />
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <section className="rounded-xl border border-border bg-white p-5 shadow-sm">
          <CommunicationsLog
            dealId={deal.id}
            clientId={deal.client_id}
            referralPartnerId={deal.referral_partner_id}
          />
        </section>
        <section className="rounded-xl border border-border bg-white p-5 shadow-sm">
          <DealDocuments clientId={deal.client_id} />
        </section>
      </div>

      <section className="rounded-xl border border-border bg-white p-5 shadow-sm">
        <StageHistory dealId={deal.id} />
      </section>

      <section className="rounded-xl border border-border bg-white p-5 shadow-sm">
        <ActivityFeed entityId={deal.id} />
      </section>

      {reopenTo && (
        <div className="fixed inset-0 z-40 grid place-items-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setReopenTo(null)} aria-hidden="true" />
          <div className="relative z-10 w-full max-w-sm space-y-4 rounded-xl border border-border bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-brand-navy">Reopen deal?</h3>
            <p className="text-sm text-muted-foreground">
              This deal was declined. Reopen it as “{stageLabel(reopenTo)}”?
            </p>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={confirmReopen}
                disabled={reopen.isPending}
                className="rounded-lg bg-brand-teal px-4 py-2 text-sm font-semibold text-white hover:bg-brand-teal/90 disabled:opacity-60"
              >
                {reopen.isPending ? "Reopening…" : "Yes, reopen"}
              </button>
              <button
                type="button"
                onClick={() => setReopenTo(null)}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-brand-navy hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function BackLink() {
  return (
    <Link to="/pipeline" className="inline-flex items-center gap-1.5 text-sm text-brand-teal hover:underline">
      <ArrowLeft className="h-4 w-4" /> Back to pipeline
    </Link>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-brand-navy">{value}</span>
    </div>
  );
}
