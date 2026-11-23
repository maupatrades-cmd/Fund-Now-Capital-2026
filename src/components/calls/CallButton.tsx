import { Phone } from "lucide-react";
import { useCalls } from "@/components/calls/callContext";
import { formatCallDuration, useCallHistory, type CallTarget } from "@/hooks/useCalls";

// "Call" next to a phone number. Shown to the Director only (can_place_calls on the server decides as well).
export function CallButton({ target, hasNumber = true, compact = false }: { target: CallTarget; hasNumber?: boolean; compact?: boolean }) {
  const { canCall, busy, startCall } = useCalls();
  if (!canCall || !hasNumber) return null;
  return (
    <button type="button" onClick={() => void startCall(target)} disabled={busy}
      aria-label={`Call ${target.name}`} title={`Call ${target.name} from the CRM`}
      className={compact
        ? "inline-flex items-center rounded-md p-1 text-brand-teal hover:bg-teal-50 disabled:opacity-40"
        : "inline-flex items-center gap-2 rounded-lg border border-brand-teal px-3 py-1.5 text-sm font-semibold text-brand-teal hover:bg-teal-50 disabled:opacity-40"}>
      <Phone className="h-4 w-4" aria-hidden="true" />
      {compact ? null : "Call"}
    </button>
  );
}

const STATUS: Record<string, string> = {
  completed: "Completed", busy: "Busy", "no-answer": "No answer", failed: "Failed", canceled: "Cancelled",
  initiated: "Started", ringing: "Ringing", "in-progress": "In progress", answered: "Answered",
};

// The Director's calls to this person / client / lead (masked numbers only).
export function CallHistory({ target }: { target: CallTarget }) {
  const { canCall } = useCalls();
  const calls = useCallHistory(target.kind, target.id, canCall);
  if (!canCall) return null;
  return (
    <section className="rounded-xl border border-border bg-white p-5 shadow-sm">
      <h2 className="mb-3 text-base font-bold text-brand-navy">Calls</h2>
      {calls.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {!calls.isLoading && (calls.data ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">No calls from the CRM yet.</p>
      ) : null}
      <ul className="space-y-2">
        {(calls.data ?? []).map((c) => (
          <li key={c.id} className="rounded-lg border border-border px-3 py-2 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium text-brand-navy">
                {new Date(c.started_at).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
              </span>
              <span className="text-xs text-muted-foreground">
                {STATUS[c.status] ?? c.status}{c.ended_at ? ` · ${formatCallDuration(c.duration_seconds)}` : ""} · {c.to_masked}
              </span>
            </div>
            {c.note ? <p className="mt-1 whitespace-pre-wrap text-xs text-slate-600">{c.note}</p> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
