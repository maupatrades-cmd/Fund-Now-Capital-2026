import { useState } from "react";
import { toast } from "sonner";
import { FounderDecisionPanel } from "@/components/staff/FounderDecision";
import { PendingTasksPanel } from "@/components/staff/PendingTasksPanel";
import { Input } from "@/components/ui/input";
import { Field, SAFE_TEXT_NOTE, card, errorText, primaryButton, selectClass, textareaClass } from "@/components/staff/StaffShell";
import {
  canAssignTasks, useAssignTask, useAssignableStaff, useCloseStaffTask, useCreateAssignedTask, useCreateStaffTask, useRouteStaffTask,
  useStaffRole, useStaffTasks, type RouteTo, type StaffTask,
} from "@/hooks/useStaffDesk";

const KINDS = [
  ["general", "General"], ["document_chase", "Chase documents"], ["callback", "Callback"],
  ["founder_decision", "Founder decision"], ["review", "Review"],
] as const;

const ACCEPTANCE: Record<string, [string, string]> = {
  pending: ["waiting for an answer", "bg-amber-100 text-amber-800"],
  accepted: ["accepted", "bg-green-100 text-green-800"],
  declined: ["declined", "bg-red-100 text-red-800"],
};
const ROLE_NAME: Record<string, string> = { coordinator: "Sales Coordinator", switchboard: "Switchboard" };

const fmt = (iso: string) => new Date(iso).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg", dateStyle: "medium", timeStyle: "short" });

export default function StaffTasksPage() {
  const { data: role } = useStaffRole();
  const [status, setStatus] = useState<"open" | "done">("open");
  const tasks = useStaffTasks(status);
  const create = useCreateStaffTask();
  const route = useRouteStaffTask();
  const close = useCloseStaffTask();
  const [form, setForm] = useState({ title: "", notes: "", kind: "general", priority: "normal", due: "", routeTo: "coordinator" as RouteTo });
  const assigner = canAssignTasks(role);
  const people = useAssignableStaff(assigner);
  const staffPeople = (people.data ?? []).filter((p) => p.staff_role === "coordinator" || p.staff_role === "switchboard");
  const createAssigned = useCreateAssignedTask();
  const assign = useAssignTask();
  const [give, setGive] = useState({ title: "", notes: "", priority: "normal", due: "", person: "" });
  const [reassignTo, setReassignTo] = useState<Record<string, string>>({});

  const submitGive = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!give.person) { toast.error("Choose who gets the task."); return; }
    try {
      await createAssigned.mutateAsync({
        title: give.title, notes: give.notes, priority: give.priority,
        dueAt: give.due ? new Date(give.due).toISOString() : null, assignee: give.person,
      });
      toast.success("Task given. They will be asked to accept it.");
      setGive({ ...give, title: "", notes: "", due: "" });
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  // Mirrors the database rule; the database is what actually enforces it.
  const targets: RouteTo[] = role === "switchboard" ? ["coordinator", "owner"] : ["switchboard", "coordinator", "owner"];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await create.mutateAsync({
        title: form.title, notes: form.notes, kind: form.kind, priority: form.priority,
        dueAt: form.due ? new Date(form.due).toISOString() : null,
        routeTo: form.kind === "founder_decision" ? "owner" : form.routeTo,
      });
      toast.success("Task created");
      setForm({ ...form, title: "", notes: "", due: "" });
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  const doRoute = (t: StaffTask, to: RouteTo) => {
    const reason = window.prompt(`Why are you sending this to ${to}?`);
    if (!reason) return;
    route.mutate({ taskId: t.id, routeTo: to, reason }, { onSuccess: () => toast.success("Task routed"), onError: (e) => toast.error(errorText(e)) });
  };

  return (
    <>
      <div>
        <h1 className="text-2xl font-bold text-brand-navy">Tasks</h1>
        <p className="text-sm text-muted-foreground">Shared work between the desk, the Coordinator and the Owner. A founder decision always goes to the Owner.</p>
      </div>

      <PendingTasksPanel />

      {assigner ? (
        <form onSubmit={submitGive} className={`${card} grid gap-4 md:grid-cols-2`}>
          <h2 className="text-base font-bold text-brand-navy md:col-span-2">Give a task to a person</h2>
          <Field label="Title"><Input required minLength={3} maxLength={160} value={give.title} onChange={(e) => setGive({ ...give, title: e.target.value })} /></Field>
          <Field label="Give it to">
            <select className={selectClass} value={give.person} onChange={(e) => setGive({ ...give, person: e.target.value })}>
              <option value="">Choose a person...</option>
              {staffPeople.map((p) => <option key={p.profile_id} value={p.profile_id}>{p.full_name} ({ROLE_NAME[p.staff_role]})</option>)}
            </select>
          </Field>
          <Field label="Priority">
            <select className={selectClass} value={give.priority} onChange={(e) => setGive({ ...give, priority: e.target.value })}>
              <option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option>
            </select>
          </Field>
          <Field label="Due (optional)"><Input type="datetime-local" value={give.due} onChange={(e) => setGive({ ...give, due: e.target.value })} /></Field>
          <div className="md:col-span-2">
            <Field label="Notes (optional)" hint={SAFE_TEXT_NOTE}>
              <textarea maxLength={1000} className={textareaClass} value={give.notes} onChange={(e) => setGive({ ...give, notes: e.target.value })} />
            </Field>
          </div>
          <div className="md:col-span-2"><button type="submit" disabled={createAssigned.isPending} className={primaryButton}>Give task</button></div>
        </form>
      ) : null}

      <form onSubmit={submit} className={`${card} grid gap-4 md:grid-cols-2`}>
        <Field label="Title"><Input required minLength={3} maxLength={160} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
        <Field label="Type">
          <select className={selectClass} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
            {KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        <Field label="Send to">
          <select className={selectClass} disabled={form.kind === "founder_decision"} value={form.kind === "founder_decision" ? "owner" : form.routeTo} onChange={(e) => setForm({ ...form, routeTo: e.target.value as RouteTo })}>
            {targets.map((t) => <option key={t} value={t}>{t === "owner" ? "Owner" : t === "coordinator" ? "Coordinator" : "Switchboard desk"}</option>)}
          </select>
        </Field>
        <Field label="Priority">
          <select className={selectClass} value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
            <option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option>
          </select>
        </Field>
        <Field label="Due (optional)"><Input type="datetime-local" value={form.due} onChange={(e) => setForm({ ...form, due: e.target.value })} /></Field>
        <div className="md:col-span-2">
          <Field label="Notes (optional)" hint={SAFE_TEXT_NOTE}>
            <textarea maxLength={1000} className={textareaClass} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Field>
        </div>
        <div className="md:col-span-2"><button type="submit" disabled={create.isPending} className={primaryButton}>Create task</button></div>
      </form>

      <section className={card}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-bold text-brand-navy">{status === "open" ? "Open tasks" : "Completed tasks"}</h2>
          <button type="button" className="text-sm font-semibold text-brand-teal underline" onClick={() => setStatus(status === "open" ? "done" : "open")}>
            Show {status === "open" ? "completed" : "open"}
          </button>
        </div>
        {tasks.error ? <p role="alert" className="text-sm text-red-600">{errorText(tasks.error)}</p> : null}
        <ul className="divide-y divide-border">
          {(tasks.data ?? []).map((t) => (
            <li key={t.id} className="space-y-1 py-3 text-sm">
              <p className="font-semibold text-brand-navy">
                {t.title}
                {t.priority === "high" ? <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-800">high</span> : null}
                {t.task_kind === "founder_decision" ? <span className="ml-2 rounded bg-violet-100 px-1.5 py-0.5 text-xs text-violet-800">founder decision</span> : null}
              </p>
              {t.notes ? <p className="text-muted-foreground">{t.notes}</p> : null}
              {t.acceptance ? (
                <p className="text-xs">
                  Given to {t.assigned_name ?? "someone"}{t.assigned_by_name ? ` by ${t.assigned_by_name}` : ""}
                  <span className={`ml-2 rounded px-1.5 py-0.5 ${ACCEPTANCE[t.acceptance][1]}`}>{ACCEPTANCE[t.acceptance][0]}</span>
                  {t.decline_reason ? <span className="block text-red-700">Reason: {t.decline_reason}</span> : null}
                </p>
              ) : null}
              {t.status === "open" && assigner && t.task_kind !== "founder_decision" && t.acceptance !== "pending" ? (
                <div className="flex flex-wrap items-center gap-2">
                  <select className={`${selectClass} max-w-xs`} aria-label="Give this task to" value={reassignTo[t.id] ?? ""}
                    onChange={(e) => setReassignTo({ ...reassignTo, [t.id]: e.target.value })}>
                    <option value="">{t.acceptance === "declined" ? "Give to someone else..." : "Give to a person..."}</option>
                    {staffPeople.filter((p) => p.profile_id !== t.assigned_to || t.acceptance === "declined").map((p) => (
                      <option key={p.profile_id} value={p.profile_id}>{p.full_name} ({ROLE_NAME[p.staff_role]})</option>
                    ))}
                  </select>
                  <button type="button" className="text-xs font-semibold text-brand-teal underline" disabled={!reassignTo[t.id] || assign.isPending}
                    onClick={() => assign.mutate({ taskId: t.id, assignee: reassignTo[t.id], note: "" }, { onSuccess: () => toast.success("Task given"), onError: (e) => toast.error(errorText(e)) })}>
                    Give
                  </button>
                </div>
              ) : null}
              <p className={`text-xs ${t.overdue ? "text-red-600" : "text-muted-foreground"}`}>
                With {t.route_to}{t.business_name ? ` · ${t.business_name}` : ""} · from {t.created_by_name}{t.due_at ? ` · due ${fmt(t.due_at)}` : ""}{t.overdue ? " · overdue" : ""}
              </p>
              {t.status === "open" ? (
                <div className="flex flex-wrap gap-3 pt-1">
                  {t.task_kind !== "founder_decision" ? (
                    <button type="button" className="text-xs font-semibold text-green-700 underline"
                      onClick={() => close.mutate({ taskId: t.id, outcome: "done", note: "" }, { onError: (e) => toast.error(errorText(e)) })}>Mark done</button>
                  ) : null}
                  {t.task_kind !== "founder_decision" ? targets.filter((x) => x !== t.route_to).map((to) => (
                    <button key={to} type="button" className="text-xs font-semibold text-brand-teal underline" onClick={() => doRoute(t, to)}>Send to {to}</button>
                  )) : null}
                </div>
              ) : null}
              {t.status === "open" && t.task_kind === "founder_decision" && role === "owner" ? <FounderDecisionPanel taskId={t.id} /> : null}
            </li>
          ))}
          {tasks.data && tasks.data.length === 0 ? <li className="py-3 text-muted-foreground">Nothing here.</li> : null}
        </ul>
      </section>
    </>
  );
}
