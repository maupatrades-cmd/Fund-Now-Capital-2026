import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Loader2,
  MoreVertical,
  Eye,
  UserCheck,
  Ban,
  Search,
  Inbox,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import {
  useApplications,
  useMoveToScreening,
  useRejectApplication,
} from "@/hooks/useApplications";
import {
  statusLabel,
  statusBadgeClass,
  formatAppliedDate,
  referralSourceLabel,
  type ApplicationFilter,
  type ContractorApplication,
} from "@/lib/applications";

const btnNeutral =
  "inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-brand-navy hover:bg-slate-50";
const labelCls = "block text-xs font-medium text-muted-foreground mb-1";
const errCls = "mt-1 text-xs text-red-600";

const FILTER_TABS: { value: ApplicationFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "applicant", label: "Applicant" },
  { value: "screening", label: "Screening" },
  { value: "rejected", label: "Rejected" },
];

export default function ApplicationsPanel() {
  const { data: applications, isLoading, isError, refetch } = useApplications();
  const [filter, setFilter] = useState<ApplicationFilter>("all");
  const [search, setSearch] = useState("");
  const [viewing, setViewing] = useState<ContractorApplication | null>(null);
  const [rejecting, setRejecting] = useState<ContractorApplication | null>(null);

  const counts = useMemo(() => {
    const list = applications ?? [];
    return {
      all: list.length,
      applicant: list.filter((a) => a.status === "applicant").length,
      screening: list.filter((a) => a.status === "screening").length,
      rejected: list.filter((a) => a.status === "rejected").length,
    };
  }, [applications]);

  const filtered = useMemo(() => {
    let list = applications ?? [];
    if (filter !== "all") list = list.filter((a) => a.status === filter);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((a) => a.full_name.toLowerCase().includes(q) || a.email.toLowerCase().includes(q));
    return list;
  }, [applications, filter, search]);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading applications…
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-6 py-14 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-red-100 text-red-600">
          <AlertTriangle className="h-7 w-7" strokeWidth={1.75} />
        </span>
        <div className="space-y-1">
          <p className="text-base font-semibold text-brand-navy">Couldn't load applications</p>
          <p className="mx-auto max-w-sm text-sm text-muted-foreground">
            Something went wrong fetching the list. Check your connection and try again.
          </p>
        </div>
        <button type="button" onClick={() => void refetch()} className={btnNeutral + " mt-1"}>
          <Loader2 className="h-4 w-4" /> Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Sub-filter + search */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1">
          {FILTER_TABS.map((t) => {
            const active = filter === t.value;
            return (
              <button
                key={t.value}
                type="button"
                onClick={() => setFilter(t.value)}
                className={
                  "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors " +
                  (active ? "bg-brand-navy text-white" : "text-muted-foreground hover:bg-slate-100 hover:text-brand-navy")
                }
              >
                {t.label}
                <span className={"ml-1.5 text-xs " + (active ? "text-white/70" : "text-muted-foreground")}>
                  {counts[t.value]}
                </span>
              </button>
            );
          })}
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or email"
            className="w-56 rounded-lg border border-border bg-white py-1.5 pl-8 pr-3 text-sm text-brand-navy outline-none focus:border-brand-teal focus:ring-2 focus:ring-brand-teal/20"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title={applications && applications.length > 0 ? "No matching applications" : "No applications yet"}
          description={
            applications && applications.length > 0
              ? "Try a different filter or search."
              : "Applications submitted through the public /apply form will appear here."
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-white shadow-sm">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 font-medium">Full name</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Phone</th>
                <th className="px-4 py-3 font-medium">Applied</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((a) => (
                <tr key={a.id} className="border-b border-border/60 last:border-0">
                  <td className="px-4 py-3 font-medium text-brand-navy">{a.full_name}</td>
                  <td className="px-4 py-3 text-brand-navy">{a.email}</td>
                  <td className="px-4 py-3 text-muted-foreground">{a.phone}</td>
                  <td className="px-4 py-3 text-muted-foreground">{formatAppliedDate(a.submitted_at)}</td>
                  <td className="px-4 py-3">
                    <Badge className={statusBadgeClass(a.status)}>{statusLabel(a.status)}</Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <RowActions
                      application={a}
                      onView={() => setViewing(a)}
                      onReject={() => setRejecting(a)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {viewing && <ViewDrawer application={viewing} onClose={() => setViewing(null)} />}
      {rejecting && <RejectDialog application={rejecting} onClose={() => setRejecting(null)} />}
    </div>
  );
}

// ---- per-row actions menu ---------------------------------------------------

function RowActions({
  application,
  onView,
  onReject,
}: {
  application: ContractorApplication;
  onView: () => void;
  onReject: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const move = useMoveToScreening();

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    const r = btnRef.current?.getBoundingClientRect();
    if (r) {
      // Rendered via createPortal (below) so the table's overflow-x container
      // can't clip it — same pattern as TeamPage's RowActions. Placement is
      // edge-safe: open below the button normally, but flip above when there
      // isn't room below (otherwise the scroll-to-close listener makes a
      // bottom-row menu unreachable), and clamp to 8px so it never runs off the
      // top edge either.
      const MENU_H = 168; // ≈ 3 items + padding; the tallest this menu gets
      const below = r.bottom + 4;
      const top = below + MENU_H > window.innerHeight ? Math.max(8, r.top - 4 - MENU_H) : below;
      setPos({ top, right: Math.max(8, window.innerWidth - r.right) });
    }
    setOpen(true);
  };

  const canMove = application.status === "applicant";
  const canReject = application.status === "applicant" || application.status === "screening";

  const onMove = async () => {
    setOpen(false);
    try {
      await move.mutateAsync(application.id);
      toast.success(`${application.full_name} moved to Screening`);
    } catch (e) {
      toast.error((e as Error).message || "Could not move to screening.");
    }
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        className="rounded-lg p-1.5 text-muted-foreground hover:bg-slate-100 hover:text-brand-navy"
        aria-label="Row actions"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <MoreVertical className="h-4 w-4" />
      </button>
      {open &&
        pos &&
        createPortal(
          <>
            <button
              type="button"
              className="fixed inset-0 z-40 cursor-default"
              aria-hidden="true"
              tabIndex={-1}
              onClick={() => setOpen(false)}
            />
            <div
              role="menu"
              style={{ position: "fixed", top: pos.top, right: pos.right }}
              className="z-50 w-48 overflow-hidden rounded-lg border border-border bg-white py-1 text-left shadow-lg"
            >
              <MenuItem icon={Eye} label="View application" onClick={() => { setOpen(false); onView(); }} />
              {canMove && (
                <MenuItem
                  icon={UserCheck}
                  label="Move to screening"
                  disabled={move.isPending}
                  onClick={onMove}
                />
              )}
              {canReject && (
                <MenuItem icon={Ban} label="Reject" danger onClick={() => { setOpen(false); onReject(); }} />
              )}
            </div>
          </>,
          document.body,
        )}
    </>
  );
}

function MenuItem({
  icon: Icon,
  label,
  onClick,
  danger,
  disabled,
}: {
  icon: typeof Eye;
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={
        "flex w-full items-center gap-2 px-3 py-2 text-sm disabled:opacity-50 " +
        (danger ? "text-red-700 hover:bg-red-50" : "text-brand-navy hover:bg-slate-50")
      }
    >
      <Icon className="h-4 w-4" /> {label}
    </button>
  );
}

// ---- view drawer ------------------------------------------------------------

function ViewDrawer({ application, onClose }: { application: ContractorApplication; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose} role="presentation">
      <div
        className="h-full w-full max-w-md overflow-y-auto bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Application details"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border bg-brand-navy px-5 py-4">
          <div>
            <h3 className="text-base font-semibold text-white">{application.full_name}</h3>
            <p className="text-xs text-white/60">
              Applied {formatAppliedDate(application.submitted_at)}
            </p>
          </div>
          <Badge className={statusBadgeClass(application.status)}>{statusLabel(application.status)}</Badge>
        </div>

        <div className="space-y-4 p-5">
          <Detail label="Email" value={application.email} />
          <Detail label="Phone" value={application.phone} />
          <Detail label="SA ID number" value={application.id_number || "—"} />
          <Detail label="Physical address" value={application.physical_address} multiline />
          <Detail label="Years of experience" value={`${application.experience_years}`} />
          <Detail
            label="How they heard about us"
            value={referralSourceLabel(application.referral_source, application.referral_source_other)}
          />
          <Detail label="Motivation" value={application.motivation_text} multiline />
          {application.screening_notes && (
            <Detail label="Screening notes" value={application.screening_notes} multiline />
          )}
          {application.status === "rejected" && application.rejected_reason && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3">
              <p className="text-xs font-medium text-red-700">Rejection reason</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-red-800">{application.rejected_reason}</p>
            </div>
          )}
        </div>

        <div className="flex justify-end border-t border-border p-4">
          <button type="button" onClick={onClose} className={btnNeutral}>Close</button>
        </div>
      </div>
    </div>
  );
}

function Detail({ label, value, multiline }: { label: string; value: string; multiline?: boolean }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={"mt-1 text-sm text-brand-navy " + (multiline ? "whitespace-pre-wrap" : "")}>{value}</p>
    </div>
  );
}

// ---- reject dialog ----------------------------------------------------------

function RejectDialog({ application, onClose }: { application: ContractorApplication; onClose: () => void }) {
  const reject = useRejectApplication();
  const [reason, setReason] = useState("");
  const [serverErr, setServerErr] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const onConfirm = async () => {
    setServerErr(null);
    try {
      await reject.mutateAsync({ applicationId: application.id, reason: reason.trim() });
      toast.success(`${application.full_name}'s application rejected`);
      onClose();
    } catch (e) {
      const msg = (e as Error).message || "Could not reject the application.";
      setServerErr(msg);
      toast.error(msg);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose} role="presentation">
      <div
        className="w-full max-w-lg space-y-4 rounded-xl border border-border bg-white p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Reject application"
      >
        <h3 className="text-base font-semibold text-brand-navy">Reject application</h3>
        <p className="flex items-start gap-2 rounded-lg bg-red-50 p-2.5 text-sm text-red-800">
          <Ban className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <strong>{application.full_name}</strong>'s application will be marked rejected. Their record is kept
            for your history.
          </span>
        </p>
        <div>
          <label className={labelCls} htmlFor="reject-reason">Reason (required)</label>
          <textarea
            id="reject-reason"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Insufficient relevant experience for the role."
            className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-brand-navy outline-none focus:border-brand-teal focus:ring-2 focus:ring-brand-teal/20"
          />
        </div>
        {serverErr && <p className={errCls}>{serverErr}</p>}
        <div className="flex items-center justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className={btnNeutral}>Cancel</button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={reject.isPending || reason.trim() === ""}
            className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
          >
            {reject.isPending ? "Rejecting…" : "Reject application"}
          </button>
        </div>
      </div>
    </div>
  );
}
