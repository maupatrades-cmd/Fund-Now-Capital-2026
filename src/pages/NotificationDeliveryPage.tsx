import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Clock3, MailCheck, RefreshCw, RotateCcw, Search, Send, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import {
  useNotificationDeliveryWorkspace,
  useRetryNotificationEmail,
  type EmailDeliveryAttempt,
  type EmailDeliveryStatus,
} from "@/hooks/useNotificationDeliveryWorkspace";

const styles: Record<EmailDeliveryStatus, string> = {
  pending: "border-amber-200 bg-amber-50 text-amber-800",
  sent: "border-emerald-200 bg-emerald-50 text-emerald-800",
  delivered: "border-emerald-200 bg-emerald-50 text-emerald-800",
  failed: "border-red-200 bg-red-50 text-red-700",
  dead_letter: "border-red-300 bg-red-100 text-red-900",
  skipped: "border-slate-200 bg-slate-50 text-slate-600",
};

function latestAttempt(attempts: EmailDeliveryAttempt[]) {
  return [...attempts].sort((a, b) => b.attemptNumber - a.attemptNumber)[0];
}

export default function NotificationDeliveryPage() {
  const workspace = useNotificationDeliveryWorkspace();
  const retry = useRetryNotificationEmail();
  const [status, setStatus] = useState<"all" | EmailDeliveryStatus>("all");
  const [search, setSearch] = useState("");

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (workspace.data ?? []).filter((row) => {
      const latest = latestAttempt(row.attempts);
      if (status !== "all" && latest?.status !== status) return false;
      if (!needle) return true;
      return [row.title, row.recipient_name, row.recipient_email, row.event_type]
        .some((value) => value?.toLowerCase().includes(needle));
    });
  }, [workspace.data, search, status]);

  const counts = useMemo(() => {
    const values = { pending: 0, sent: 0, failed: 0, deadLetter: 0 };
    for (const row of workspace.data ?? []) {
      const value = latestAttempt(row.attempts)?.status;
      if (value === "pending") values.pending += 1;
      if (value === "sent" || value === "delivered") values.sent += 1;
      if (value === "failed") values.failed += 1;
      if (value === "dead_letter") values.deadLetter += 1;
    }
    return values;
  }, [workspace.data]);

  const requestRetry = (attempt: EmailDeliveryAttempt) => {
    retry.mutate(attempt.id, {
      onSuccess: () => toast.success("Email retry queued."),
      onError: (error) => toast.error(error instanceof Error ? error.message : "Retry could not be queued."),
    });
  };

  return (
    <div className="max-w-7xl space-y-6">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-brand-teal">Owner operations</p>
          <h1 className="mt-2 text-3xl font-bold text-brand-navy">Notification delivery centre</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            Trace every email attempt, act on failures, and return to the invitation, offer, meeting, or workflow that created it.
          </p>
        </div>
        <Link to="/notifications" className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-border bg-white px-4 text-sm font-semibold text-brand-navy hover:bg-slate-50">
          <MailCheck className="h-4 w-4" aria-hidden="true" /> View in-app notifications
        </Link>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Delivery health">
        {[
          { label: "Delivered", value: counts.sent, icon: CheckCircle2, tone: "text-emerald-600" },
          { label: "Pending", value: counts.pending, icon: Clock3, tone: "text-amber-600" },
          { label: "Retry available", value: counts.failed, icon: RotateCcw, tone: "text-red-600" },
          { label: "Needs intervention", value: counts.deadLetter, icon: ShieldAlert, tone: "text-red-800" },
        ].map((item) => (
          <article key={item.label} className="rounded-xl border border-border bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between"><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{item.label}</p><item.icon className={`h-5 w-5 ${item.tone}`} aria-hidden="true" /></div>
            <p className="mt-3 text-3xl font-bold text-brand-navy">{item.value}</p>
          </article>
        ))}
      </section>

      <section className="grid gap-3 rounded-xl border border-border bg-white p-4 shadow-sm sm:grid-cols-[minmax(0,1fr)_220px]">
        <label className="relative">
          <span className="sr-only">Search deliveries</span>
          <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search recipient, event, or subject" className="min-h-10 w-full rounded-lg border border-border pl-10 pr-3 text-sm outline-none focus:border-brand-teal" />
        </label>
        <label>
          <span className="sr-only">Filter by delivery status</span>
          <select value={status} onChange={(event) => setStatus(event.target.value as typeof status)} className="min-h-10 w-full rounded-lg border border-border bg-white px-3 text-sm outline-none focus:border-brand-teal">
            <option value="all">All statuses</option><option value="pending">Pending</option><option value="sent">Sent</option><option value="failed">Failed</option><option value="dead_letter">Needs intervention</option><option value="skipped">Skipped</option>
          </select>
        </label>
      </section>

      {workspace.isLoading ? <div className="rounded-xl border border-border bg-white p-10 text-center text-sm text-muted-foreground"><RefreshCw className="mx-auto mb-3 h-5 w-5 animate-spin" />Loading delivery evidence…</div> : null}
      {workspace.isError ? <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">Could not load the Owner delivery workspace: {workspace.error.message}</div> : null}

      {!workspace.isLoading && !workspace.isError && rows.length === 0 ? <div className="rounded-xl border border-dashed border-border bg-white p-10 text-center"><Send className="mx-auto h-7 w-7 text-brand-teal" /><p className="mt-3 font-semibold text-brand-navy">No deliveries match this view</p><p className="mt-1 text-sm text-muted-foreground">New email attempts will appear here automatically.</p></div> : null}

      <div className="space-y-4">
        {rows.map((row) => {
          const latest = latestAttempt(row.attempts);
          if (!latest) return null;
          const canRetry = latest.status === "failed" && latest.attemptNumber < 3;
          return (
            <article key={row.notification_id} className="rounded-xl border border-border bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2"><h2 className="font-bold text-brand-navy">{row.title}</h2><span className="rounded bg-slate-100 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-600">{row.event_type.replaceAll("_", " ")}</span></div>
                  <p className="mt-2 text-sm text-muted-foreground">To {row.recipient_name || "Recipient"} <span className="break-all">({row.recipient_email || "email unavailable"})</span></p>
                  <p className="mt-1 text-xs text-muted-foreground">Created {new Date(row.created_at).toLocaleString("en-ZA")}</p>
                </div>
                <span className={`inline-flex w-fit items-center rounded-full border px-3 py-1.5 text-xs font-bold ${styles[latest.status]}`}>{latest.status.replaceAll("_", " ")} · attempt {latest.attemptNumber}/3</span>
              </div>
              {latest.errorMessage ? <p className="mt-4 flex items-start gap-2 rounded-lg border border-red-100 bg-red-50 p-3 text-xs leading-5 text-red-700"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{latest.errorMessage}</p> : null}
              <div className="mt-4 flex flex-wrap gap-2">
                {row.link_url ? <Link to={row.link_url} className="inline-flex min-h-10 items-center rounded-lg border border-border px-3 text-xs font-semibold text-brand-navy hover:bg-slate-50">Open source record</Link> : null}
                {canRetry ? <button type="button" disabled={retry.isPending} onClick={() => requestRetry(latest)} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-brand-teal px-3 text-xs font-bold text-white hover:bg-brand-teal/90 disabled:opacity-50"><RotateCcw className={`h-4 w-4 ${retry.isPending && retry.variables === latest.id ? "animate-spin" : ""}`} />Queue retry</button> : null}
              </div>
              {row.attempts.length > 1 ? <details className="mt-4"><summary className="cursor-pointer text-xs font-semibold text-brand-teal">View {row.attempts.length} attempts</summary><ol className="mt-3 space-y-2">{row.attempts.map((attempt) => <li key={attempt.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs"><span>Attempt {attempt.attemptNumber} · {new Date(attempt.createdAt).toLocaleString("en-ZA")}</span><span className="font-semibold">{attempt.status.replaceAll("_", " ")}</span></li>)}</ol></details> : null}
            </article>
          );
        })}
      </div>
    </div>
  );
}
