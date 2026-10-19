import { useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { card, errorText, primaryButton } from "@/components/staff/StaffShell";
import { ROUTE_LABEL, STEP_LABEL, rands, useCommissionBoard, useMoveCommission, type RouteRow } from "@/hooks/useCommissionFlow";

// Commission flow (owner spec §4) for the Director, the Administrator, the Sales Coordinator and HR. Each notice
// shows where it is and who has it; the buttons are the steps the database allows the viewer to take. It shows the
// agent's amount only: never the success fee, the funder or the commission split.
const fmt = (iso: string) => new Date(iso).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg", dateStyle: "medium", timeStyle: "short" });

function Row({ r }: { r: RouteRow }) {
  const move = useMoveCommission();
  const [note, setNote] = useState("");
  const [open, setOpen] = useState(false);
  const go = (to: string) => move.mutate({ noticeId: r.commission_notice_id, to, note }, {
    onSuccess: () => { toast.success(to === "with_agent" && r.status.startsWith("invoice_") ? "Sent back to the agent" : "Done"); setNote(""); },
    onError: (x) => toast.error(errorText(x)),
  });
  return (
    <li className="space-y-2 py-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-brand-navy">{r.client_name} · {r.deal_reference}</p>
          <p className="text-muted-foreground">{r.beneficiary_name} · {rands(r.commission_amount)}</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${r.status === "closed" ? "bg-green-100 text-green-800" : "bg-teal-50 text-brand-navy"}`}>{ROUTE_LABEL[r.status]}</span>
      </div>
      {r.invoice_number ? (
        <p className="text-xs">
          Agent's invoice {r.invoice_number} · {rands(r.invoice_total)} ({r.invoice_state})
          {r.amounts_match === false ? <span className="ml-2 rounded bg-amber-200 px-1.5 py-0.5 text-amber-900">Does not match the notice</span> : null}
        </p>
      ) : null}
      {r.paid_reference ? <p className="text-xs text-green-700">Paid {r.paid_at ? fmt(r.paid_at) : ""} · reference {r.paid_reference}</p> : null}
      {r.status === "invoice_with_director" ? (
        <p className="text-xs text-muted-foreground">Approve and pay in the commission editor (with the proof upload), then come back and send the proof on.</p>
      ) : null}
      {r.next_steps.length ? (
        <div className="flex flex-wrap items-center gap-2">
          <Input className="max-w-sm" maxLength={500} aria-label="Note" placeholder="Note (needed to send back)" value={note} onChange={(e) => setNote(e.target.value)} />
          {r.next_steps.map((s) => s === "with_agent" && r.status.startsWith("invoice_") ? (
            <button key={s} type="button" className="rounded-lg border border-amber-400 px-4 py-2 text-sm font-semibold text-amber-800 disabled:opacity-50"
              disabled={note.trim().length < 5 || move.isPending} onClick={() => go(s)}>Send back to the agent</button>
          ) : (
            <button key={s} type="button" className={primaryButton} disabled={move.isPending} onClick={() => go(s)}>{STEP_LABEL[s] ?? s}</button>
          ))}
        </div>
      ) : null}
      {r.history.length ? (
        <button type="button" className="text-xs text-brand-teal underline" onClick={() => setOpen(!open)}>{open ? "Hide" : "Show"} history ({r.history.length})</button>
      ) : null}
      {open ? (
        <ol className="space-y-1 border-l-2 border-border pl-3 text-xs text-muted-foreground">
          {r.history.map((h, i) => (
            <li key={i}>{fmt(h.at)} · {h.who ?? h.role}: {ROUTE_LABEL[h.to as keyof typeof ROUTE_LABEL] ?? h.to}{h.note ? ` · "${h.note}"` : ""}</li>
          ))}
        </ol>
      ) : null}
    </li>
  );
}

export default function StaffCommissionsPage() {
  const board = useCommissionBoard();
  return (
    <section className={`${card} space-y-3`}>
      <div>
        <h1 className="text-lg font-bold text-brand-navy">Commission flow</h1>
        <p className="text-sm text-muted-foreground">
          Director → Administrator → Sales Coordinator → agent. The agent's invoice: agent → HR → Administrator → Director.
          Proof of payment: Director → Administrator → HR → agent.
        </p>
      </div>
      {board.error ? <p role="alert" className="text-sm text-red-600">{errorText(board.error)}</p> : null}
      <ul className="divide-y divide-border">
        {(board.data ?? []).map((r) => <Row key={r.commission_notice_id} r={r} />)}
        {board.data && board.data.length === 0 ? <li className="py-3 text-sm text-muted-foreground">Nothing in the commission flow.</li> : null}
      </ul>
    </section>
  );
}
