import { useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Field, card, errorText, primaryButton, selectClass } from "@/components/staff/StaffShell";
import { useStaffAccessList } from "@/hooks/useStaffAccessAdmin";
import { useTeamMembers } from "@/hooks/useTeam";
import {
  CALENDAR_PERMISSIONS, useOwnerGrantList, useRevokeCalendarGrant, useSetCalendarGrant, type CalendarPermission,
} from "@/hooks/useStaffDesk";

// Owner-only. Four separate permissions, granted per calendar and per person.
// None implies another; revoking applies on the person's next action.
export default function CalendarAccessPage() {
  const members = useTeamMembers();
  const access = useStaffAccessList();
  const grants = useOwnerGrantList();
  const setGrant = useSetCalendarGrant();
  const revoke = useRevokeCalendarGrant();
  const [calendarOwner, setCalendarOwner] = useState("");
  const [grantee, setGrantee] = useState("");
  const [permission, setPermission] = useState<CalendarPermission>("view_availability");
  const [until, setUntil] = useState("");

  const people = (members.data ?? []).filter((m) => m.is_active);
  const staff = people.filter((m) => (m.role === "switchboard" || m.role === "coordinator") && access.data?.[m.id] === true);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await setGrant.mutateAsync({ calendarOwner, grantee, permission, effectiveTo: until || null });
      toast.success("Permission granted");
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  const doRevoke = (id: string) => {
    const reason = window.prompt("Why is this being revoked? (optional)") ?? "";
    revoke.mutate({ grantId: id, reason }, { onSuccess: () => toast.success("Permission revoked"), onError: (err) => toast.error(errorText(err)) });
  };

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-brand-navy">Calendar access</h1>
        <p className="text-sm text-muted-foreground">
          Choose whose calendar, who may use it, and which of the four permissions. Staff never see private details: others' bookings read Busy or Private unless you mark an event public.
        </p>
      </div>
      <form onSubmit={submit} className={`${card} grid gap-4 md:grid-cols-2`}>
        <Field label="Calendar of">
          <select required className={selectClass} value={calendarOwner} onChange={(e) => setCalendarOwner(e.target.value)}>
            <option value="">Choose...</option>
            {people.map((m) => <option key={m.id} value={m.id}>{m.full_name || m.email}</option>)}
          </select>
        </Field>
        <Field label="Give access to" hint="Only staff you have switched on appear here.">
          <select required className={selectClass} value={grantee} onChange={(e) => setGrantee(e.target.value)}>
            <option value="">Choose...</option>
            {staff.map((m) => <option key={m.id} value={m.id}>{m.full_name || m.email}</option>)}
          </select>
        </Field>
        <Field label="Permission" hint={CALENDAR_PERMISSIONS.find((p) => p.value === permission)?.help}>
          <select className={selectClass} value={permission} onChange={(e) => setPermission(e.target.value as CalendarPermission)}>
            {CALENDAR_PERMISSIONS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </Field>
        <Field label="Until (optional)"><Input type="date" value={until} onChange={(e) => setUntil(e.target.value)} /></Field>
        <div className="md:col-span-2"><button type="submit" disabled={setGrant.isPending} className={primaryButton}>Grant</button></div>
      </form>

      <section className={card}>
        <h2 className="mb-2 text-base font-bold text-brand-navy">Current permissions</h2>
        {grants.error ? <p role="alert" className="text-sm text-red-600">{errorText(grants.error)}</p> : null}
        <ul className="divide-y divide-border text-sm">
          {(grants.data ?? []).map((g) => (
            <li key={g.id} className="flex items-center justify-between gap-3 py-2">
              <span className={g.revoked_at ? "text-muted-foreground line-through" : ""}>
                <span className="font-semibold text-brand-navy">{g.grantee_name}</span> · {CALENDAR_PERMISSIONS.find((p) => p.value === g.permission)?.label} · {g.calendar_owner_name}
                <span className="ml-2 text-xs text-muted-foreground">{g.effective_to ? `until ${g.effective_to}` : "no end date"}</span>
              </span>
              {!g.revoked_at ? <button type="button" className="text-xs font-semibold text-red-700 underline" onClick={() => doRevoke(g.id)}>Revoke</button> : null}
            </li>
          ))}
          {grants.data && grants.data.length === 0 ? <li className="py-2 text-muted-foreground">No permissions granted yet.</li> : null}
        </ul>
      </section>
    </div>
  );
}
