import { Link } from "react-router-dom";
import { FileText, ListChecks, PlusCircle } from "lucide-react";
import PortalShell from "@/components/portal/PortalShell";
import { BadgesCard } from "@/components/portal/BadgesCard";

// Contractor portal home. Branded PortalShell chrome (shared with the partner
// portal) with the "Submit Lead" / "My Leads" nav, a welcome, and a top-level
// "Submit a new lead" CTA. Real screens (progression, earnings, training) grow
// from here in later PRs.
//
// NOTE (coordination): the BADGES lane also adds a badge-display CARD to this
// page. Both lanes edit this file from the same main base — keep additions in
// the content stack below so the two merges stay independent.
export default function ContractorHomePage() {
  // Note: the first-login T&C gate lives in ContractorGate (PortalTermsGate wraps
  // the whole /contractor subtree), so no acceptance check is needed on this page.

  return (
    <PortalShell portal="contractor">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold text-brand-navy">Welcome to Fund Now Capital</h1>
        <p className="text-sm text-muted-foreground">
          Many funders. More approvals. Bring a business that needs funding and track it here.
        </p>
      </div>

      {/* Top-level CTA: submit a new lead. */}
      <div className="flex flex-wrap items-center gap-3">
        <Link
          to="/contractor/submit-lead"
          className="inline-flex items-center gap-2 rounded-lg bg-brand-navy px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-navy/90"
        >
          <PlusCircle className="h-4 w-4" />
          Submit a new lead
        </Link>
        <Link
          to="/contractor/leads"
          className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2.5 text-sm font-medium text-brand-navy hover:bg-slate-50"
        >
          <ListChecks className="h-4 w-4" />
          My leads
        </Link>
      </div>

      {/* Gamification: recently earned badges + link to the full collection. */}
      <BadgesCard portal="contractor" />

      {/* Placeholder: submitted-leads snapshot grows here alongside the BADGES card. */}
      <div className="rounded-xl border border-border bg-white p-8 text-center shadow-sm">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-brand-teal/10 text-brand-teal">
          <FileText className="h-6 w-6" />
        </span>
        <h3 className="mt-3 text-base font-semibold text-brand-navy">
          Your submitted leads will appear here
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Track every lead you submit — head to <span className="font-medium text-brand-navy">My leads</span> to see their status.
        </p>
      </div>
    </PortalShell>
  );
}
