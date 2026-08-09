import { useMemo, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import {
  Award,
  Bell,
  Briefcase,
  FileText,
  GraduationCap,
  Home,
  ListChecks,
  LogOut,
  PlusCircle,
  ReceiptText,
  Search,
  TrendingUp,
} from "lucide-react";
import { usePartnerPortalIdentity } from "@/hooks/usePartnerPortalIdentity";
import { usePortalDeals } from "@/hooks/usePortalDeals";
import { usePortalLeads } from "@/hooks/usePortalLeads";
import { cn } from "@/lib/utils";
import { signOutAndRedirect } from "@/lib/signOut";
import { useSession } from "@/lib/useSession";

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
    { to: base, label: portal === "partner" ? "Dashboard" : "Home", icon: Home, end: true },
    { to: `${base}/submit-lead`, label: "New lead", icon: PlusCircle, end: false },
    { to: `${base}/leads`, label: portal === "partner" ? "Leads" : "My Leads", icon: ListChecks, end: false },
    { to: `${base}/deals`, label: portal === "partner" ? "Pipeline" : "My Deals", icon: Briefcase, end: false },
    ...(portal === "contractor"
      ? [{ to: `${base}/progression`, label: "My Progress", icon: TrendingUp, end: false }]
      : []),
    { to: `${base}/statements`, label: "Statements", icon: FileText, end: false },
    ...(portal === "partner"
      ? [{ to: `${base}/invoices`, label: "Invoices", icon: ReceiptText, end: false }]
      : []),
    { to: `${base}/badges`, label: "Badges", icon: Award, end: false },
    ...(portal === "contractor"
      ? [{ to: `${base}/training`, label: "Training", icon: GraduationCap, end: false }]
      : []),
    { to: `${base}/settings/notifications`, label: "Notifications", icon: Bell, end: false },
  ];
}

function partnerPageMeta(pathname: string) {
  if (pathname.endsWith("/submit-lead")) return ["New lead", "Capture a funding opportunity"] as const;
  if (pathname.endsWith("/leads")) return ["Leads", "Track your submitted opportunities"] as const;
  if (pathname.endsWith("/deals")) return ["Pipeline", "Follow deals through the funding process"] as const;
  if (pathname.includes("/invoices")) return ["Invoices", "Manage your partner invoices"] as const;
  if (pathname.endsWith("/statements")) return ["Statements", "Review your settlement history"] as const;
  if (pathname.endsWith("/badges")) return ["Badges", "Your Fund Now Capital achievements"] as const;
  if (pathname.includes("/settings/notifications")) return ["Notifications", "Choose how Fund Now Capital contacts you"] as const;
  return ["Dashboard", "Your partner command centre"] as const;
}

function PartnerPortalSearch() {
  const [term, setTerm] = useState("");
  const leads = usePortalLeads("partner");
  const deals = usePortalDeals("partner");
  const normalizedTerm = term.trim().toLocaleLowerCase("en-ZA");

  const results = useMemo(() => {
    if (normalizedTerm.length < 2) return [];

    const leadMatches = (leads.data ?? [])
      .filter((lead) =>
        `${lead.business_name} ${lead.contact_name}`.toLocaleLowerCase("en-ZA").includes(normalizedTerm),
      )
      .map((lead) => ({
        key: `lead-${lead.id}`,
        label: lead.business_name,
        type: "Lead",
        to: "/partner/leads",
      }));
    const dealMatches = (deals.data ?? [])
      .filter((deal) =>
        `${deal.client_business_name} ${deal.deal_reference ?? ""}`
          .toLocaleLowerCase("en-ZA")
          .includes(normalizedTerm),
      )
      .map((deal) => ({
        key: `deal-${deal.deal_id}`,
        label: deal.client_business_name,
        type: "Deal",
        to: "/partner/deals",
      }));

    return [...leadMatches, ...dealMatches].slice(0, 6);
  }, [deals.data, leads.data, normalizedTerm]);

  const searching = normalizedTerm.length >= 2;
  const searchError = leads.isError || deals.isError;

  return (
    <div className="relative hidden w-full max-w-sm md:block">
      <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" aria-hidden="true" />
      <input
        type="search"
        value={term}
        onChange={(event) => setTerm(event.target.value)}
        placeholder="Search your leads and deals…"
        aria-label="Search your partner leads and deals"
        className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm text-[#10283f] outline-none transition focus:border-[#d9a21b] focus:bg-white focus:ring-2 focus:ring-[#d9a21b]/15"
      />
      {searching ? (
        <div className="absolute left-0 right-0 top-12 z-30 max-h-72 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
          {searchError ? (
            <p className="px-3 py-4 text-sm text-red-600">Search is temporarily unavailable.</p>
          ) : results.length === 0 ? (
            <p className="px-3 py-4 text-sm text-slate-500">No matching lead or deal.</p>
          ) : (
            results.map((result) => (
              <Link
                key={result.key}
                to={result.to}
                onClick={() => setTerm("")}
                className="flex items-center justify-between rounded-lg px-3 py-2 text-sm transition hover:bg-[#fff8e4]"
              >
                <span className="font-semibold text-[#10283f]">{result.label}</span>
                <span className="text-xs font-medium text-[#a76d08]">{result.type}</span>
              </Link>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

function BrightDestinyPartnerShell({ children }: { children: ReactNode }) {
  const location = useLocation();
  const identity = usePartnerPortalIdentity();
  const [pageTitle, pageSubtitle] = partnerPageMeta(location.pathname);
  const displayName = identity.data?.displayName ?? "Partner";
  const organisationName = identity.data?.organisationName ?? "Partner business";
  const showBrightDestinyBrand = identity.data?.showBrightDestinyBrand ?? false;

  return (
    <div className="min-h-screen bg-[#f4f6f8] lg:grid lg:grid-cols-[262px_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-screen min-h-0 flex-col overflow-hidden bg-gradient-to-b from-[#0c2033] to-[#071726] text-white lg:flex">
        <div className="border-b border-white/10 px-5 py-6">
          {showBrightDestinyBrand ? (
            <img
              src="/partners/bright-destiny-logo.webp"
              alt="Bright Destiny Finance Partners"
              className="h-28 w-full object-contain object-center"
            />
          ) : (
            <div className="rounded-xl border border-[#d9a21b]/30 bg-black/20 px-4 py-5 text-center">
              <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#d9a21b]">Partner portal</p>
              <p className="mt-2 font-serif text-xl font-semibold text-white">{organisationName}</p>
            </div>
          )}
        </div>

        <div className="px-5 pb-3 pt-6">
          <div className="flex items-center gap-3 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
            <span>Partner portal</span>
            <span className="h-px flex-1 bg-[#d9a21b]/45" aria-hidden="true" />
          </div>
        </div>

        <nav aria-label="Partner portal navigation" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-4 [scrollbar-gutter:stable]">
          <ul className="space-y-1">
            {navItems("partner").map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold transition",
                      isActive
                        ? "bg-gradient-to-r from-[#ffd438] to-[#c9830d] text-[#10283f] shadow-lg shadow-black/10"
                        : "text-slate-300 hover:bg-white/7 hover:text-white",
                    )
                  }
                >
                  <item.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <div className="border-t border-white/10 px-5 py-5">
          <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-500">Platform by</p>
          <div className="mt-3 flex items-center gap-3">
            <img src="/brand-mark.png" alt="" className="h-10 w-10 rounded-full object-contain" />
            <div className="leading-tight">
              <p className="text-sm font-bold">Fund Now <span className="text-[#45c4c8]">Capital</span></p>
              <p className="text-[9px] text-slate-400">Many funders. More approvals.</p>
            </div>
          </div>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
          <div className="flex min-h-20 items-center gap-4 px-4 py-3 sm:px-6 lg:px-8">
            <div className="min-w-0 lg:min-w-52">
              <h1 className="truncate font-serif text-2xl font-semibold text-[#10283f]">{pageTitle}</h1>
              <p className="truncate text-xs text-slate-500">{pageSubtitle}</p>
            </div>
            <PartnerPortalSearch />
            <div className="ml-auto flex min-w-0 items-center gap-3">
              <div className="hidden min-w-0 text-right sm:block">
                <p className="max-w-44 truncate text-sm font-bold text-[#10283f]">{displayName}</p>
                <p className="max-w-44 truncate text-[11px] text-slate-500">{organisationName}</p>
              </div>
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#ffd438] to-[#c9830d] text-sm font-bold text-[#10283f]">
                {displayName.slice(0, 2).toUpperCase()}
              </div>
              <button
                type="button"
                onClick={() => void signOutAndRedirect()}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-[#10283f] transition hover:bg-slate-50"
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
                <span className="hidden xl:inline">Sign out</span>
              </button>
            </div>
          </div>

          <nav aria-label="Partner mobile navigation" className="overflow-x-auto overscroll-x-contain px-2 [scrollbar-gutter:stable] lg:hidden">
            <ul className="flex min-w-max items-center gap-1">
              {navItems("partner").map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) =>
                      cn(
                        "flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-semibold",
                        isActive
                          ? "border-[#d9a21b] text-[#10283f]"
                          : "border-transparent text-slate-500",
                      )
                    }
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

function ContractorPortalShell({ children }: { children: ReactNode }) {
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
            <div className="text-[11px] text-muted-foreground">{PORTAL_LABEL.contractor}</div>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <div className="hidden flex-col items-end leading-tight sm:flex">
              <span className="max-w-[180px] truncate text-sm font-medium text-brand-navy">{email}</span>
              <span className="text-[11px] text-muted-foreground">{ROLE_LABEL.contractor}</span>
            </div>
            <button
              type="button"
              onClick={() => void signOutAndRedirect()}
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium text-brand-navy hover:bg-slate-50"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        </div>
        <nav aria-label="Contractor portal navigation" className="mx-auto max-w-4xl overflow-x-auto overscroll-x-contain px-2 [scrollbar-gutter:stable] sm:px-4">
          <ul className="flex items-center gap-1">
            {navItems("contractor").map((item) => (
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
                  <item.icon className="h-4 w-4" aria-hidden="true" />
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

export default function PortalShell({ portal, children }: { portal: PortalKind; children: ReactNode }) {
  return portal === "partner" ? (
    <BrightDestinyPartnerShell>{children}</BrightDestinyPartnerShell>
  ) : (
    <ContractorPortalShell>{children}</ContractorPortalShell>
  );
}
