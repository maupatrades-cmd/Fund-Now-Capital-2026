import { useState } from "react";
import { toast } from "sonner";
import { FounderDecisionPanel } from "@/components/staff/FounderDecision";
import { PendingTasksPanel } from "@/components/staff/PendingTasksPanel";
import { Input } from "@/components/ui/input";
import { useSession } from "@/lib/useSession";
import { Field, SAFE_TEXT_NOTE, card, errorText, primaryButton, selectClass, textareaClass } from "@/components/staff/StaffShell";
import {
  canAssignTasks, canGiveTasks, useAskTaskQuestion, useAssignTask, useAssignableStaff, useCloseStaffTask, useCreateAssignedTask,
  useCreateStaffTask, useRouteStaffTask, useStaffRole, useStaffTasks, useTaskAssignablePeople, type RouteTo, type StaffTask,
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
const ROLE_NAME: Record<string, string> = {
  owner: "the Director", administrator: "Office Administrator", coordinator: "Sales Coordinator", switchboard: "Switchboard",
  hr: "HR", field_supervisor: "Field Supervisor", field_consultant: "Field consultant",
};
const IMPORTANT_BADGE = "ml-2 rounded bg-red-600 px-1.5 py-0.5 text-xs text-white";

// Where a task the caller gave stands now (the Director's "Tasks I gave" list).
function givenState(t: StaffTask): [string, string] {
  if (t.status === "done") return ["done", "bg-green-100 text-green-800"];
  if (t.status === "cancelled") return ["cancelled", "bg-slate-100 text-slate-700"];
  if (t.overdue) return ["overdue", "bg-red-100 text-red-800"];
  if (t.acceptance === "pending") return ["waiting to be accepted", "bg-amber-100 text-amber-800"];
  if (t.acceptance === "declined") return ["declined", "bg-red-100 text-red-800"];
  return ["accepted, in progress", "bg-blue-100 text-blue-800"];
}

const fmt = (iso: string) => new Date(iso).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg", dateStyle: "medium", timeStyle: "short" });

export default function StaffTasksPage() {
  const { data: role } = useStaffRole();
  const session = useSession();
  const myId = session?.user.id;
  const [status, setStatus] = useState<"open" | "done">("open");
  const tasks = useStaffTasks(status);
  const create = useCreateStaffTask();
  const route = useRouteStaffTask();
  const close = useCloseStaffTask();
  const [form, setForm] = useState({ title: "", notes: "", kind: "general", priority: "normal", due: "", routeTo: "coordinator" as RouteTo });
  // Re-giving an existing task stays with the Director and the Administrator.
  const assigner = canAssignTasks(role);
  const people = useAssignableStaff(assigner);
  // Any enabled member of the office staff (Important tasks, 17 Nov); the database refuses giving one to yourself.
  const staffPeople = (people.data ?? []).filter((p) => p.profile_id !== myId);
  // Creating a task for a person (field team, 17 Nov): the Sales Coordinator and the Field Supervisor too, each to the
  // people the database allows; the picker comes from the same rule (staff_task_assignable_people).
  const giver = canGiveTasks(role);
  const givePeople = useTaskAssignablePeople(giver);
  // HR and the field roles have no desk: they see and finish their own tasks only.
  const hasDesk = role === "owner" || role === "administrator" || role === "coordinator" || role === "switchboard";
  const given = useStaffTasks(giver ? null : "open");
  const ask = useAskTaskQuestion();
  const [question, setQuestion] = useState<Record<string, string>>({});
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
        <p className="text-sm text-muted-foreground">Shared work between the desk, the Coordinator and the Owner. A founder decision always goes to the Owner. The Director and the Administrator can give a task to anyone in the office, the Sales Coordinator to the Field Supervisor and field consultants, and the Field Supervisor to field consultants; an Important task from the Director cannot be declined.</p>
      </div>

      <PendingTasksPanel />

      {giver ? (
        <form onSubmit={submitGive} className={`${card} grid gap-4 md:grid-cols-2`}>
          <h2 className="text-base font-bold text-brand-navy md:col-span-2">Give a task to a person</h2>
          <Field label="Title"><Input required minLength={3} maxLength={160} value={give.title} onChange={(e) => setGive({ ...give, title: e.target.value })} /></Field>
          <Field label="Give it to">
            <select className={selectClass} value={give.person} onChange={(e) => setGive({ ...give, person: e.target.value })}>
              <option value="">Choose a person...</option>
              {(givePeople.data ?? []).map((p) => <option key={p.profile_id} value={p.profile_id}>{p.full_name} ({ROLE_NAME[p.staff_role] ?? p.staff_role})</option>)}
            </select>
            {givePeople.error ? <span role="alert" className="text-xs text-red-600">{errorText(givePeople.error)}</span> : null}
            {givePeople.data && givePeople.data.length === 0 ? <span className="text-xs text-muted-foreground">Nobody you can give a task to has access yet.</span> : null}
          </Field>
          <Field label="Priority">
            <select className={selectClass} value={give.priority} onChange={(e) => setGive({ ...give, priority: e.target.value })}>
              <option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option>
              {role === "owner" ? <option value="important">Important — from the Director (cannot be declined)</option> : null}
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

      {giver ? (
        <section className={card}>
          <h2 className="mb-2 text-base font-bold text-brand-navy">Tasks I gave</h2>
          {given.error ? <p role="alert" className="text-sm text-red-600">{errorText(given.error)}</p> : null}
          <ul className="divide-y divide-border text-sm">
            {(given.data ?? []).filter((t) => t.given_by_me).map((t) => {
              const [label, cls] = givenState(t);
              return (
                <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    <span className="font-semibold text-brand-navy">{t.title}</span>
                    {t.priority === "important" ? <span className={IMPORTANT_BADGE}>Important</span> : null}
                    <span className="block text-xs text-muted-foreground">
                      {t.assigned_name ?? "Someone"}{t.route_to ? ` (${ROLE_NAME[t.route_to] ?? t.route_to})` : ""}{t.due_at ? ` · due ${fmt(t.due_at)}` : ""}
                    </span>
                  </span>
                  <span className={`rounded px-1.5 py-0.5 text-xs ${cls}`}>{label}</span>
                </li>
              );
            })}
            {given.data && given.data.filter((t) => t.given_by_me).length === 0 ? <li className="py-2 text-muted-foreground">You have not given any tasks yet.</li> : null}
          </ul>
        </section>
      ) : null}

      {hasDesk ? <form onSubmit={submit} className={`${card} grid gap-4 md:grid-cols-2`}>
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
      </form> : null}

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
                {t.priority === "important" ? <span className={IMPORTANT_BADGE}>Important — from the Director</span> : null}
                {t.priority === "high" ? <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-800">high</span> : null}
                {t.task_kind === "founder_decision" ? <span className="ml-2 rounded bg-violet-100 px-1.5 py-0.5 text-xs text-violet-800">founder decision</span> : null}
                {t.task_kind === "materials_request" ? <span className="ml-2 rounded bg-teal-100 px-1.5 py-0.5 text-xs text-teal-800">marketing materials</span> : null}
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
                    {staffPeople.filter((p) => p.profile_id !== t.assigned_to).map((p) => (
                      <option key={p.profile_id} value={p.profile_id}>{p.full_name} ({ROLE_NAME[p.staff_role] ?? p.staff_role})</option>
                    ))}
                  </select>
                  <button type="button" className="text-xs font-semibold text-brand-teal underline" disabled={!reassignTo[t.id] || assign.isPending}
                    onClick={() => assign.mutate({ taskId: t.id, assignee: reassignTo[t.id], note: "" }, { onSuccess: () => toast.success("Task given"), onError: (e) => toast.error(errorText(e)) })}>
                    Give
                  </button>
                </div>
              ) : null}
              <p className={`text-xs ${t.overdue ? "text-red-600" : "text-muted-foreground"}`}>
                With {t.assigned_name ?? ROLE_NAME[t.route_to] ?? t.route_to}{t.business_name ? ` · ${t.business_name}` : ""} · from {t.created_by_name}{t.due_at ? ` · due ${fmt(t.due_at)}` : ""}{t.overdue ? " · overdue" : ""}
              </p>
              {t.status === "open" ? (
                <div className="flex flex-wrap gap-3 pt-1">
                  {t.task_kind !== "founder_decision" ? (
                    <button type="button" className="text-xs font-semibold text-green-700 underline"
                      onClick={() => close.mutate({ taskId: t.id, outcome: "done", note: "" }, { onError: (e) => toast.error(errorText(e)) })}>Mark done</button>
                  ) : null}
                  {t.task_kind !== "founder_decision" && hasDesk ? targets.filter((x) => x !== t.route_to).map((to) => (
                    <button key={to} type="button" className="text-xs font-semibold text-brand-teal underline" onClick={() => doRoute(t, to)}>Send to {to}</button>
                  )) : null}
                </div>
              ) : null}
              {t.status === "open" && t.priority === "important" && t.assigned_to === myId && t.acceptance === "accepted" ? (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <input className="h-9 max-w-xs rounded-md border border-input px-3 text-sm" maxLength={500} aria-label="Your question for the Director"
                    placeholder="Ask the Director a question" value={question[t.id] ?? ""} onChange={(e) => setQuestion({ ...question, [t.id]: e.target.value })} />
                  <button type="button" className="text-xs font-semibold text-brand-teal underline" disabled={ask.isPending || (question[t.id] ?? "").trim().length < 5}
                    onClick={() => ask.mutate({ taskId: t.id, question: question[t.id] ?? "" }, {
                      onSuccess: () => { toast.success("Question sent to the Director"); setQuestion({ ...question, [t.id]: "" }); },
                      onError: (e) => toast.error(errorText(e)),
                    })}>Ask a question</button>
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
