import { FileText, LogOut, Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/lib/useSession";

// Contractor portal shell — intentionally minimal (CONTRACTOR.md Phase 1
// foundation). Real screens (lead submission, progression, earnings,
// training) grow from here in later PRs. Deliberately NOT the owner
// AppLayout: the contractor world gets its own chrome, same brand.
export default function ContractorHomePage() {
  const session = useSession();
  const email = session?.user?.email ?? "";

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-10 flex h-16 items-center gap-3 border-b border-border bg-white px-4 sm:px-6">
        <img src="/brand-mark.png" alt="Fund Now Capital" className="h-9 w-9 object-contain" />
        <h1 className="text-lg font-semibold text-brand-navy">Contractor Portal</h1>

        <div className="ml-auto flex items-center gap-3">
          <div className="hidden sm:flex flex-col items-end leading-tight">
            <span className="text-sm font-medium text-brand-navy">{email}</span>
            <span className="text-[11px] text-muted-foreground">Contractor</span>
          </div>
          <button
            type="button"
            onClick={() => supabase.auth.signOut()}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium text-brand-navy hover:bg-slate-50"
          >
            <LogOut className="h-4 w-4" />
            <span className="hidden sm:inline">Sign out</span>
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
        <div>
          <h2 className="text-2xl font-bold text-brand-navy">
            Welcome to Fund Now Capital
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Many funders. More approvals.
          </p>
        </div>

        <div className="rounded-xl border border-border bg-white p-8 text-center shadow-sm">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-brand-teal/10 text-brand-teal">
            <FileText className="h-6 w-6" />
          </span>
          <h3 className="mt-3 text-base font-semibold text-brand-navy">
            Your submitted leads will appear here
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Once you start submitting leads, you'll track their progress on this page.
          </p>
        </div>

        <div className="rounded-xl border border-border bg-white p-8 text-center shadow-sm">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-brand-green/10 text-brand-green">
            <Plus className="h-6 w-6" />
          </span>
          <h3 className="mt-3 text-base font-semibold text-brand-navy">
            Submit a new lead
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Bring a business that needs funding to Fund Now Capital.
          </p>
          <button
            type="button"
            onClick={() => toast("Lead submission is coming soon")}
            className="mt-4 rounded-lg bg-brand-navy px-4 py-2 text-sm font-semibold text-white hover:bg-brand-navy/90"
          >
            Submit a new lead
          </button>
        </div>
      </main>
    </div>
  );
}
