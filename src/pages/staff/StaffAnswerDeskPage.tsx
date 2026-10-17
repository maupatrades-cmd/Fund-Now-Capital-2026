import { useState } from "react";
import { Navigate } from "react-router-dom";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Field, SAFE_TEXT_NOTE, card, errorText, primaryButton, selectClass } from "@/components/staff/StaffShell";
import {
  ANSWER_KINDS, ASKER_TYPES, useAnswerDesk, useLogAnswerItem, useResolveAnswerItem, useStaffRole, type AnswerItem,
} from "@/hooks/useStaffDesk";

const fmt = (iso: string) => new Date(iso).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg", dateStyle: "medium", timeStyle: "short" });
const STATE_CLASS: Record<AnswerItem["sla_state"], string> = {
  green: "bg-green-100 text-green-800", amber: "bg-amber-100 text-amber-800", red: "bg-red-100 text-red-800", answered: "bg-slate-100 text-slate-700",
};
const kindLabel = (k: string) => ANSWER_KINDS.find(([v]) => v === k)?.[1] ?? k;
const left = (m: number | null) => {
  if (m === null) return "";
  const a = Math.abs(m); const t = a >= 60 ? `${Math.floor(a / 60)}h ${a % 60}m` : `${a}m`;
  return m < 0 ? `${t} overdue` : `${t} left`;
};

// Answer desk: every question someone is waiting on, with its working-hours deadline.
export default function StaffAnswerDeskPage() {
  const { data: role, isLoading } = useStaffRole();
  const [showAnswered, setShowAnswered] = useState(false);
  const allowed = role === "coordinator" || role === "owner";
  const list = useAnswerDesk(showAnswered, allowed);
  const log = useLogAnswerItem();
  const resolve = useResolveAnswerItem();
  const [f, setF] = useState({ kind: "status_question", askerType: "agent", askerLabel: "", topic: "" });
  const [notes, setNotes] = useState<Record<string, string>>({});
  if (isLoading) return null;
  if (!allowed) return <Navigate to="/staff" replace />;

  return (
    <>
      <div>
        <h1 className="text-2xl font-bold text-brand-navy">Answer desk</h1>
        <p className="text-sm text-muted-foreground">Working hours are 08:00 to 20:00, weekdays, not public holidays. Amber from 75% of the time, red when overdue.</p>
      </div>
      <form className={`${card} space-y-3`} onSubmit={(e) => {
        e.preventDefault();
        log.mutate(f, { onSuccess: () => { toast.success("Logged"); setF({ ...f, askerLabel: "", topic: "" }); }, onError: (err) => toast.error(errorText(err)) });
      }}>
        <p className="text-xs text-muted-foreground">{SAFE_TEXT_NOTE}</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Type"><select className={selectClass} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{ANSWER_KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
          <Field label="Asked by"><select className={selectClass} value={f.askerType} onChange={(e) => setF({ ...f, askerType: e.target.value })}>{ASKER_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
          <Field label="Name (optional)"><Input maxLength={120} value={f.askerLabel} onChange={(e) => setF({ ...f, askerLabel: e.target.value })} /></Field>
        </div>
        <Field label="Question"><Input maxLength={300} value={f.topic} onChange={(e) => setF({ ...f, topic: e.target.value })} /></Field>
        <button type="submit" className={primaryButton} disabled={f.topic.trim().length < 3 || log.isPending}>Start the clock</button>
      </form>
      <section className={card}>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-base font-bold text-brand-navy">{showAnswered ? "All questions" : "Open questions"}</h2>
          <button type="button" className="text-sm font-semibold text-brand-teal underline" onClick={() => setShowAnswered(!showAnswered)}>{showAnswered ? "Open only" : "Include answered"}</button>
        </div>
        {list.error ? <p role="alert" className="text-sm text-red-600">{errorText(list.error)}</p> : null}
        <ul className="divide-y divide-border">
          {(list.data ?? []).map((a) => (
            <li key={a.id} className="space-y-1 py-3 text-sm">
              <p className="font-semibold text-brand-navy">
                {a.topic}
                <span className={`ml-2 rounded px-1.5 py-0.5 text-xs ${STATE_CLASS[a.sla_state]}`}>{a.sla_state === "answered" ? (a.answered_late ? "answered late" : "answered") : `${a.sla_state} · ${left(a.minutes_left)}`}</span>
              </p>
              <p className="text-xs text-muted-foreground">{kindLabel(a.kind)} · {a.asker_type.replace("_", " ")}{a.asker_label ? ` ${a.asker_label}` : ""}{a.business_name ? ` · ${a.business_name}` : ""} · asked {fmt(a.asked_at)} · due {fmt(a.due_at)}</p>
              {a.status === "open" ? (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <Input className="max-w-xs" maxLength={300} placeholder="How it was answered (optional)" value={notes[a.id] ?? ""} onChange={(e) => setNotes({ ...notes, [a.id]: e.target.value })} />
                  <button type="button" className="text-xs font-semibold text-green-700 underline" disabled={resolve.isPending}
                    onClick={() => resolve.mutate({ id: a.id, note: notes[a.id] ?? "" }, { onSuccess: () => toast.success("Marked answered"), onError: (e) => toast.error(errorText(e)) })}>Mark answered</button>
                </div>
              ) : null}
            </li>
          ))}
          {list.data && list.data.length === 0 ? <li className="py-3 text-muted-foreground">Nothing waiting.</li> : null}
        </ul>
      </section>
    </>
  );
}
