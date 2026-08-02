import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Handshake, ListChecks, PlusCircle } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import PortalShell from "@/components/portal/PortalShell";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/lib/useSession";

/*
 * Partner Portal home. Branded PortalShell chrome (shared with the contractor
 * portal) with the "Submit Lead" / "My Leads" nav, a personal welcome, a
 * top-level "Submit a new lead" CTA, and a placeholder the real referred-deals
 * surface (S11) will grow from. FNC branding only; partner logo storage is
 * C4/S11.2 territory.
 *
 * Data shown is limited to the partner's own referral_partners.name, reachable
 * through their own profiles row — both RLS-scoped to the signed-in partner
 * (POPIA: no client data, no funder identity, no commission figures here).
 */

// The signed-in partner's display name: referral_partners.name via the
// profiles.referral_partner_id link (verified live schema), falling back to
// the profile's full_name, then the email's local part. The query key carries
// the user id so a different account signing in on the same tab can never be
// served the previous partner's cached name (Macroscope PR #100 finding).
function usePartnerName(user: { id: string; email?: string } | undefined) {
  const uid = user?.id;
  return useQuery({
    queryKey: ["partner-name", uid],
    enabled: !!uid,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<string | null> => {
      if (!uid) return null;

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("full_name, referral_partner_id")
        .eq("id", uid)
        .maybeSingle();
      if (profileError) throw profileError;

      if (profile?.referral_partner_id) {
        const { data: partner, error: partnerError } = await supabase
          .from("referral_partners")
          .select("name")
          .eq("id", profile.referral_partner_id)
          .maybeSingle();
        if (partnerError) throw partnerError;
        if (partner?.name) return partner.name;
      }

      return profile?.full_name ?? user?.email?.split("@")[0] ?? null;
    },
  });
}

export default function PartnerHomePage() {
  const session = useSession();
  // isPending (not isLoading) so the name placeholder also covers the brief
  // window where the session is still resolving and the query is disabled.
  const { data: partnerName, isPending } = usePartnerName(session?.user);

  return (
    <PortalShell portal="partner">
      {/* Welcome */}
      <div className="space-y-1">
        <h1 className="text-2xl font-bold text-brand-navy">
          {isPending ? "Welcome" : `Welcome, ${partnerName ?? "Partner"}`}
        </h1>
        <p className="text-sm text-muted-foreground">
          Many funders. More approvals. Refer a business that needs funding and track it here.
        </p>
      </div>

      {/* Top-level CTA: submit a new lead. */}
      <div className="flex flex-wrap items-center gap-3">
        <Link
          to="/partner/submit-lead"
          className="inline-flex items-center gap-2 rounded-lg bg-brand-teal px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-teal/90"
        >
          <PlusCircle className="h-4 w-4" />
          Submit a new lead
        </Link>
        <Link
          to="/partner/leads"
          className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2.5 text-sm font-medium text-brand-navy hover:bg-slate-50"
        >
          <ListChecks className="h-4 w-4" />
          My leads
        </Link>
      </div>

      {/* Placeholder: referred deals land here in a later release. */}
      <EmptyState
        icon={Handshake}
        title="Your referred deals will appear here soon"
        description="As your referrals move through funding, you'll track their progress right here."
      />
    </PortalShell>
  );
}
