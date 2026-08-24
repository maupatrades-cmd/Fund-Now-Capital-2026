import { useMemo } from "react";
import { CheckCircle2, ClipboardCheck, Clock3, FileWarning, Loader2, Play, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import PortalShell from "@/components/portal/PortalShell";
import {
  useContractorDocumentChase,
  useCreateContractorDocumentChaseTask,
  useSetContractorChaseTaskStatus,
  type ContractorDocumentChaseItem,
} from "@/hooks/useContractorDocumentChase";

const STATUS_STYLE: Record<ContractorDocumentChaseItem["document_status"], string> = {
  missing: "bg-amber-50 text-amber-800 ring-amber-200",
  submitted: "bg-sky-50 text-sky-700 ring-sky-200",
  accepted: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  rejected: "bg-red-50 text-red-700 ring-red-200",
};

function label(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function dateLabel(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric" });
}

export default function ContractorDocumentChasePage() {
  const workspace = useContractorDocumentChase();
  const createTask = useCreateContractorDocumentChaseTask();
  const setStatus = useSetContractorChaseTaskStatus();
  const groups = useMemo(() => {
    const result = new Map<string, ContractorDocumentChaseItem[]>();
    for (const item of workspace.data ?? []) result.set(item.deal_id, [...(result.get(item.deal_id) ?? []), item]);
    return [...result.values()];
  }, [workspace.data]);

  async function create(item: ContractorDocumentChaseItem) {
    try {
      await createTask.mutateAsync({ dealId: item.deal_id, documentType: item.document_type });
      toast.success("Document follow-up task created");
    } catch (error) {
      toast.error((error as Error).message || "Could not create the follow-up task");
    }
  }

  async function update(taskId: string, status: "in_progress" | "completed") {
    try {
      await setStatus.mutateAsync({ taskId, status });
      toast.success(status === "completed" ? "Follow-up completed" : "Follow-up started");
    } catch (error) {
      toast.error((error as Error).message || "Could not update the follow-up task");
    }
  }

  return (
    <PortalShell portal="contractor">
      <div className="space-y-6">
        <header className="rounded-2xl bg-gradient-to-r from-brand-navy to-[#19546d] p-6 text-white shadow-sm">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-brand-teal">Client paperwork</p>
          <h1 className="mt-2 text-2xl font-bold">Document chase workspace</h1>
          <p className="mt-2 max-w-2xl text-sm text-white/75">See the exact approved paperwork for your attributed deals, track missing or rejected items, and manage your own follow-up tasks.</p>
        </header>

        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-slate-500">Only client-safe requirements and statuses are shown. Funder and Owner-only information stays private.</p>
          <button type="button" onClick={() => void workspace.refetch()} disabled={workspace.isFetching} className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-brand-navy disabled:opacity-60">
            <RefreshCw className={`h-4 w-4 ${workspace.isFetching ? "animate-spin" : ""}`} aria-hidden="true" /> Refresh
          </button>
        </div>

        {workspace.isPending ? <p className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">Loading assigned paperwork…</p> : null}
        {workspace.isError ? <p className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">The document workspace could not be loaded. Refresh and try again.</p> : null}
        {!workspace.isPending && !workspace.isError && groups.length === 0 ? (
          <section className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
            <ClipboardCheck className="mx-auto h-9 w-9 text-slate-300" aria-hidden="true" />
            <h2 className="mt-3 font-bold text-brand-navy">No active paperwork checklist yet</h2>
            <p className="mt-1 text-sm text-slate-500">A checklist appears after the Owner connects one of your attributed deals to an approved funding product and document rules.</p>
          </section>
        ) : null}

        {groups.map((items) => {
          const deal = items[0];
          const accepted = items.filter((item) => item.document_status === "accepted").length;
          return (
            <section key={deal.deal_id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50 px-5 py-4">
                <div>
                  <h2 className="font-bold text-brand-navy">{deal.client_business_name}</h2>
                  <p className="mt-1 text-xs text-slate-500">{deal.deal_reference ?? "Deal reference pending"} · {deal.product_name} · {label(deal.current_stage)}</p>
                </div>
                <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-brand-navy ring-1 ring-slate-200">{accepted} of {items.length} accepted</span>
              </div>
              <div className="divide-y divide-slate-100">
                {items.map((item) => {
                  const canChase = item.document_status === "missing" || item.document_status === "rejected";
                  return (
                    <article key={item.document_type} className="grid gap-4 p-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-semibold text-brand-navy">{label(item.document_type)}</h3>
                          <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold capitalize ring-1 ring-inset ${STATUS_STYLE[item.document_status]}`}>{item.document_status}</span>
                          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{item.requirement}</span>
                        </div>
                        <p className="mt-2 text-sm text-slate-500">{item.client_safe_reason ?? "Required for the selected funding package."}</p>
                        {item.rejection_reason ? <p className="mt-2 flex items-start gap-2 text-sm text-red-700"><FileWarning className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />Replacement needed: {label(item.rejection_reason)}</p> : null}
                        {item.task_id ? <p className="mt-2 flex items-center gap-2 text-xs text-slate-500"><Clock3 className="h-3.5 w-3.5" aria-hidden="true" />Follow-up {label(item.task_status ?? "open")}{dateLabel(item.task_due_at) ? ` · due ${dateLabel(item.task_due_at)}` : ""}</p> : null}
                      </div>
                      <div className="flex flex-wrap gap-2 md:justify-end">
                        {canChase && !item.task_id ? (
                          <button type="button" disabled={createTask.isPending} onClick={() => void create(item)} className="inline-flex items-center gap-2 rounded-xl bg-brand-teal px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">
                            {createTask.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ClipboardCheck className="h-4 w-4" aria-hidden="true" />} Create follow-up
                          </button>
                        ) : null}
                        {item.task_id && item.task_status === "open" ? <button type="button" disabled={setStatus.isPending} onClick={() => void update(item.task_id!, "in_progress")} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-brand-navy disabled:opacity-60"><Play className="h-4 w-4" aria-hidden="true" /> Start</button> : null}
                        {item.task_id && item.task_status === "in_progress" ? <button type="button" disabled={setStatus.isPending} onClick={() => void update(item.task_id!, "completed")} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"><CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Complete</button> : null}
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </PortalShell>
  );
}
