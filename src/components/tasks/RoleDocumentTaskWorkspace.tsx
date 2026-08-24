import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock3, FileCheck2, Loader2, Play, RotateCcw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useDocumentTaskAssignees, useReassignDocumentTask, useRoleDocumentTasks, useSetDocumentTaskStatus, type RoleDocumentTask } from "@/hooks/useRoleDocumentTasks";

function label(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function dateLabel(value: string | null) {
  return value ? new Date(value).toLocaleString("en-ZA", { dateStyle: "medium", timeStyle: "short" }) : "No due date";
}

function TaskActions({ task }: { task: RoleDocumentTask }) {
  const mutation = useSetDocumentTaskStatus();
  const [blocking, setBlocking] = useState(false);
  const [reason, setReason] = useState("");

  async function setStatus(status: "open" | "in_progress" | "blocked" | "completed") {
    try {
      await mutation.mutateAsync({ taskId: task.task_id, status, blockerReason: status === "blocked" ? reason : undefined });
      setBlocking(false);
      setReason("");
      toast.success(status === "blocked" ? "Blocker recorded" : "Task updated");
    } catch (error) {
      toast.error((error as Error).message || "Could not update the task");
    }
  }

  return (
    <div className="mt-4 border-t border-slate-100 pt-4">
      {blocking ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          <input aria-label="Blocker reason" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="What is preventing this paperwork?" className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          <button type="button" disabled={mutation.isPending || reason.trim().length < 3} onClick={() => void setStatus("blocked")} className="rounded-lg bg-amber-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Save blocker</button>
          <button type="button" onClick={() => setBlocking(false)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold">Cancel</button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {task.status === "open" ? <button type="button" disabled={mutation.isPending} onClick={() => void setStatus("in_progress")} className="inline-flex items-center gap-2 rounded-lg bg-brand-navy px-3 py-2 text-sm font-semibold text-white"><Play className="h-4 w-4" aria-hidden="true" />Start</button> : null}
          {task.status === "blocked" ? <button type="button" disabled={mutation.isPending} onClick={() => void setStatus("in_progress")} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-brand-navy"><RotateCcw className="h-4 w-4" aria-hidden="true" />Resume</button> : null}
          {task.status !== "completed" ? <button type="button" disabled={mutation.isPending} onClick={() => setBlocking(true)} className="inline-flex items-center gap-2 rounded-lg border border-amber-200 px-3 py-2 text-sm font-semibold text-amber-800"><AlertTriangle className="h-4 w-4" aria-hidden="true" />Blocked</button> : null}
          {!task.is_submission_blocker && task.status !== "completed" ? <button type="button" disabled={mutation.isPending} onClick={() => void setStatus("completed")} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white"><CheckCircle2 className="h-4 w-4" aria-hidden="true" />Complete</button> : null}
          {mutation.isPending ? <Loader2 className="h-5 w-5 animate-spin text-slate-400" aria-label="Updating task" /> : null}
        </div>
      )}
    </div>
  );
}

function OwnerAssignment({ task }: { task: RoleDocumentTask }) {
  const assignees = useDocumentTaskAssignees(true);
  const mutation = useReassignDocumentTask();
  const [assignedTo, setAssignedTo] = useState(task.assigned_to ?? "");
  const [priority, setPriority] = useState(task.priority);

  async function save() {
    if (!assignedTo) return;
    try {
      await mutation.mutateAsync({ taskId: task.task_id, assignedTo, priority });
      toast.success("Document task reassigned");
    } catch (error) {
      toast.error((error as Error).message || "Could not reassign the task");
    }
  }

  return (
    <div className="mt-4 grid gap-2 rounded-xl bg-slate-50 p-3 sm:grid-cols-[minmax(0,1fr)_9rem_auto]">
      <label className="text-xs font-semibold text-slate-600">Assignee<select aria-label={`Assignee for ${task.title}`} value={assignedTo} onChange={(event) => setAssignedTo(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal text-slate-800"><option value="">Choose team member</option>{(assignees.data ?? []).map((person) => <option key={person.profile_id} value={person.profile_id}>{person.display_name} · {label(person.role)}</option>)}</select></label>
      <label className="text-xs font-semibold text-slate-600">Priority<select aria-label={`Priority for ${task.title}`} value={priority} onChange={(event) => setPriority(event.target.value as RoleDocumentTask["priority"])} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal"><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option></select></label>
      <button type="button" disabled={!assignedTo || mutation.isPending} onClick={() => void save()} className="self-end rounded-lg bg-brand-teal px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{mutation.isPending ? "Saving…" : "Assign"}</button>
    </div>
  );
}

export function RoleDocumentTaskWorkspace({ isOwner = false }: { isOwner?: boolean }) {
  const query = useRoleDocumentTasks();
  const [showResolved, setShowResolved] = useState(false);
  const tasks = useMemo(() => (query.data ?? []).filter((task) => showResolved ? task.status === "completed" : task.status !== "completed" && task.status !== "cancelled"), [query.data, showResolved]);
  const blockerCount = (query.data ?? []).filter((task) => task.is_submission_blocker).length;

  return (
    <section className="space-y-5" data-testid="role-document-task-workspace">
      <div className="overflow-hidden rounded-2xl bg-gradient-to-br from-brand-navy to-[#16445d] p-6 text-white shadow-lg">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-brand-teal">Governed paperwork</p><h1 className="mt-2 text-2xl font-bold">Document task workspace</h1><p className="mt-2 max-w-2xl text-sm text-white/70">Tasks come from the approved product and funder checklist. A required item remains a submission blocker until the Owner accepts the document.</p></div>
          <div className="rounded-xl border border-white/15 bg-white/10 px-4 py-3 text-right"><p className="text-2xl font-bold">{blockerCount}</p><p className="text-xs text-white/65">submission blockers</p></div>
        </div>
      </div>

      <div className="flex gap-2"><button type="button" onClick={() => setShowResolved(false)} className={`rounded-full px-4 py-2 text-sm font-semibold ${!showResolved ? "bg-brand-navy text-white" : "border border-slate-200 bg-white text-slate-700"}`}>Active</button><button type="button" onClick={() => setShowResolved(true)} className={`rounded-full px-4 py-2 text-sm font-semibold ${showResolved ? "bg-brand-navy text-white" : "border border-slate-200 bg-white text-slate-700"}`}>Resolved</button></div>

      {query.isPending ? <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">Loading document tasks…</div> : null}
      {query.isError ? <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">Could not load authorized document tasks.</div> : null}
      {!query.isPending && !query.isError && tasks.length === 0 ? <div className="rounded-xl border border-slate-200 bg-white p-10 text-center"><ShieldCheck className="mx-auto h-8 w-8 text-emerald-600" aria-hidden="true" /><h2 className="mt-3 font-bold text-brand-navy">No tasks in this view</h2><p className="mt-1 text-sm text-slate-500">Only governed paperwork assigned to this account appears here.</p></div> : null}

      <div className="grid gap-4 xl:grid-cols-2">
        {tasks.map((task) => <article key={task.task_id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-xs font-bold uppercase tracking-wide text-brand-teal">{label(task.document_type)}</p><h2 className="mt-1 font-bold text-brand-navy">{task.title}</h2><p className="mt-1 text-sm text-slate-600">{task.client_business_name}{task.deal_reference ? ` · ${task.deal_reference}` : ""}</p></div><span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${task.status === "blocked" ? "bg-amber-100 text-amber-800" : task.status === "completed" ? "bg-emerald-100 text-emerald-700" : "bg-blue-100 text-blue-700"}`}>{label(task.status)}</span></div><div className="mt-4 grid gap-2 text-xs text-slate-600 sm:grid-cols-2"><p className="flex items-center gap-2"><FileCheck2 className="h-4 w-4" aria-hidden="true" />Document: {label(task.document_status)}</p><p className="flex items-center gap-2"><Clock3 className="h-4 w-4" aria-hidden="true" />{dateLabel(task.due_at)}</p></div>{task.is_submission_blocker ? <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><strong>Submission blocked:</strong> {task.submission_blocking_reason ?? "Required document is not accepted"}</div> : <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">Submission evidence is resolved for this item.</div>}{task.status === "blocked" && task.blocker_reason ? <p className="mt-3 text-sm text-amber-800"><strong>Recorded blocker:</strong> {task.blocker_reason}</p> : null}{isOwner ? <OwnerAssignment task={task} /> : null}<TaskActions task={task} /></article>)}
      </div>
    </section>
  );
}
