import { useQuery } from "@tanstack/react-query";
import { ScrollText } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { TermsVersion } from "@/lib/terms";
import { TermsMarkdown } from "@/components/terms/TermsMarkdown";

/*
 * Public Terms & Conditions viewer (/terms/current).
 *
 * Deliberately OUTSIDE every auth gate — reachable without login so the FNC
 * website footer can link to it for reference. It reads the current version
 * directly from terms_versions, which the RLS public-read policy exposes to anon
 * (is_current = true only). If several current versions exist for different role
 * sets, the newest is shown.
 */
function useCurrentTerms() {
  return useQuery({
    queryKey: ["public-current-terms"],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<TermsVersion | null> => {
      const { data, error } = await supabase
        .from("terms_versions")
        .select("*")
        .eq("is_current", true)
        .order("effective_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data as TermsVersion | null) ?? null;
    },
  });
}

export default function TermsViewPage() {
  const { data: terms, isPending, isError } = useCurrentTerms();

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-border bg-white">
        <div className="mx-auto flex h-16 max-w-3xl items-center gap-3 px-4 sm:px-6">
          <img src="/brand-mark.png" alt="Fund Now Capital" className="h-9 w-9 object-contain" />
          <div className="leading-tight">
            <div className="text-sm font-bold text-brand-navy">
              Fund Now <span className="text-brand-teal">Capital</span>
            </div>
            <div className="text-[11px] text-muted-foreground">Terms &amp; Conditions</div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <div className="rounded-xl border border-border bg-white p-6 shadow-sm sm:p-8">
          {isPending ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : isError ? (
            <p className="text-sm text-red-600">
              We couldn't load the terms right now. Please try again later.
            </p>
          ) : !terms ? (
            <div className="py-8 text-center">
              <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-brand-teal/10 text-brand-teal">
                <ScrollText className="h-6 w-6" />
              </span>
              <p className="mt-3 text-sm text-muted-foreground">
                No published Terms &amp; Conditions are available yet.
              </p>
            </div>
          ) : (
            <>
              <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border pb-4">
                <span className="text-[12px] font-medium text-brand-navy">
                  Version {terms.version_number}
                </span>
                <span className="text-[12px] text-muted-foreground">
                  Effective {terms.effective_date}
                </span>
              </div>
              <TermsMarkdown markdown={terms.content_markdown} />
            </>
          )}
        </div>
      </main>
    </div>
  );
}
