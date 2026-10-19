import { toast } from "sonner";
import { useAcknowledgeNotice, useMyNotices } from "@/hooks/useComms";

// The caller's notices. A "Needs attention" notice asks for an acknowledgement; the Administrator and the
// Founder see who has acknowledged.
const fmt = (iso: string) => new Date(iso).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg", dateStyle: "medium", timeStyle: "short" });

export function NoticesInbox() {
  const notices = useMyNotices();
  const ack = useAcknowledgeNotice();
  if (notices.error) return <p role="alert" className="text-sm text-red-600">{(notices.error as Error).message}</p>;
  if (!notices.data) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (notices.data.length === 0) return <p className="text-sm text-muted-foreground">No notices yet.</p>;
  return (
    <ul className="divide-y divide-border">
      {notices.data.map((n) => (
        <li key={n.notice_id} className={`space-y-1 py-3 text-sm ${n.needs_attention && !n.acknowledged_at ? "rounded-lg bg-amber-50 px-3" : ""}`}>
          <p className="font-semibold text-brand-navy">
            {n.title}
            {n.needs_attention ? <span className="ml-2 rounded bg-amber-200 px-1.5 py-0.5 text-xs text-amber-900">Needs attention</span> : null}
          </p>
          <p className="whitespace-pre-line">{n.body}</p>
          <p className="text-xs text-muted-foreground">From {n.posted_by ?? "Fund Now Capital"} · {fmt(n.created_at)}</p>
          {n.needs_attention ? (
            n.acknowledged_at ? (
              <p className="text-xs text-green-700">You acknowledged this on {fmt(n.acknowledged_at)}</p>
            ) : (
              <button type="button" className="rounded-lg bg-brand-teal px-4 py-2 text-xs font-semibold text-white disabled:opacity-50" disabled={ack.isPending}
                onClick={() => ack.mutate(n.notice_id, { onSuccess: () => toast.success("Acknowledged"), onError: (e) => toast.error((e as Error).message) })}>
                I have read this
              </button>
            )
          ) : null}
        </li>
      ))}
    </ul>
  );
}
