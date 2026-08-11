import { NavLink } from "react-router-dom";
import { cn } from "@/lib/utils";
import { NAV_ITEMS } from "./navItems";

// Navy brand sidebar. Used inside AppLayout (static on desktop, drawer on mobile).
export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col bg-brand-navy text-white">
      {/* Brand lockup */}
      <div className="flex items-center gap-3 px-5 h-16 border-b border-white/10">
        <img src="/brand-mark.png" alt="" className="h-9 w-9 object-contain" />
        <div className="leading-tight">
          <div className="text-sm font-bold">
            Fund Now <span className="text-brand-teal">Capital</span>
          </div>
          <div className="text-[11px] text-white/50">Many funders. More approvals.</div>
        </div>
      </div>

      {/* Nav — scrolls independently when the menu outgrows the viewport, while
          the brand lockup above and the footer below stay pinned. min-h-0 lets
          this flex child shrink below its content so overflow-y-auto can engage. */}
      <nav className="flex-1 min-h-0 overflow-y-auto px-3 py-4 space-y-1">
        {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                isActive
                  ? "bg-brand-teal text-white"
                  : "text-white/70 hover:bg-white/10 hover:text-white",
              )
            }
          >
            <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="px-5 py-4 text-[11px] text-white/35 border-t border-white/10">
        © 2026 Fund Now Capital (Pty) Ltd
      </div>
    </div>
  );
}
