import { type ReactNode } from "react";
import { Bell, FileCheck2, Gauge, Headphones, LogOut, UserRound } from "lucide-react";
import { useClientPortalIdentity } from "@/hooks/useClientPortalIdentity";
import { signOutAndRedirect } from "@/lib/signOut";
import { useSession } from "@/lib/useSession";
import "@/components/client-portal/client-portal.css";

const navigation = [
  { href: "#overview", label: "Overview", icon: Gauge },
  { href: "#application", label: "Application", icon: FileCheck2 },
  { href: "#support", label: "Support", icon: Headphones },
  { href: "#profile", label: "Profile", icon: UserRound },
];

export default function ClientPortalShell({ children }: { children: ReactNode }) {
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

  return (
    <div className="client-portal min-h-screen bg-[#06131d] text-white">
      <div className="client-aurora client-aurora--green" aria-hidden="true" />
      <div className="client-aurora client-aurora--blue" aria-hidden="true" />
      <div className="client-grid" aria-hidden="true" />

      <aside className="client-rail fixed inset-y-0 left-0 z-30 hidden w-[248px] flex-col border-r border-white/10 px-5 py-6 lg:flex">
        <a href="#overview" className="flex items-center gap-3" aria-label="Fund Now Capital client portal home">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-white shadow-lg shadow-black/20">
            <img src="/brand-mark.png" alt="" className="h-10 w-10 object-contain" />
          </span>
          <span>
            <span className="block text-sm font-extrabold tracking-tight">Fund Now Capital</span>
            <span className="block text-[10px] font-semibold uppercase tracking-[0.2em] text-[#86d4cf]">Client portal</span>
          </span>
        </a>

        <nav className="mt-12 flex-1" aria-label="Client portal navigation">
          <p className="mb-4 text-[10px] font-bold uppercase tracking-[0.22em] text-white/35">Your funding</p>
          <ul className="space-y-2">
            {navigation.map((item, index) => (
              <li key={item.href}>
                <a
                  href={item.href}
                  className={`flex items-center gap-3 rounded-2xl border px-4 py-3 text-sm font-semibold transition ${
                    index === 0
                      ? "border-[#6ec144]/35 bg-[#6ec144]/12 text-[#9ee67d]"
                      : "border-transparent text-white/60 hover:border-white/10 hover:bg-white/5 hover:text-white"
                  }`}
                >
                  <item.icon className="h-4 w-4" aria-hidden="true" />
                  {item.label}
                </a>
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
                className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-white/5 text-white/65 transition hover:bg-white/10 hover:text-white"
                aria-label="Notifications"
              >
                <Bell className="h-4 w-4" aria-hidden="true" />
              </button>
              <div id="profile" className="hidden text-right sm:block">
                <p className="max-w-48 truncate text-sm font-bold">{contactName}</p>
                <p className="max-w-48 truncate text-[11px] text-white/40">{session?.user.email}</p>
              </div>
              <div className="grid h-10 w-10 place-items-center rounded-full bg-gradient-to-br from-[#6ec144] to-[#2ca8a8] text-xs font-extrabold text-[#06131d]">
                {initials}
              </div>
              <button
                type="button"
                onClick={() => void signOutAndRedirect()}
                className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-white/5 text-white/65 transition hover:border-red-300/30 hover:bg-red-400/10 hover:text-red-200"
                aria-label="Sign out"
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-[1500px] px-4 pb-24 pt-6 sm:px-6 lg:px-8 lg:pb-10">{children}</main>
      </div>

      <nav className="fixed inset-x-3 bottom-3 z-40 rounded-2xl border border-white/12 bg-[#0a1d2a]/95 p-2 shadow-2xl shadow-black/35 backdrop-blur-2xl lg:hidden" aria-label="Client mobile navigation">
        <ul className="grid grid-cols-4 gap-1">
          {navigation.map((item, index) => (
            <li key={item.href}>
              <a
                href={item.href}
                className={`flex min-h-12 flex-col items-center justify-center gap-1 rounded-xl text-[10px] font-bold ${
                  index === 0 ? "bg-[#6ec144]/15 text-[#9ee67d]" : "text-white/50"
                }`}
              >
                <item.icon className="h-4 w-4" aria-hidden="true" />
                {item.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
