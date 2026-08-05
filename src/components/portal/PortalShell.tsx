import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { Home, LogOut, PlusCircle, ListChecks, Briefcase, FileText, ReceiptText, GraduationCap, Bell, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { signOutAndRedirect } from "@/lib/signOut";
import { useSession } from "@/lib/useSession";

/*
 * Shared chrome for the partner + contractor portals (LEAD-SUBMIT lane).
 *
 * Deliberately NOT the owner AppLayout — the partner/contractor worlds get their
 * own lightweight shell (same brand). One nav ("sidebar entry" in the brief,
 * rendered as a top nav bar here) drives every portal screen: Home, Submit Lead,
 * My Leads, My Deals. FNC branding only; no client data, no funder identity, no commission
 * figures live in this shell (POPIA — those surfaces come later, S11).
 */

export type PortalKind = "partner" | "contractor";

const PORTAL_LABEL: Record<PortalKind, string> = {
  partner: "Partner Portal",
  contractor: "Contractor Portal",
};

const ROLE_LABEL: Record<PortalKind, string> = {
  partner: "Partner",
  contractor: "Contractor",
};

function navItems(portal: PortalKind) {
  const base = `/${portal}`;
  return [
    { to: base, label: "Home", icon: Home, end: true },
    { to: `${base}/submit-lead`, label: "Submit Lead", icon: PlusCircle, end: false },
    { to: `${base}/leads`, label: "My Leads", icon: ListChecks, end: false },
    { to: `${base}/deals`, label: "My Deals", icon: Briefcase, end: false },
    // "My Progress" is a contractor-only surface (Base→L3 progression). Partners
    // have no level progression, so it never shows in the partner portal.
    ...(portal === "contractor"
      ? [{ to: `${base}/progression`, label: "My Progress", icon: TrendingUp, end: false }]
      : []),
    // Statements is a monthly earnings roll-up for both portals (partner sees his
    // 50/50 split; contractor sees commission + reimbursements). Own take only.
    { to: `${base}/statements`, label: "Statements", icon: FileText, end: false },
    // Invoicing is a partner-only surface (C4 Doctor invoicing). Contractor
    // invoicing is a separate, later concern — no invoices tab for contractors.
    ...(portal === "partner"
      ? [{ to: `${base}/invoices`, label: "Invoices", icon: ReceiptText, end: false }]
      : []),
    // Training is a contractor-only surface (TRAINING lane — Product Knowledge
    // modules). Partners have no training programme.
    ...(portal === "contractor"
      ? [{ to: `${base}/training`, label: "Training", icon: GraduationCap, end: false }]
      : []),
    { to: `${base}/settings/notifications`, label: "Notifications", icon: Bell, end: false },
  ];
}

export default function PortalShell({
  portal,
  children,
}: {
  portal: PortalKind;
  children: ReactNode;
}) {
  const session = useSession();
  const email = session?.user?.email ?? "";

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-10 border-b border-border bg-white">
        <div className="mx-auto flex h-16 max-w-4xl items-center gap-3 px-4 sm:px-6">
          <img src="/brand-mark.png" alt="Fund Now Capital" className="h-9 w-9 object-contain" />
          <div className="leading-tight">
            <div className="text-sm font-bold text-brand-navy">
              Fund Now <span className="text-brand-teal">Capital</span>
            </div>
            <div className="text-[11px] text-muted-foreground">{PORTAL_LABEL[portal]}</div>
          </div>

          <div className="ml-auto flex items-center gap-3">
            <div className="hidden flex-col items-end leading-tight sm:flex">
              <span className="max-w-[180px] truncate text-sm font-medium text-brand-navy">{email}</span>
              <span className="text-[11px] text-muted-foreground">{ROLE_LABEL[portal]}</span>
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
        </div>

        {/* Portal nav — the "Submit Lead" entry the brief asks for, alongside
            Home + My Leads. Horizontal on every width; scrolls if it must. */}
        <nav className="mx-auto max-w-4xl overflow-x-auto px-2 sm:px-4">
          <ul className="flex items-center gap-1">
            {navItems(portal).map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
                      isActive
                        ? "border-brand-teal text-brand-navy"
                        : "border-transparent text-muted-foreground hover:text-brand-navy",
                    )
                  }
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      <main className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}
