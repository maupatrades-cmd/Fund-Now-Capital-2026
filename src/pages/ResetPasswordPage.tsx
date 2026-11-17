import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/lib/useSession";

async function functionErrorMessage(error: unknown): Promise<string> {
  const context = (error as { context?: unknown })?.context;
  if (context instanceof Response) {
    try {
      const body = await context.clone().json();
      if (body?.error) return String(body.error);
    } catch {
      // Fall through to the SDK error.
    }
  }
  return (error as { message?: string })?.message ?? "Could not set the password.";
}

// Where the welcome email (?welcome=1) and the "Forgot password" email land. The emailed link signs the person in;
// here they choose their password (complete-password-reset), then sign in with it.
export default function ResetPasswordPage() {
  const session = useSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const welcome = params.get("welcome") === "1";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setError(null);
    if (password !== confirm) {
      setError("The passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const { error: fnError } = await supabase.functions.invoke("complete-password-reset", { body: { new_password: password } });
      if (fnError) throw new Error(await functionErrorMessage(fnError));
      await supabase.auth.signOut();
      toast.success("Password saved. Sign in with your email and new password.");
      navigate("/", { replace: true });
    } catch (caught) {
      setError((caught as Error).message || "Could not set the password.");
    } finally {
      setBusy(false);
    }
  };

  const inputClass =
    "mt-1.5 w-full rounded-lg border border-border px-3 py-2.5 outline-none focus:border-brand-teal focus:ring-2 focus:ring-brand-teal/20";

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 via-white to-brand-teal/10 p-4">
      <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl sm:p-8">
        <img src="/fnc-logo.png" alt="Fund Now Capital — Many funders. More approvals." className="mb-6 h-auto w-56" />
        {session === undefined ? (
          <p className="text-sm text-muted-foreground">Checking your link…</p>
        ) : session === null ? (
          <div className="space-y-4">
            <h1 className="text-2xl font-bold text-brand-navy">This link has expired</h1>
            <p className="text-sm leading-6 text-muted-foreground">
              Password links work once and only for a short time. Request a new one and use it straight away.
            </p>
            <Link to="/forgot-password" className="inline-block text-sm font-semibold text-brand-teal hover:underline">Send me a new link</Link>
          </div>
        ) : (
          <>
            <h1 className="text-2xl font-bold text-brand-navy">{welcome ? "Welcome to Fund Now Capital" : "Choose a new password"}</h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {welcome ? "Choose the password you will use to sign in" : "Choose a new password for"} <strong>{session.user.email}</strong>.
              At least 12 characters, with an uppercase letter, a lowercase letter, a number and a symbol.
            </p>
            <form className="mt-6 space-y-4" onSubmit={submit}>
              <label className="block text-sm font-semibold text-brand-navy">
                New password
                <input required type={show ? "text" : "password"} autoComplete="new-password" value={password}
                  onChange={(event) => setPassword(event.target.value)} className={inputClass} />
              </label>
              <label className="block text-sm font-semibold text-brand-navy">
                Confirm new password
                <input required type={show ? "text" : "password"} autoComplete="new-password" value={confirm}
                  onChange={(event) => setConfirm(event.target.value)} className={inputClass} />
              </label>
              <button type="button" onClick={() => setShow((v) => !v)}
                className="inline-flex items-center gap-2 text-sm font-semibold text-brand-teal" aria-pressed={show}>
                {show ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
                {show ? "Hide passwords" : "Show passwords"}
              </button>
              {error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}
              <button type="submit" disabled={busy}
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-brand-teal px-5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                Save password
              </button>
            </form>
          </>
        )}
      </section>
    </main>
  );
}
