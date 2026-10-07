import type { ReactNode } from "react";
import { BookOpenCheck, CalendarDays, FilePlus2, ListChecks, LogOut, PhoneCall, ClipboardList } from "lucide-react";
import { NavLink } from "react-router-dom";
import { cn } from "@/lib/utils";
import { signOutAndRedirect } from "@/lib/signOut";
import { useSession } from "@/lib/useSession";
import { useStaffRole } from "@/hooks/useStaffDesk";

type Item = { to: string; label: string; icon: typeof PhoneCall; end: boolean; managerOnly?: boolean };

const navigation: Item[] = [
  { to: "/staff", label: "Call log", icon: PhoneCall, end: true },
  { to: "/staff/new-lead", label: "New lead", icon: FilePlus2, end: false },
  { to: "/staff/documents", label: "Document tracker", icon: BookOpenCheck, end: false },
  { to: "/staff/diary", label: "Diary", icon: CalendarDays, end: false },
  { to: "/staff/tasks", label: "Tasks", icon: ListChecks, end: false },
  { to: "/staff/queue", label: "Submission queue", icon: ClipboardList, end: false, managerOnly: true },
];

export function StaffShell({ children }: { children: ReactNode }) {
  const session = useSession();
  const { data: role } = useStaffRole();
  const items = navigation.filter((i) => !i.managerOnly || role === "coordinator" || role === "owner");
  const roleLabel = role === "coordinator" ? "Sales Coordinator" : role === "switchboard" ? "Switchboard" : "Staff";

  return (
    <div className="min-h-screen bg-slate-50 lg:grid lg:grid-cols-[250px_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-screen min-h-0 flex-col overflow-hidden bg-brand-navy text-white lg:flex">
        <div className="flex items-center gap-3 border-b border-white/10 px-5 py-5">
          <img src="/brand-mark.png" alt="" className="h-10 w-10 object-contain" />
          <div className="leading-tight">
            <p className="font-bold">Fund Now <span className="text-brand-teal">Capital</span></p>
            <p className="text-[11px] text-white/55">{roleLabel} workspace</p>
          </div>
        </div>
        <nav aria-label="Staff navigation" className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
          <ul className="space-y-1">
            {items.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) => cn(
                    "flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold transition",
                    isActive ? "bg-brand-teal text-white" : "text-white/70 hover:bg-white/10 hover:text-white",
                  )}
                >
                  <item.icon className="h-4 w-4" aria-hidden="true" />
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-20 border-b border-border bg-white/95 backdrop-blur">
          <div className="flex min-h-16 items-center gap-3 px-4 sm:px-6 lg:px-8">
            <img src="/brand-mark.png" alt="Fund Now Capital" className="h-9 w-9 object-contain lg:hidden" />
            <div className="min-w-0">
              <p className="text-sm font-bold text-brand-navy">{roleLabel} workspace</p>
              <p className="max-w-56 truncate text-xs text-muted-foreground">{session?.user.email ?? ""}</p>
            </div>
            <button
              type="button"
              onClick={() => void signOutAndRedirect()}
              className="ml-auto inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-semibold text-brand-navy hover:bg-slate-50"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
          <nav aria-label="Staff mobile navigation" className="overflow-x-auto px-2 lg:hidden">
            <ul className="flex min-w-max gap-1">
              {items.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) => cn(
                      "flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold",
                      isActive ? "bg-brand-teal text-white" : "text-brand-navy hover:bg-slate-100",
                    )}
                  >
                    <item.icon className="h-3.5 w-3.5" aria-hidden="true" />
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
        </header>
        <main className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block space-y-1.5 text-sm font-semibold text-brand-navy">
      <span>{label}</span>
      {children}
      {hint ? <span className="block text-xs font-normal text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

export const selectClass =
  "flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
export const textareaClass =
  "flex min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
export const primaryButton =
  "inline-flex h-11 items-center justify-center rounded-lg bg-brand-teal px-5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50";
export const card = "rounded-2xl border border-border bg-white p-5 shadow-sm";

export function errorText(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return "Something went wrong";
}

export const SAFE_TEXT_NOTE =
  "Do not type ID numbers, bank account numbers or salary details. Numbers of 9 or more digits are rejected.";
