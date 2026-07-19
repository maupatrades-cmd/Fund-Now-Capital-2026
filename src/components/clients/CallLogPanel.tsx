import { useState } from "react";
import { toast } from "sonner";
import {
  useCallLogs,
  useAddCallLog,
  CALL_MEDIA,
  type CallLog,
  type CallMedium,
} from "@/hooks/useCallLogs";

const ctl =
  "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-brand-navy outline-none focus:border-brand-teal focus:ring-2 focus:ring-brand-teal/20";

const mediumLabel = (m: CallMedium) => CALL_MEDIA.find((x) => x.value === m)?.label ?? m;
const todayISO = () => new Date().toLocaleDateString("en-CA"); // yyyy-mm-dd, local

export function CallLogPanel({ clientId }: { clientId: string }) {
  const { data: logs, isLoading } = useCallLogs(clientId);
  const add = useAddCallLog();

  const [callDate, setCallDate] = useState(todayISO());
  const [callTime, setCallTime] = useState("");
  const [medium, setMedium] = useState<CallMedium>("call");
  const [duration, setDuration] = useState("");
  const [topics, setTopics] = useState("");
  const [clientPromises, setClientPromises] = useState("");
  const [thapeloPromises, setThapeloPromises] = useState("");
  const [followUp, setFollowUp] = useState(false);
  const [followUpDate, setFollowUpDate] = useState("");
  const [nextAction, setNextAction] = useState("");

  const canSave = !add.isPending && !!callDate && (!followUp || !!followUpDate);

  const reset = () => {
    setCallTime("");
    setDuration("");
    setTopics("");
    setClientPromises("");
    setThapeloPromises("");
    setFollowUp(false);
    setFollowUpDate("");
    setNextAction("");
  };

  const onSave = async () => {
    if (followUp && !followUpDate) {
      toast.error("Set a follow-up date, or turn off the follow-up.");
      return;
    }
    try {
      await add.mutateAsync({
        clientId,
        call_date: callDate,
        call_time: callTime || null,
        medium,
        duration_minutes: duration ? Number(duration) : null,
        discussed_topics: topics.trim() || null,
        client_promises: clientPromises.trim() || null,
        thapelo_promises: thapeloPromises.trim() || null,
        follow_up_needed: followUp,
        follow_up_date: followUp ? followUpDate : null,
        next_action: nextAction.trim() || null,
      });
      toast.success("Call logged");
      reset();
    } catch (e) {
      toast.error((e as Error).message || "Could not log the call");
    }
  };

  return (
    <div className="space-y-5">
      {/* Add form */}
      <div className="space-y-3 rounded-lg border border-dashed border-border bg-slate-50 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
            Date
            <input type="date" className={ctl} value={callDate} onChange={(e) => setCallDate(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
            Time
            <input type="time" className={ctl} value={callTime} onChange={(e) => setCallTime(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
            Medium
            <select className={ctl} value={medium} onChange={(e) => setMedium(e.target.value as CallMedium)}>
              {CALL_MEDIA.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
            Duration (min)
            <input
              type="number"
              min={0}
              className={`${ctl} w-28`}
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
            />
          </label>
        </div>

        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          Discussed
          <textarea className={ctl} rows={2} value={topics} onChange={(e) => setTopics(e.target.value)} />
        </label>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
            Client promised
            <textarea className={ctl} rows={2} value={clientPromises} onChange={(e) => setClientPromises(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
            Thapelo promised
            <textarea className={ctl} rows={2} value={thapeloPromises} onChange={(e) => setThapeloPromises(e.target.value)} />
          </label>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <label className="flex items-center gap-2 text-xs font-medium text-brand-navy">
            <input type="checkbox" checked={followUp} onChange={(e) => setFollowUp(e.target.checked)} />
            Follow-up needed
          </label>
          {followUp && (
            <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
              Follow-up date
              <input type="date" className={ctl} value={followUpDate} onChange={(e) => setFollowUpDate(e.target.value)} />
            </label>
          )}
          <label className="flex flex-1 flex-col gap-1 text-xs font-medium text-muted-foreground">
            Next action
            <input type="text" className={ctl} value={nextAction} onChange={(e) => setNextAction(e.target.value)} />
          </label>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onSave}
            disabled={!canSave}
            className="rounded-lg bg-brand-teal px-4 py-2 text-sm font-semibold text-white hover:bg-brand-teal/90 disabled:opacity-60"
          >
            {add.isPending ? "Saving…" : "Log call"}
          </button>
          <span className="text-xs text-muted-foreground">
            A follow-up with a date triggers a reminder when it comes due.
          </span>
        </div>
      </div>

      {/* List */}
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading call log…</p>
      ) : !logs || logs.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">No calls logged yet.</p>
      ) : (
        <ul className="space-y-3">
          {logs.map((c) => (
            <CallRow key={c.id} call={c} />
          ))}
        </ul>
      )}
    </div>
  );
}

function CallRow({ call }: { call: CallLog }) {
  const when = new Date(call.call_date + "T00:00:00").toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return (
    <li className="rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold text-brand-navy">{mediumLabel(call.medium)}</span>
        <span className="text-muted-foreground">· {when}</span>
        {call.call_time && <span className="text-muted-foreground">{call.call_time.slice(0, 5)}</span>}
        {call.duration_minutes != null && (
          <span className="text-muted-foreground">· {call.duration_minutes} min</span>
        )}
        {call.follow_up_needed && call.follow_up_date && (
          <span className="rounded-md bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
            Follow up {new Date(call.follow_up_date + "T00:00:00").toLocaleDateString("en-ZA")}
          </span>
        )}
      </div>
      {call.discussed_topics && (
        <p className="mt-2 whitespace-pre-wrap text-sm text-brand-navy">{call.discussed_topics}</p>
      )}
      <dl className="mt-2 space-y-1 text-xs text-muted-foreground">
        {call.client_promises && (
          <div>
            <span className="font-medium text-brand-navy">Client promised:</span> {call.client_promises}
          </div>
        )}
        {call.thapelo_promises && (
          <div>
            <span className="font-medium text-brand-navy">Thapelo promised:</span> {call.thapelo_promises}
          </div>
        )}
        {call.next_action && (
          <div>
            <span className="font-medium text-brand-navy">Next action:</span> {call.next_action}
          </div>
        )}
      </dl>
    </li>
  );
}
