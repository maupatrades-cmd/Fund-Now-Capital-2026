import { useSession } from "@/lib/useSession";
import { supabase } from "@/lib/supabase";

// Placeholder landing screen after a successful login. The real dashboard
// (pipeline, deals, commission engine) comes in later steps.
export default function DashboardPage() {
  const session = useSession();

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-2xl font-bold text-brand-navy">Dashboard</h1>
      <p className="text-sm text-muted-foreground">
        You are signed in{session?.user?.email ? ` as ${session.user.email}` : ""}.
      </p>
      <p className="text-sm text-muted-foreground">
        This is a placeholder — the CRM screens are coming next.
      </p>
      <button
        type="button"
        onClick={() => supabase.auth.signOut()}
        className="mt-2 rounded-lg bg-brand-navy px-4 py-2 text-sm font-semibold text-white"
      >
        Sign out
      </button>
    </div>
  );
}
