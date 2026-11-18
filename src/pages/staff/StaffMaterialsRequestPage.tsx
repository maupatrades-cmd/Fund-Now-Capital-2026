import { useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Field, card, errorText, primaryButton, textareaClass } from "@/components/staff/StaffShell";
import { canRequestMaterials, useRequestMaterials, useStaffRole, useStaffTasks, type StaffTask } from "@/hooks/useStaffDesk";

// Marketing-materials request (field team, 17 Nov 2026). The Field Supervisor and field consultants ask the office for
// flyers, banners, forms and so on. The database (staff_request_materials) turns it into a task given to the Office
// Administrator, who accepts it and marks it done on their Tasks page; this page shows where each request stands.

const todaySast = () => new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" });
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-ZA", { timeZone: "Africa/Johannesburg", dateStyle: "medium" });

// Where a request stands, in plain words.
function requestState(t: StaffTask): [string, string] {
  if (t.status === "done") return ["done", "bg-green-100 text-green-800"];
  if (t.status === "cancelled") return ["cancelled", "bg-slate-100 text-slate-700"];
  if (t.acceptance === null) return ["waiting with the Director", "bg-amber-100 text-amber-800"];
  if (t.acceptance === "pending") return ["waiting to be accepted", "bg-amber-100 text-amber-800"];
  if (t.acceptance === "declined") return ["declined", "bg-red-100 text-red-800"];
  return ["accepted, being prepared", "bg-blue-100 text-blue-800"];
}

const EMPTY = { items: "", quantity: "", neededBy: "", area: "", note: "" };

export default function StaffMaterialsRequestPage() {
  const { data: role } = useStaffRole();
  const allowed = canRequestMaterials(role);
  const request = useRequestMaterials();
  // A field role's board holds only their own tasks and the tasks they created, so every materials request on it is
  // one they asked for.
  const tasks = useStaffTasks(null);
  const mine = (tasks.data ?? []).filter((t) => t.task_kind === "materials_request");
  const [form, setForm] = useState(EMPTY);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await request.mutateAsync(form);
      toast.success("Request sent to the Office Administrator.");
      setForm(EMPTY);
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  if (role && !allowed) {
    return <p className="text-sm text-muted-foreground">Only the Field Supervisor and field consultants request marketing materials.</p>;
  }

  return (
    <>
      <div>
        <h1 className="text-2xl font-bold text-brand-navy">Request marketing materials</h1>
        <p className="text-sm text-muted-foreground">Ask the Office Administrator for flyers, banners, forms or anything else you need in the field. They accept the request and mark it done when it is ready.</p>
      </div>

      <form onSubmit={submit} className={`${card} grid gap-4 md:grid-cols-2`}>
        <Field label="What do you need?">
          <Input required minLength={2} maxLength={120} placeholder="e.g. A5 flyers" value={form.items} onChange={(e) => setForm({ ...form, items: e.target.value })} />
        </Field>
        <Field label="How many?">
          <Input required maxLength={60} placeholder="e.g. 500" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
        </Field>
        <Field label="Needed by">
          <Input required type="date" min={todaySast()} value={form.neededBy} onChange={(e) => setForm({ ...form, neededBy: e.target.value })} />
        </Field>
        <Field label="Deliver to / area (optional)">
          <Input maxLength={160} placeholder="e.g. Soshanguve Block H" value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} />
        </Field>
        <div className="md:col-span-2">
          <Field label="Note (optional)">
            <textarea maxLength={500} className={textareaClass} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </Field>
        </div>
        <div className="md:col-span-2"><button type="submit" disabled={request.isPending || !allowed} className={primaryButton}>Send request</button></div>
      </form>

      <section className={card}>
        <h2 className="mb-2 text-base font-bold text-brand-navy">My requests</h2>
        {tasks.error ? <p role="alert" className="text-sm text-red-600">{errorText(tasks.error)}</p> : null}
        <ul className="divide-y divide-border text-sm">
          {mine.map((t) => {
            const [label, cls] = requestState(t);
            return (
              <li key={t.id} className="flex flex-wrap items-start justify-between gap-2 py-2">
                <span>
                  <span className="font-semibold text-brand-navy">{t.title.replace(/^Marketing materials: /, "")}</span>
                  <span className="block text-xs text-muted-foreground">
                    {t.assigned_name ? `With ${t.assigned_name}` : "With the office"}{t.due_at ? ` · needed by ${fmtDate(t.due_at)}` : ""}{t.overdue ? " · overdue" : ""}
                  </span>
                  {t.decline_reason ? <span className="block text-xs text-red-700">Reason: {t.decline_reason}</span> : null}
                </span>
                <span className={`rounded px-1.5 py-0.5 text-xs ${cls}`}>{label}</span>
              </li>
            );
          })}
          {tasks.data && mine.length === 0 ? <li className="py-2 text-muted-foreground">You have not requested any materials yet.</li> : null}
        </ul>
      </section>
    </>
  );
}
