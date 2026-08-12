import type { ReactNode } from "react";
import { FilePlus2, Home, LogOut } from "lucide-react";
import { NavLink } from "react-router-dom";
import { cn } from "@/lib/utils";
import { signOutAndRedirect } from "@/lib/signOut";
import { useSession } from "@/lib/useSession";

const navigation = [
  { to: "/lead-referrer", label: "Dashboard", icon: Home, end: true },
  { to: "/lead-referrer/submit-lead", label: "New lead", icon: FilePlus2, end: false },
];

export function LeadReferrerShell({ children }: { children: ReactNode }) {
  const session = useSession();
  const email = session?.user.email ?? "Lead referrer";

  return (
    <div className="min-h-screen bg-slate-50 lg:grid lg:grid-cols-[250px_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-screen min-h-0 flex-col overflow-hidden bg-brand-navy text-white lg:flex">
        <div className="flex items-center gap-3 border-b border-white/10 px-5 py-5">
          <img src="/brand-mark.png" alt="" className="h-10 w-10 object-contain" />
          <div className="leading-tight">
            <p className="font-bold">Fund Now <span className="text-brand-teal">Capital</span></p>
            <p className="text-[11px] text-white/55">Lead Referrer Portal</p>
          </div>
        </div>
        <nav aria-label="Lead referrer navigation" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4 [scrollbar-gutter:stable]">
          <ul className="space-y-1">
            {navigation.map((item) => (
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
        <div className="border-t border-white/10 px-5 py-4 text-[11px] text-white/45">
          Powered by Fund Now Capital
        </div>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-20 border-b border-border bg-white/95 backdrop-blur">
          <div className="flex min-h-16 items-center gap-3 px-4 sm:px-6 lg:px-8">
            <img src="/brand-mark.png" alt="Fund Now Capital" className="h-9 w-9 object-contain lg:hidden" />
            <div className="min-w-0">
              <p className="text-sm font-bold text-brand-navy">Lead Referrer Portal</p>
              <p className="max-w-56 truncate text-xs text-muted-foreground">{email}</p>
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
          <nav aria-label="Lead referrer mobile navigation" className="overflow-x-auto overscroll-x-contain px-2 [scrollbar-gutter:stable] lg:hidden">
            <ul className="flex min-w-max gap-1">
              {navigation.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) => cn(
                      "flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-semibold",
                      isActive ? "border-brand-teal text-brand-navy" : "border-transparent text-muted-foreground",
                    )}
                  >
                    <item.icon className="h-4 w-4" aria-hidden="true" />
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
        </header>
        <main className="space-y-6 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
