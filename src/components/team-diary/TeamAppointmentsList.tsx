import { useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { useCancelTeamAppointment, useMoveTeamAppointment, type TeamAppointment } from "@/hooks/useTeamDiary";

// Shared by the staff Team diary and each portal's "My appointments": move or cancel a future appointment.
// Every change emails the client; the database decides who may change what.

const fmt = (iso: string) => new Date(iso).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg", dateStyle: "medium", timeStyle: "short" });
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("en-ZA", { timeZone: "Africa/Johannesburg", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
// datetime-local has no zone; appointments are in Johannesburg time (UTC+2, no DST).
export const sastToIso = (local: string) => new Date(`${local}:00+02:00`).toISOString();

const EMAIL_LABEL: Record<string, string> = {
  queued: "client email queued", processing: "client email sending", sent: "client emailed",
  failed: "client email failed", superseded: "client email replaced",
};

function errorText(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return "Something went wrong";
}

export function TeamAppointmentsList({ rows, showMember }: { rows: TeamAppointment[]; showMember: boolean }) {
  const move = useMoveTeamAppointment();
  const cancel = useCancelTeamAppointment();
  const [open, setOpen] = useState<{ id: string; mode: "move" | "cancel" } | null>(null);
  const [f, setF] = useState({ start: "", end: "", reason: "" });

  if (rows.length === 0) return <p className="py-3 text-sm text-muted-foreground">No appointments in this period.</p>;
  const close = () => { setOpen(null); setF({ start: "", end: "", reason: "" }); };

  return (
    <ul className="divide-y divide-border">
      {rows.map((a) => (
        <li key={a.appointment_id} className="space-y-1 py-3 text-sm">
          <p className="font-semibold text-brand-navy">
            {fmt(a.starts_at)} to {fmtTime(a.ends_at)}
            {a.status === "cancelled" ? <span className="ml-2 rounded bg-red-50 px-1.5 py-0.5 text-xs text-red-700">cancelled</span> : null}
          </p>
          <p>
            <span className="font-medium">{a.client_name}</span>
            <span className="text-muted-foreground"> · {a.client_email}{a.client_phone ? ` · ${a.client_phone}` : ""}</span>
          </p>
          {showMember ? <p className="text-muted-foreground">With {a.member_name ?? "team member"} ({a.member_type ?? "team"})</p> : null}
          <p className="text-muted-foreground">Reason: {a.reason}</p>
          {a.email_status ? <p className="text-xs text-muted-foreground">{EMAIL_LABEL[a.email_status] ?? a.email_status}</p> : null}
          {a.can_change && open?.id !== a.appointment_id ? (
            <div className="flex gap-3 pt-1">
              <button type="button" className="text-xs font-semibold text-brand-teal underline" onClick={() => { setF({ start: "", end: "", reason: "" }); setOpen({ id: a.appointment_id, mode: "move" }); }}>Move</button>
              <button type="button" className="text-xs font-semibold text-red-700 underline" onClick={() => { setF({ start: "", end: "", reason: "" }); setOpen({ id: a.appointment_id, mode: "cancel" }); }}>Cancel</button>
            </div>
          ) : null}
          {open?.id === a.appointment_id ? (
            <form
              className="mt-2 space-y-2 rounded-lg border border-border p-3"
              onSubmit={(e) => {
                e.preventDefault();
                const done = { onSuccess: () => { toast.success(open.mode === "move" ? "Moved. The client is emailed the new time." : "Cancelled. The client is emailed."); close(); }, onError: (err: unknown) => toast.error(errorText(err)) };
                if (open.mode === "move") move.mutate({ id: a.appointment_id, startsAt: sastToIso(f.start), endsAt: sastToIso(f.end), reason: f.reason }, done);
                else cancel.mutate({ id: a.appointment_id, reason: f.reason }, done);
              }}
            >
              {open.mode === "move" ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="text-xs font-semibold">New start<Input type="datetime-local" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></label>
                  <label className="text-xs font-semibold">New end<Input type="datetime-local" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></label>
                </div>
              ) : null}
              <label className="block text-xs font-semibold">Why (the client is not shown this)
                <Input maxLength={300} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
              </label>
              <div className="flex gap-3">
                <button type="submit" className="rounded-lg bg-brand-teal px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
                  disabled={f.reason.trim().length < 3 || (open.mode === "move" && (!f.start || !f.end)) || move.isPending || cancel.isPending}>
                  {open.mode === "move" ? "Move and email the client" : "Cancel and email the client"}
                </button>
                <button type="button" className="text-xs underline" onClick={close}>Keep as is</button>
              </div>
            </form>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
