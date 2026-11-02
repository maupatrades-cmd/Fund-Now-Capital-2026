import { Link } from "react-router-dom";
import { PendingTasksPanel } from "@/components/staff/PendingTasksPanel";
import { MyTargetsPanel } from "@/components/staff/MyTargetsPanel";
import { MyFieldLeadsPanel } from "@/components/staff/MyFieldLeadsPanel";
import { card } from "@/components/staff/StaffShell";
import { isFieldRole, useStaffRole } from "@/hooks/useStaffDesk";

// "My day": the landing page for HR, Reception and the field roles (the Sales Coordinator and the Administrator land
// on Home). Tasks waiting for an answer, this month's targets, and where to go next.
export default function StaffMyDayPage() {
  const { data: role } = useStaffRole();
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-brand-navy">My day</h1>
        <p className="text-sm text-muted-foreground">Tasks waiting for you and how this month is going.</p>
      </div>
      <PendingTasksPanel />
      {isFieldRole(role) ? <MyFieldLeadsPanel supervisor={role === "field_supervisor"} /> : null}
      <MyTargetsPanel />
      <section className={`${card} space-y-2 text-sm`}>
        <h2 className="text-base font-bold text-brand-navy">Go to</h2>
        <ul className="flex flex-wrap gap-3">
          <li><Link className="font-semibold text-brand-teal underline" to="/staff/notices">Notices</Link></li>
          {role === "hr" ? <li><Link className="font-semibold text-brand-teal underline" to="/staff/commissions">Commission flow</Link></li> : null}
          {role === "hr" || role === "switchboard" ? <li><Link className="font-semibold text-brand-teal underline" to="/staff/messages">Messages</Link></li> : null}
          {role === "switchboard" ? <li><Link className="font-semibold text-brand-teal underline" to="/staff">Call log</Link></li> : null}
          {isFieldRole(role) ? <li><Link className="font-semibold text-brand-teal underline" to="/staff/field-leads">Field leads</Link></li> : null}
        </ul>
      </section>
    </div>
  );
}
