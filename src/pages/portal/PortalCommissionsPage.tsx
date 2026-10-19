import { useState } from "react";
import { toast } from "sonner";
import PortalShell from "@/components/portal/PortalShell";
import { ROUTE_LABEL, rands, useInvoiceOptions, useMoveCommission, useMyCommissionNotices, type MyNotice } from "@/hooks/useCommissionFlow";

// Commission notices for the agent (contractor portal) or partner (partner portal), owner spec §4. The notice shows
// the client, the deal reference and the beneficiary's own commission only. The agent answers it with an invoice they
// already created in their portal (Invoices); HR, the Administrator and the Director take it from there.
const fmt = (iso: string) => new Date(iso).toLocaleDateString("en-ZA", { timeZone: "Africa/Johannesburg", dateStyle: "medium" });
const err = (e: unknown) => (e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : "Something went wrong");

function SendInvoice({ n }: { n: MyNotice }) {
  const options = useInvoiceOptions(n.commission_notice_id);
  const move = useMoveCommission();
  const [pick, setPick] = useState("");
  const chosen = (options.data ?? []).find((o) => o.invoice_id === pick) ?? null;
  if (options.data && options.data.length === 0) {
    return <p className="text-xs text-amber-800">Create and submit your invoice under Invoices first, then come back to send it.</p>;
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select className="h-9 rounded-md border border-input bg-background px-3 text-sm" aria-label="Your invoice" value={pick} onChange={(e) => setPick(e.target.value)}>
        <option value="">Choose your invoice…</option>
        {(options.data ?? []).map((o) => <option key={o.invoice_id} value={o.invoice_id}>{o.invoice_number} · {rands(o.total_amount)} ({o.state})</option>)}
      </select>
      <button type="button" className="rounded-lg bg-brand-teal px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={!chosen || move.isPending}
        onClick={() => move.mutate({ noticeId: n.commission_notice_id, to: "invoice_with_hr", invoice: chosen }, {
          onSuccess: () => toast.success("Sent to HR"), onError: (x) => toast.error(err(x)),
        })}>Send invoice to HR</button>
    </div>
  );
}

export default function PortalCommissionsPage({ portal }: { portal: "partner" | "contractor" }) {
  const list = useMyCommissionNotices();
  return (
    <PortalShell portal={portal}>
      <section className="space-y-3 rounded-2xl border border-border bg-white p-5 shadow-sm">
        <div>
          <h1 className="text-lg font-bold text-brand-navy">Commission notices</h1>
          <p className="text-sm text-muted-foreground">When Fund Now Capital sends you a commission notice, send your invoice from here. You can see where it is at every step.</p>
        </div>
        {list.error ? <p role="alert" className="text-sm text-red-600">{err(list.error)}</p> : null}
        <ul className="divide-y divide-border">
          {(list.data ?? []).map((n) => (
            <li key={n.commission_notice_id} className="space-y-2 py-3 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-brand-navy">{n.client_name} · {n.deal_reference}</p>
                  <p>Your commission: <span className="font-semibold">{rands(n.commission_amount)}</span></p>
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${n.status === "closed" ? "bg-green-100 text-green-800" : "bg-teal-50 text-brand-navy"}`}>
                  {n.status === "with_agent" ? "Waiting for your invoice" : ROUTE_LABEL[n.status]}
                </span>
              </div>
              {n.sent_back_note ? <p className="rounded bg-amber-50 px-3 py-2 text-xs text-amber-900">Sent back to you: {n.sent_back_note}</p> : null}
              {n.invoice_number ? <p className="text-xs text-muted-foreground">Your invoice {n.invoice_number} ({n.invoice_state})</p> : null}
              {n.paid_reference ? <p className="text-xs text-green-700">Paid{n.paid_at ? ` on ${fmt(n.paid_at)}` : ""} · payment reference {n.paid_reference}</p> : null}
              {n.status === "with_agent" ? <SendInvoice n={n} /> : null}
            </li>
          ))}
          {list.data && list.data.length === 0 ? <li className="py-3 text-sm text-muted-foreground">No commission notices yet.</li> : null}
        </ul>
      </section>
    </PortalShell>
  );
}
