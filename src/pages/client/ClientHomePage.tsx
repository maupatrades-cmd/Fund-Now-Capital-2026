import { useState } from "react";
import {
  ArrowRight,
  BadgeCheck,
  Banknote,
  Boxes,
  Building2,
  Check,
  ChevronRight,
  Clock3,
  FileCheck2,
  FileText,
  HelpCircle,
  Landmark,
  MessageCircle,
  ShieldCheck,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import ClientPortalShell from "@/components/client-portal/ClientPortalShell";
import { useClientPortalIdentity } from "@/hooks/useClientPortalIdentity";

const products = [
  { key: "working-capital", label: "Working capital", detail: "Flexible business funding up to R100 million", icon: Banknote },
  { key: "purchase-order", label: "Purchase order", detail: "Funding to fulfil confirmed purchase orders", icon: FileCheck2 },
  { key: "invoice-discounting", label: "Invoice discounting", detail: "Unlock cash tied up in approved invoices", icon: FileText },
  { key: "asset-backed", label: "Asset-backed finance", detail: "Funding supported by qualifying business assets", icon: Building2 },
  { key: "equipment", label: "Equipment finance", detail: "Acquire machinery, vehicles or operating equipment", icon: Boxes },
  { key: "investment", label: "Investment funding", detail: "Growth capital for suitable opportunities", icon: TrendingUp },
  { key: "private-equity", label: "Private equity", detail: "Strategic capital for established businesses", icon: Landmark },
] as const;

const journey = [
  { label: "Application", detail: "Tell us about your business and funding goal" },
  { label: "Documents", detail: "Complete your tailored documentation checklist" },
  { label: "Review", detail: "Our team checks readiness and prepares your package" },
  { label: "Funder matching", detail: "We approach suitable funders with your permission" },
  { label: "Decision", detail: "Compare the outcome and take the next step" },
];

export default function ClientHomePage() {
  const identity = useClientPortalIdentity();
  const [selectedProduct, setSelectedProduct] = useState<string | null>(null);
  const firstName = identity.data?.contactName?.split(/\s+/)[0] ?? "there";
  const selectedLabel = products.find((product) => product.key === selectedProduct)?.label;

  return (
    <ClientPortalShell>
      <div id="overview" className="space-y-6">
        <section className="client-glass relative overflow-hidden rounded-[28px] px-5 py-7 sm:px-8 sm:py-10 xl:px-12">
          <div className="absolute -right-16 -top-20 h-72 w-72 rounded-full border border-[#7fd4e8]/15" aria-hidden="true" />
          <div className="client-orbit absolute -right-10 -top-14 h-60 w-60 rounded-full border border-dashed border-[#6ec144]/25" aria-hidden="true">
            <span className="absolute left-1/2 top-0 h-3 w-3 -translate-x-1/2 rounded-full bg-[#6ec144] shadow-[0_0_24px_#6ec144]" />
          </div>
          <div className="relative max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-[#6ec144]/25 bg-[#6ec144]/10 px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-[0.18em] text-[#a2eb80]">
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              Your funding workspace
            </div>
            <h1 className="mt-5 max-w-2xl text-3xl font-extrabold leading-tight tracking-[-0.04em] sm:text-5xl">
              Welcome, {firstName}. Let’s move your business forward.
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-white/58 sm:text-base">
              One secure place to complete your application, share documents and follow every step of your funding journey.
            </p>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <a href="#application" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#6ec144] to-[#2ca8a8] px-5 text-sm font-extrabold text-[#06131d] shadow-lg shadow-[#2ca8a8]/15 transition hover:-translate-y-0.5">
                Explore funding options <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </a>
              <a href="#support" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-white/12 bg-white/5 px-5 text-sm font-bold text-white/80 transition hover:bg-white/10">
                Talk to our team <MessageCircle className="h-4 w-4" aria-hidden="true" />
              </a>
            </div>
          </div>
        </section>

        {identity.isError ? (
          <section role="alert" className="rounded-2xl border border-amber-300/20 bg-amber-300/8 p-5 text-sm text-amber-100">
            <p className="font-bold">Your secure account needs to be linked.</p>
            <p className="mt-1 text-amber-100/70">{identity.error.message} Fund Now Capital can complete this connection without asking you to create another account.</p>
          </section>
        ) : null}

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Portal readiness">
          {[
            { icon: ShieldCheck, title: "Identity", value: identity.isLoading ? "Checking…" : identity.data ? "Verified" : "Needs attention", tone: "text-[#9ee67d]" },
            { icon: Building2, title: "Business profile", value: identity.data?.businessName ?? "Link pending", tone: "text-[#7fd4e8]" },
            { icon: FileCheck2, title: "Application", value: selectedLabel ?? "Not started", tone: "text-white" },
            { icon: Clock3, title: "Current step", value: "Getting started", tone: "text-[#f0b25e]" },
          ].map((item) => (
            <article key={item.title} className="client-glass rounded-2xl p-5 transition hover:-translate-y-1 hover:border-white/20">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-bold uppercase tracking-[0.17em] text-white/35">{item.title}</p>
                <item.icon className={`h-4 w-4 ${item.tone}`} aria-hidden="true" />
              </div>
              <p className={`mt-4 truncate text-lg font-extrabold ${item.tone}`}>{item.value}</p>
            </article>
          ))}
        </section>

        <section id="application" className="client-glass scroll-mt-28 rounded-[28px] p-5 sm:p-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-[#86d4cf]">Start with your goal</p>
              <h2 className="mt-2 text-2xl font-extrabold tracking-tight sm:text-3xl">What kind of funding do you need?</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-white/50">Choose one option to preview the correct application path. Your final submission will only happen after you review it.</p>
            </div>
            {selectedLabel ? (
              <div className="inline-flex items-center gap-2 rounded-full bg-[#6ec144]/12 px-3 py-2 text-xs font-bold text-[#a2eb80]">
                <Check className="h-3.5 w-3.5" aria-hidden="true" /> {selectedLabel} selected
              </div>
            ) : null}
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {products.map((product) => {
              const selected = selectedProduct === product.key;
              return (
                <button
                  type="button"
                  key={product.key}
                  aria-pressed={selected}
                  onClick={() => setSelectedProduct(product.key)}
                  className={`group min-h-40 rounded-2xl border p-4 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6ec144] ${
                    selected
                      ? "border-[#6ec144]/55 bg-[#6ec144]/12 shadow-[0_0_32px_rgba(110,193,68,.1)]"
                      : "border-white/9 bg-white/[0.035] hover:-translate-y-1 hover:border-white/18 hover:bg-white/[0.06]"
                  }`}
                >
                  <span className={`grid h-10 w-10 place-items-center rounded-xl ${selected ? "bg-[#6ec144] text-[#06131d]" : "bg-white/7 text-[#7fd4e8]"}`}>
                    <product.icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <span className="mt-5 flex items-center justify-between gap-3">
                    <span className="font-extrabold">{product.label}</span>
                    <ChevronRight className={`h-4 w-4 transition group-hover:translate-x-0.5 ${selected ? "text-[#9ee67d]" : "text-white/25"}`} aria-hidden="true" />
                  </span>
                  <span className="mt-2 block text-xs leading-5 text-white/45">{product.detail}</span>
                </button>
              );
            })}
          </div>

          {selectedProduct ? (
            <div className="mt-5 flex flex-col gap-4 rounded-2xl border border-[#7fd4e8]/15 bg-[#7fd4e8]/6 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex gap-3">
                <BadgeCheck className="mt-0.5 h-5 w-5 shrink-0 text-[#7fd4e8]" aria-hidden="true" />
                <div>
                  <p className="text-sm font-bold">Your {selectedLabel?.toLowerCase()} path is ready to begin.</p>
                  <p className="mt-1 text-xs leading-5 text-white/45">The detailed form and document checklist will activate when the matching backend PRs are merged and migrated.</p>
                </div>
              </div>
              <span className="shrink-0 rounded-xl border border-white/10 px-4 py-2 text-xs font-bold text-white/45">Preview only</span>
            </div>
          ) : null}
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.2fr_.8fr]">
          <article className="client-glass rounded-[28px] p-5 sm:p-8">
            <p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-[#86d4cf]">Clear from day one</p>
            <h2 className="mt-2 text-2xl font-extrabold">Your funding journey</h2>
            <ol className="mt-7 space-y-1">
              {journey.map((step, index) => (
                <li key={step.label} className="group flex gap-4 rounded-2xl p-3 transition hover:bg-white/[0.04]">
                  <div className="flex flex-col items-center">
                    <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full border text-xs font-extrabold ${index === 0 ? "client-pulse border-[#6ec144]/60 bg-[#6ec144]/15 text-[#a2eb80]" : "border-white/10 bg-white/5 text-white/35"}`}>{index + 1}</span>
                    {index < journey.length - 1 ? <span className="my-1 h-8 w-px bg-white/9" aria-hidden="true" /> : null}
                  </div>
                  <div className="pt-1">
                    <p className="text-sm font-extrabold">{step.label}</p>
                    <p className="mt-1 text-xs leading-5 text-white/43">{step.detail}</p>
                  </div>
                </li>
              ))}
            </ol>
          </article>

          <div className="space-y-6">
            <article id="documents" className="client-glass scroll-mt-28 rounded-[28px] p-5 sm:p-7">
              <div className="flex items-center justify-between">
                <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[#2ca8a8]/15 text-[#7fd4e8]"><FileText className="h-5 w-5" aria-hidden="true" /></span>
                <span className="rounded-full border border-white/9 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.15em] text-white/35">Coming next</span>
              </div>
              <h2 className="mt-5 text-xl font-extrabold">Smart document checklist</h2>
              <p className="mt-2 text-sm leading-6 text-white/48">Your checklist will combine your funding type, Owner review and the selected funder’s requirements—without exposing private funder details.</p>
            </article>

            <article id="support" className="client-glass scroll-mt-28 rounded-[28px] p-5 sm:p-7">
              <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[#6ec144]/15 text-[#9ee67d]"><HelpCircle className="h-5 w-5" aria-hidden="true" /></span>
              <h2 className="mt-5 text-xl font-extrabold">Real people, one conversation away</h2>
              <p className="mt-2 text-sm leading-6 text-white/48">Need help choosing a funding path or preparing paperwork? Contact the Fund Now Capital team before submitting.</p>
              <a href="mailto:thapelol@fundnowcapital.africa" className="mt-5 inline-flex items-center gap-2 text-sm font-extrabold text-[#9ee67d] hover:text-white">
                Email our team <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </a>
            </article>
          </div>
        </section>

        <footer className="flex flex-col gap-3 border-t border-white/8 py-6 text-xs text-white/30 sm:flex-row sm:items-center sm:justify-between">
          <p>© 2026 Fund Now Capital. Secure client workspace.</p>
          <div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-[#6ec144]" aria-hidden="true" /> POPIA-aware access controls</div>
        </footer>
      </div>
    </ClientPortalShell>
  );
}
