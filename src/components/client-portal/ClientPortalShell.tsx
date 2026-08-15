import { useEffect, useRef, useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { BadgeCheck, Bell, CalendarDays, ClipboardList, FileSignature, Files, Gauge, LogOut, Menu, MessagesSquare, Milestone, UserRound, X } from "lucide-react";
import { useClientPortalIdentity } from "@/hooks/useClientPortalIdentity";
import { signOutAndRedirect } from "@/lib/signOut";
import { useSession } from "@/lib/useSession";
import { GradientBackground } from "@/components/ui/oceanic-depths";
import "@/components/client-portal/client-portal.css";

const navigation = [
  { to: "/client", label: "Overview", icon: Gauge, end: true },
  { to: "/client/application", label: "Application", icon: ClipboardList },
  { to: "/client/documents", label: "Documents", icon: Files },
  { to: "/client/legal", label: "Review & sign", icon: FileSignature },
  { to: "/client/progress", label: "Progress", icon: Milestone },
  { to: "/client/appointments", label: "Appointments", icon: CalendarDays },
  { to: "/client/messages", label: "Support", icon: MessagesSquare },
  { to: "/client/offers", label: "Outcomes", icon: BadgeCheck },
  { to: "/client/profile", label: "Profile", icon: UserRound },
];

const mobileNavigation = navigation.filter((item) =>
  ["Overview", "Application", "Documents", "Progress"].includes(item.label),
);

const mobileMoreNavigation = navigation.filter(
  (item) => !mobileNavigation.some((primaryItem) => primaryItem.to === item.to),
);

export default function ClientPortalShell({ children }: { children: ReactNode }) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const mobileMenuButtonRef = useRef<HTMLButtonElement>(null);
  const mobileMenuRef = useRef<HTMLElement>(null);
  const firstMobileMenuLinkRef = useRef<HTMLAnchorElement>(null);
  const location = useLocation();
  const session = useSession();
  const identity = useClientPortalIdentity();
  const businessName = identity.data?.businessName ?? "Your business";
  const profileName = session?.user.user_metadata.full_name;
  const contactName =
    identity.data?.contactName ?? (typeof profileName === "string" ? profileName : "Client");
  const initials = contactName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "C";
  const isMobileMoreRoute = mobileMoreNavigation.some((item) =>
    item.end ? location.pathname === item.to : location.pathname.startsWith(item.to),
  );

  useEffect(() => {
    if (!isMobileMenuOpen) return;

    firstMobileMenuLinkRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsMobileMenuOpen(false);
        mobileMenuButtonRef.current?.focus();
        return;
      }

      if (event.key === "Tab") {
        const focusableElements = mobileMenuRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled])',
        );
        if (!focusableElements?.length) return;

        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];
        if (event.shiftKey && document.activeElement === firstElement) {
          event.preventDefault();
          lastElement.focus();
        } else if (!event.shiftKey && document.activeElement === lastElement) {
          event.preventDefault();
          firstElement.focus();
        }
      }
    };

    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [isMobileMenuOpen]);

  return (
    <div className="client-portal min-h-screen bg-[#06131d] text-white">
      <a
        href="#client-portal-main"
        className="sr-only z-50 rounded-lg bg-white px-4 py-3 font-bold text-[#06131d] focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Skip to main content
      </a>
      <div className="pointer-events-none fixed inset-0 z-0 opacity-30" aria-hidden="true">
        <GradientBackground className="h-full w-full" />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(6,19,29,0.48),rgba(6,19,29,0.82)_58%,#06131d)]" />
      </div>
      <div className="client-aurora client-aurora--green" aria-hidden="true" />
      <div className="client-aurora client-aurora--blue" aria-hidden="true" />
      <div className="client-grid" aria-hidden="true" />

      <aside className="client-rail fixed inset-y-0 left-0 z-30 hidden w-[248px] flex-col border-r border-white/10 px-5 py-6 lg:flex">
        <NavLink to="/client" className="flex items-center gap-3" aria-label="Fund Now Capital client portal home">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-white shadow-lg shadow-black/20">
            <img src="/brand-mark.png" alt="" className="h-10 w-10 object-contain" />
          </span>
          <span>
            <span className="block text-sm font-extrabold tracking-tight">Fund Now Capital</span>
            <span className="block text-[10px] font-semibold uppercase tracking-[0.2em] text-[#86d4cf]">Client portal</span>
          </span>
        </NavLink>

        <nav className="mt-12 min-h-0 flex-1 overflow-y-auto pr-1" aria-label="Client portal navigation">
          <p className="mb-4 text-[10px] font-bold uppercase tracking-[0.22em] text-white/35">Your funding</p>
          <ul className="space-y-2">
            {navigation.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) => `flex items-center gap-3 rounded-2xl border px-4 py-3 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7fd4e8] ${
                    isActive
                      ? "border-[#6ec144]/35 bg-[#6ec144]/12 text-[#9ee67d]"
                      : "border-transparent text-white/60 hover:border-white/10 hover:bg-white/5 hover:text-white"
                  }`}
                >
                  <item.icon className="h-4 w-4" aria-hidden="true" />
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#7fd4e8]">Secure workspace</p>
          <p className="mt-2 text-xs leading-relaxed text-white/55">
            Your information is visible only to you and the authorised Fund Now Capital team.
          </p>
        </div>
      </aside>

      <div className="relative z-10 lg:pl-[248px]">
        <header className="sticky top-0 z-20 border-b border-white/10 bg-[#06131d]/80 backdrop-blur-2xl">
          <div className="mx-auto flex min-h-20 max-w-[1500px] items-center gap-3 px-4 sm:px-6 lg:px-8">
            <div className="flex min-w-0 items-center gap-3 lg:hidden">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white">
                <img src="/brand-mark.png" alt="" className="h-8 w-8 object-contain" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-extrabold">Fund Now Capital</p>
                <p className="truncate text-[10px] uppercase tracking-[0.18em] text-[#86d4cf]">Client portal</p>
              </div>
            </div>

            <div className="hidden min-w-0 lg:block">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/35">Signed in as</p>
              <p className="mt-1 max-w-md truncate text-sm font-semibold text-white/85">{businessName}</p>
            </div>

            <div className="ml-auto flex items-center gap-2 sm:gap-3">
              <button
                type="button"
                className="grid h-11 w-11 place-items-center rounded-xl border border-white/10 bg-white/5 text-white/65 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7fd4e8]"
                aria-label="Notifications"
              >
                <Bell className="h-4 w-4" aria-hidden="true" />
              </button>
              <div className="hidden text-right sm:block">
                <p className="max-w-48 truncate text-sm font-bold">{contactName}</p>
                <p className="max-w-48 truncate text-[11px] text-white/40">{session?.user.email}</p>
              </div>
              <div className="grid h-10 w-10 place-items-center rounded-full bg-gradient-to-br from-[#6ec144] to-[#2ca8a8] text-xs font-extrabold text-[#06131d]">
                {initials}
              </div>
              <button
                type="button"
                onClick={() => void signOutAndRedirect()}
                className="grid h-11 w-11 place-items-center rounded-xl border border-white/10 bg-white/5 text-white/65 transition hover:border-red-300/30 hover:bg-red-400/10 hover:text-red-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-200"
                aria-label="Sign out"
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        </header>

        <main id="client-portal-main" tabIndex={-1} className="mx-auto max-w-[1500px] px-4 pb-28 pt-6 outline-none sm:px-6 lg:px-8 lg:pb-10">
          {children}
        </main>
      </div>

      {isMobileMenuOpen ? (
        <div className="fixed inset-0 z-30 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/55 backdrop-blur-sm"
            aria-label="Close more navigation"
            onClick={() => setIsMobileMenuOpen(false)}
          />
          <section
            ref={mobileMenuRef}
            id="client-mobile-more-menu"
            role="dialog"
            aria-modal="true"
            aria-labelledby="client-mobile-more-title"
            className="absolute inset-x-3 bottom-[calc(5.75rem+env(safe-area-inset-bottom))] rounded-3xl border border-white/15 bg-[#0a1d2a] p-4 shadow-2xl shadow-black/50"
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 id="client-mobile-more-title" className="text-sm font-extrabold">More client services</h2>
              <button
                type="button"
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  mobileMenuButtonRef.current?.focus();
                }}
                className="grid h-11 w-11 place-items-center rounded-xl border border-white/10 text-white/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7fd4e8]"
                aria-label="Close more navigation"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            <ul className="grid grid-cols-2 gap-2">
              {mobileMoreNavigation.map((item, index) => (
                <li key={item.to}>
                  <NavLink
                    ref={index === 0 ? firstMobileMenuLinkRef : undefined}
                    to={item.to}
                    end={item.end}
                    onClick={() => setIsMobileMenuOpen(false)}
                    className={({ isActive }) => `flex min-h-14 items-center gap-3 rounded-2xl border px-3 text-sm font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7fd4e8] ${
                      isActive
                        ? "border-[#6ec144]/35 bg-[#6ec144]/15 text-[#9ee67d]"
                        : "border-white/10 bg-white/5 text-white/70"
                    }`}
                  >
                    <item.icon className="h-4 w-4" aria-hidden="true" />
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </section>
        </div>
      ) : null}

      <nav className="fixed inset-x-3 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-40 rounded-2xl border border-white/12 bg-[#0a1d2a]/95 p-2 shadow-2xl shadow-black/35 backdrop-blur-2xl lg:hidden" aria-label="Client mobile navigation">
        <ul className="grid grid-cols-5 gap-1">
          {mobileNavigation.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.end}
                className={({ isActive }) => `flex min-h-12 flex-col items-center justify-center gap-1 rounded-xl text-[10px] font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7fd4e8] ${
                  isActive ? "bg-[#6ec144]/15 text-[#9ee67d]" : "text-white/50"
                }`}
              >
                <item.icon className="h-4 w-4" aria-hidden="true" />
                {item.label}
              </NavLink>
            </li>
          ))}
          <li>
            <button
              ref={mobileMenuButtonRef}
              type="button"
              aria-expanded={isMobileMenuOpen}
              aria-controls="client-mobile-more-menu"
              onClick={() => setIsMobileMenuOpen((isOpen) => !isOpen)}
              className={`flex min-h-12 w-full flex-col items-center justify-center gap-1 rounded-xl text-[10px] font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7fd4e8] ${
                isMobileMoreRoute || isMobileMenuOpen ? "bg-[#6ec144]/15 text-[#9ee67d]" : "text-white/50"
              }`}
            >
              <Menu className="h-4 w-4" aria-hidden="true" />
              More
            </button>
          </li>
        </ul>
      </nav>
    </div>
  );
}
