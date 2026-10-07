import { useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Field, SAFE_TEXT_NOTE, card, errorText, primaryButton, selectClass, textareaClass } from "@/components/staff/StaffShell";
import {
  CALLER_KINDS, CALL_OUTCOMES, CALL_TOPICS, useAcknowledgeHandover, useCallTasks, useLogCall, useStaffCalls, useStaffHandovers, useWriteHandover,
} from "@/hooks/useStaffDesk";

const blank = {
  direction: "inbound" as "inbound" | "outbound", callerKind: "new_enquirer", callerName: "", callerPhone: "", businessName: "",
  topic: "new_enquiry", summary: "", outcome: "resolved", callbackDueAt: "",
};

const fmt = (iso: string) => new Date(iso).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg", dateStyle: "medium", timeStyle: "short" });

export default function StaffCallLogPage() {
  const [form, setForm] = useState(blank);
  const set = <K extends keyof typeof blank>(k: K, v: (typeof blank)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const calls = useStaffCalls();
  const logCall = useLogCall();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await logCall.mutateAsync({
        ...form,
        callbackDueAt: form.outcome === "callback_needed" && form.callbackDueAt ? new Date(form.callbackDueAt).toISOString() : null,
        leadId: null,
      });
      toast.success("Call logged");
      setForm(blank);
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  return (
    <>
      <div>
        <h1 className="text-2xl font-bold text-brand-navy">Call log</h1>
        <p className="text-sm text-muted-foreground">Log every call. Calls cannot be edited; log a correction if something was wrong.</p>
      </div>

      <form onSubmit={submit} className={`${card} grid gap-4 md:grid-cols-2`}>
        <Field label="Direction">
          <select className={selectClass} value={form.direction} onChange={(e) => set("direction", e.target.value as "inbound" | "outbound")}>
            <option value="inbound">Inbound</option><option value="outbound">Outbound</option>
          </select>
        </Field>
        <Field label="Who called">
          <select className={selectClass} value={form.callerKind} onChange={(e) => set("callerKind", e.target.value)}>
            {CALLER_KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        <Field label="Name"><Input required minLength={2} maxLength={120} value={form.callerName} onChange={(e) => set("callerName", e.target.value)} /></Field>
        <Field label="Phone"><Input inputMode="tel" maxLength={30} value={form.callerPhone} onChange={(e) => set("callerPhone", e.target.value)} /></Field>
        <Field label="Business (optional)"><Input maxLength={160} value={form.businessName} onChange={(e) => set("businessName", e.target.value)} /></Field>
        <Field label="Topic">
          <select className={selectClass} value={form.topic} onChange={(e) => set("topic", e.target.value)}>
            {CALL_TOPICS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        <div className="md:col-span-2">
          <Field label="What was discussed" hint={SAFE_TEXT_NOTE}>
            <textarea required minLength={3} maxLength={1000} className={textareaClass} value={form.summary} onChange={(e) => set("summary", e.target.value)} />
          </Field>
        </div>
        <Field label="Outcome">
          <select className={selectClass} value={form.outcome} onChange={(e) => set("outcome", e.target.value)}>
            {CALL_OUTCOMES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        {form.outcome === "callback_needed" ? (
          <Field label="Call back by">
            <Input type="datetime-local" required value={form.callbackDueAt} onChange={(e) => set("callbackDueAt", e.target.value)} />
          </Field>
        ) : null}
        <div className="md:col-span-2">
          <button type="submit" disabled={logCall.isPending} className={primaryButton}>{logCall.isPending ? "Saving..." : "Log call"}</button>
        </div>
      </form>

      <HandoverPanel />

      <section className={card}>
        <h2 className="mb-3 text-base font-bold text-brand-navy">Recent calls</h2>
        {calls.isLoading ? <p className="text-sm text-muted-foreground">Loading...</p> : null}
        {calls.error ? <p role="alert" className="text-sm text-red-600">{errorText(calls.error)}</p> : null}
        <ul className="divide-y divide-border">
          {(calls.data ?? []).map((c) => (
            <li key={c.id} className="py-3 text-sm">
              <p className="font-semibold text-brand-navy">
                {c.caller_name}{c.business_name ? ` · ${c.business_name}` : ""} <span className="font-normal text-muted-foreground">({c.direction}, {c.topic.replace("_", " ")})</span>
                {c.corrects_id ? <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">correction</span> : null}
              </p>
              <p className="text-muted-foreground">{c.summary}</p>
              <p className="text-xs text-muted-foreground">
                {fmt(c.logged_at)} · {c.logged_by_name} · {c.outcome.replace("_", " ")}
                {c.callback_due_at ? ` · call back by ${fmt(c.callback_due_at)}` : ""}
              </p>
              {c.outcome === "routed" ? <CallFollowThrough callId={c.id} /> : null}
            </li>
          ))}
          {calls.data && calls.data.length === 0 ? <li className="py-3 text-sm text-muted-foreground">No calls logged yet.</li> : null}
        </ul>
      </section>
    </>
  );
}

function HandoverPanel() {
  const handovers = useStaffHandovers();
  const write = useWriteHandover();
  const ack = useAcknowledgeHandover();
  const [label, setLabel] = useState("morning");
  const [summary, setSummary] = useState("");
  const [items, setItems] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await write.mutateAsync({ shiftLabel: label, summary, openItems: items.split("\n") });
      toast.success("Handover saved");
      setSummary(""); setItems("");
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  return (
    <section className={`${card} space-y-4`}>
      <h2 className="text-base font-bold text-brand-navy">Shift handover</h2>
      <form onSubmit={submit} className="grid gap-3 md:grid-cols-2">
        <Field label="Shift">
          <select className={selectClass} value={label} onChange={(e) => setLabel(e.target.value)}>
            <option value="morning">Morning</option><option value="afternoon">Afternoon</option><option value="evening">Evening</option>
          </select>
        </Field>
        <div className="md:col-span-2">
          <Field label="Summary for the next person" hint={SAFE_TEXT_NOTE}>
            <textarea required minLength={3} maxLength={2000} className={textareaClass} value={summary} onChange={(e) => setSummary(e.target.value)} />
          </Field>
        </div>
        <div className="md:col-span-2">
          <Field label="Open items (one per line)">
            <textarea className={textareaClass} value={items} onChange={(e) => setItems(e.target.value)} />
          </Field>
        </div>
        <div><button type="submit" disabled={write.isPending} className={primaryButton}>Save handover</button></div>
      </form>
      <ul className="divide-y divide-border">
        {(handovers.data ?? []).map((h) => (
          <li key={h.id} className="space-y-1 py-3 text-sm">
            <p className="font-semibold text-brand-navy">{h.shift_date} · {h.shift_label} · {h.author_name}</p>
            <p>{h.summary}</p>
            {h.open_items.length ? <ul className="list-disc pl-5 text-muted-foreground">{h.open_items.map((o, i) => <li key={i}>{o.text}</li>)}</ul> : null}
            {h.acknowledged_at ? (
              <p className="text-xs text-green-700">Acknowledged by {h.acknowledged_by_name}</p>
            ) : (
              <button
                type="button"
                className="text-xs font-semibold text-brand-teal underline"
                onClick={() => ack.mutate(h.id, { onError: (err) => toast.error(errorText(err)) })}
              >
                Acknowledge
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

// What happened to the work this call created: completion comes back here.
function CallFollowThrough({ callId }: { callId: string }) {
  const [open, setOpen] = useState(false);
  const tasks = useCallTasks(callId, open);
  return (
    <div className="pt-1">
      <button type="button" className="text-xs font-semibold text-brand-teal underline" onClick={() => setOpen((o) => !o)}>
        {open ? "Hide follow-through" : "Show follow-through"}
      </button>
      {open ? (
        <ul className="mt-1 space-y-0.5 text-xs">
          {(tasks.data ?? []).map((t) => (
            <li key={t.task_id}>
              {t.status === "done" ? "Done" : t.status === "cancelled" ? "Cancelled" : "Open"}: {t.title} (with {t.route_to})
              {t.completed_by_name ? ` · closed by ${t.completed_by_name}` : ""}{t.completion_note ? ` · ${t.completion_note}` : ""}
            </li>
          ))}
          {tasks.data && tasks.data.length === 0 ? <li className="text-muted-foreground">No linked tasks.</li> : null}
        </ul>
      ) : null}
    </div>
  );
}
