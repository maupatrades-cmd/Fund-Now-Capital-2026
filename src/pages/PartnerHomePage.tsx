import { useQuery } from "@tanstack/react-query";
import { Handshake, LogOut, PlusCircle } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { supabase } from "@/lib/supabase";

/*
 * Partner Portal welcome screen — the first partner-facing surface (Phase D
 * groundwork). Deliberately minimal: a branded header, a personal welcome, and
 * two placeholders the real portal screens (S11) will grow from. Uses its own
 * lightweight shell, NOT the owner AppLayout (S11: partner login gets his own
 * layout). FNC branding only — partner logo storage is C4/D territory (S11.2).
 *
 * Data shown is limited to the partner's own referral_partners.name, reachable
 * through their own profiles row — both RLS-scoped to the signed-in partner
 * (POPIA: no client data, no funder identity, no commission figures here).
 */

// The signed-in partner's display name: referral_partners.name via the
// profiles.referral_partner_id link (verified live schema), falling back to
// the profile's full_name, then the email's local part.
function usePartnerName() {
  return useQuery({
    queryKey: ["partner-name"],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<string | null> => {
      const { data: userData } = await supabase.auth.getUser();
      const user = userData.user;
      if (!user) return null;

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("full_name, referral_partner_id")
        .eq("id", user.id)
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

      return profile?.full_name ?? user.email?.split("@")[0] ?? null;
    },
  });
}

export default function PartnerHomePage() {
  const { data: partnerName, isLoading } = usePartnerName();

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Portal header: navy brand bar with the FNC lockup + sign out. */}
      <header className="bg-brand-navy text-white">
        <div className="mx-auto flex h-16 max-w-4xl items-center gap-3 px-4 sm:px-6">
          <img src="/brand-mark.png" alt="Fund Now Capital" className="h-9 w-9 object-contain" />
          <div className="leading-tight">
            <div className="text-sm font-bold">
              Fund Now <span className="text-brand-teal">Capital</span>
            </div>
            <div className="text-[11px] text-white/50">Partner Portal</div>
          </div>
          <button
            type="button"
            onClick={() => supabase.auth.signOut()}
            className="ml-auto flex items-center gap-1.5 rounded-lg border border-white/20 px-3 py-2 text-sm font-medium text-white hover:bg-white/10"
          >
            <LogOut className="h-4 w-4" />
            <span className="hidden sm:inline">Sign out</span>
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:px-6">
        {/* Welcome */}
        <div className="space-y-1">
          <h1 className="text-2xl font-bold text-brand-navy">
            {isLoading ? "Welcome" : `Welcome, ${partnerName ?? "Partner"}`}
          </h1>
          <p className="text-sm text-muted-foreground">
            Many funders. More approvals. Your partner portal is taking shape — here's where
            your referrals will live.
          </p>
        </div>

        {/* Placeholder: referred deals land here in a later release. */}
        <EmptyState
          icon={Handshake}
          title="Your referred deals will appear here soon"
          description="As your referrals move through funding, you'll track their progress right here."
        />

        {/* Placeholder: lead submission ships in a later release. */}
        <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-white px-6 py-8 text-center shadow-sm">
          <p className="text-sm text-muted-foreground">
            Have a business that needs funding? Lead submission is on its way.
          </p>
          <button
            type="button"
            disabled
            className="flex cursor-not-allowed items-center gap-2 rounded-lg bg-brand-teal px-4 py-2 text-sm font-semibold text-white opacity-60"
          >
            <PlusCircle className="h-4 w-4" />
            Submit a new lead
            <span className="rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide">
              Coming soon
            </span>
          </button>
        </div>
      </main>
    </div>
  );
}
