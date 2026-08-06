import { useLocation } from "react-router-dom";
import { LogOut, Menu } from "lucide-react";
import { signOutAndRedirect } from "@/lib/signOut";
import { useSession } from "@/lib/useSession";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { NAV_ITEMS } from "./navItems";
import { GlobalSearch } from "./GlobalSearch";

function currentTitle(pathname: string): string {
  // Deal detail lives outside the nav; keep the header meaningful.
  if (pathname.startsWith("/deals")) return "Deal";
  const match = NAV_ITEMS.find((n) => pathname.startsWith(n.to));
  return match?.label ?? "Dashboard";
}

export function TopBar({ onMenuClick }: { onMenuClick: () => void }) {
  const session = useSession();
  const { pathname } = useLocation();
  const email = session?.user?.email ?? "";

  return (
    <header className="sticky top-0 z-10 flex h-16 items-center gap-3 border-b border-border bg-white px-4 sm:px-6">
      <button
        type="button"
        onClick={onMenuClick}
        aria-label="Open menu"
        className="md:hidden rounded-md p-2 text-brand-navy hover:bg-slate-100"
      >
        <Menu className="h-5 w-5" />
      </button>

      <h1 className="text-lg font-semibold text-brand-navy">{currentTitle(pathname)}</h1>
      <GlobalSearch />

      <div className="ml-auto flex items-center gap-3">
        <NotificationBell />
        <div className="hidden sm:flex flex-col items-end leading-tight">
          <span className="text-sm font-medium text-brand-navy">{email}</span>
          <span className="text-[11px] text-muted-foreground">Owner</span>
        </div>
        <div className="h-9 w-9 rounded-full bg-brand-navy text-white grid place-items-center text-sm font-semibold">
          {email.slice(0, 1).toUpperCase() || "?"}
        </div>
        <button
          type="button"
          onClick={() => void signOutAndRedirect()}
          className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium text-brand-navy hover:bg-slate-50"
        >
          <LogOut className="h-4 w-4" />
          <span className="hidden sm:inline">Sign out</span>
        </button>
      </div>
    </header>
  );
}
