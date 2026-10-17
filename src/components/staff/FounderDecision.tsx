import { useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Field, SAFE_TEXT_NOTE, errorText, primaryButton, selectClass, textareaClass } from "@/components/staff/StaffShell";
import {
  DECLINE_CATEGORIES, useDealSummary, useDecideFounderTask, useFileDecision, useSendToFounder, type FounderDecision,
} from "@/hooks/useStaffDesk";

const DECISION_LABEL: Record<FounderDecision, string> = {
  approve_to_submit: "Approved to submit", send_back_with_query: "Sent back with a question",
  decline: "Declined", call_me: "Founder wants a call",
};

// Coordinator: one-page Deal Summary that sends a Complete file to the Founder.
export function SendToFounderForm({ leadId }: { leadId: string }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ amountPurpose: "", turnoverTrading: "", documentsNote: "", redFlags: "" });
  const send = useSendToFounder();
  if (!open) return <button type="button" className="text-xs font-semibold text-brand-teal underline" onClick={() => setOpen(true)}>Send to Founder</button>;
  const ready = f.amountPurpose.trim().length >= 3 && f.turnoverTrading.trim().length >= 3;
  return (
    <form className="mt-2 space-y-3 rounded-lg border border-border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        send.mutate({ leadId, ...f }, { onSuccess: () => { toast.success("Sent to the Founder"); setOpen(false); }, onError: (err) => toast.error(errorText(err)) });
      }}>
      <p className="text-xs text-muted-foreground">{SAFE_TEXT_NOTE}</p>
      <Field label="Amount and purpose"><Input maxLength={600} value={f.amountPurpose} onChange={(e) => setF({ ...f, amountPurpose: e.target.value })} /></Field>
      <Field label="Turnover and trading history"><Input maxLength={600} value={f.turnoverTrading} onChange={(e) => setF({ ...f, turnoverTrading: e.target.value })} /></Field>
      <Field label="Documents note (optional)"><textarea className={textareaClass} maxLength={600} value={f.documentsNote} onChange={(e) => setF({ ...f, documentsNote: e.target.value })} /></Field>
      <Field label="Red flags (optional)"><textarea className={textareaClass} maxLength={600} value={f.redFlags} onChange={(e) => setF({ ...f, redFlags: e.target.value })} /></Field>
      <div className="flex gap-3">
        <button type="submit" className={primaryButton} disabled={!ready || send.isPending}>Send to Founder</button>
        <button type="button" className="text-sm underline" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}

// Owner: Deal Summary plus the four decision buttons on a Founder decision task.
export function FounderDecisionPanel({ taskId }: { taskId: string }) {
  const summary = useDealSummary(taskId, true);
  const decide = useDecideFounderTask();
  const [note, setNote] = useState("");
  const [category, setCategory] = useState("");
  const s = summary.data;
  const go = (decision: FounderDecision) =>
    decide.mutate({ taskId, decision, note, declineCategory: decision === "decline" ? category : undefined }, {
      onSuccess: () => toast.success(DECISION_LABEL[decision]), onError: (e) => toast.error(errorText(e)),
    });
  return (
    <div className="mt-2 space-y-3 rounded-lg border border-violet-200 bg-violet-50/40 p-3">
      {summary.error ? <p role="alert" className="text-xs text-red-600">{errorText(summary.error)}</p> : null}
      {s ? (
        <dl className="space-y-1 text-xs">
          <div><dt className="inline font-semibold">Business: </dt><dd className="inline">{s.business_name} · {s.funding_type_label}{s.requested_amount ? ` · R${Number(s.requested_amount).toLocaleString("en-ZA")}` : ""}</dd></div>
          <div><dt className="inline font-semibold">Amount and purpose: </dt><dd className="inline">{s.amount_purpose}</dd></div>
          <div><dt className="inline font-semibold">Turnover and trading: </dt><dd className="inline">{s.turnover_trading}</dd></div>
          {s.documents_note ? <div><dt className="inline font-semibold">Documents: </dt><dd className="inline">{s.documents_note}</dd></div> : null}
          {s.red_flags ? <div><dt className="inline font-semibold text-red-700">Red flags: </dt><dd className="inline">{s.red_flags}</dd></div> : null}
          <div className="text-muted-foreground">{s.agent_name ? `Agent ${s.agent_name}` : "No agent"}{s.team_name ? ` · ${s.team_name}` : ""}</div>
        </dl>
      ) : null}
      <Field label="Note (required for Send back; a question for the client)">
        <textarea className={textareaClass} maxLength={600} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <Field label="Decline reason (only for Decline)">
        <select className={selectClass} value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">Choose…</option>
          {DECLINE_CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </Field>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={primaryButton} disabled={decide.isPending} onClick={() => go("approve_to_submit")}>Approve to submit</button>
        <button type="button" className={primaryButton} disabled={decide.isPending || note.trim().length < 10} onClick={() => go("send_back_with_query")}>Send back with query</button>
        <button type="button" className={primaryButton} disabled={decide.isPending || !category} onClick={() => go("decline")}>Decline</button>
        <button type="button" className={primaryButton} disabled={decide.isPending} onClick={() => go("call_me")}>Call me</button>
      </div>
    </div>
  );
}

// Coordinator: the Founder's latest answer on a file (decision, category, question only).
export function FileDecisionLine({ leadId }: { leadId: string }) {
  const d = useFileDecision(leadId, true);
  if (!d.data) return null;
  return (
    <p className="text-xs text-violet-800">
      Founder: {DECISION_LABEL[d.data.decision]}{d.data.decline_category ? ` (${d.data.decline_category.replace("_", " ")})` : ""}{d.data.note ? ` — ${d.data.note}` : ""}
    </p>
  );
}
