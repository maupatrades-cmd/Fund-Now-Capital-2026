import type { ReactNode } from "react";
import { RefreshCw, ScrollText } from "lucide-react";
import { signOutAndRedirect } from "@/lib/signOut";
import { useTermsAcceptance } from "@/hooks/useTermsAcceptance";
import type { PortalRole } from "@/lib/terms";
import { TermsAcceptanceModal } from "./TermsAcceptanceModal";

/*
 * Wraps a portal's ENTIRE route subtree with the first-login Terms & Conditions
 * gate (partner + contractor).
 *
 * Why here and not on the home page: mounting the modal only on the portal index
 * page let an unaccepted user deep-link to a sub-route (e.g. /partner/submit-lead)
 * and skip the check (Macroscope High). This gate sits inside PartnerGate /
 * ContractorGate, so NOTHING under the portal renders until the current terms are
 * accepted.
 *
 * The gate FAILS CLOSED (Macroscope High): while the acceptance check is loading
 * or has errored, the portal is blocked rather than shown — a network/RPC failure
 * can never let an unaccepted user through. When acceptance is required, only the
 * modal renders (no portal content behind it), so nothing is reachable until the
 * user Accepts or Declines (→ sign out).
 */
function BlockingCard({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen place-items-center bg-slate-50 p-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-white p-6 text-center shadow-sm">
        <span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-brand-teal/10 text-brand-teal">
          <ScrollText className="h-5 w-5" />
        </span>
        <div className="mt-3 space-y-3 text-sm text-slate-700">{children}</div>
      </div>
    </div>
  );
}

export function PortalTermsGate({ role, children }: { role: PortalRole; children: ReactNode }) {
  const terms = useTermsAcceptance(role);

  // Fail closed while we don't yet have a definitive answer.
  if (terms.isLoading) {
    return <BlockingCard>Checking your Terms &amp; Conditions…</BlockingCard>;
  }

  if (terms.isError) {
    return (
      <BlockingCard>
        <p>We couldn't verify your Terms &amp; Conditions status. Please try again.</p>
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => void terms.refetch()}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-brand-teal px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-teal/90"
          >
            <RefreshCw className="h-4 w-4" />
            Try again
          </button>
          <button
            type="button"
            onClick={() => void signOutAndRedirect()}
            className="rounded-lg border border-border px-4 py-2.5 text-sm font-medium text-brand-navy hover:bg-slate-50"
          >
            Sign out
          </button>
        </div>
      </BlockingCard>
    );
  }

  // Acceptance required → block the whole portal with the modal.
  if (terms.needsAcceptance && terms.version) {
    return (
      <TermsAcceptanceModal
        version={terms.version}
        onAccept={() => terms.accept.mutate(terms.version!.id)}
        accepting={terms.accept.isPending}
        errorMessage={
          terms.accept.isError ? "We couldn't record your acceptance. Please try again." : null
        }
      />
    );
  }

  return <>{children}</>;
}
