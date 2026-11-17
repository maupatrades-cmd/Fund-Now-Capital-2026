import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Loader2, MailCheck } from "lucide-react";
import { supabase } from "@/lib/supabase";

// Public "Forgot password" page. The request-password-reset Edge Function always answers the same way, so this
// page never tells anyone whether an email has an account.
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const { error: fnError } = await supabase.functions.invoke("request-password-reset", { body: { email: email.trim() } });
      if (fnError) throw fnError;
      setSent(true);
    } catch {
      setError("Could not send the reset email. Check the address and try again in a minute.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 via-white to-brand-teal/10 p-4">
      <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl sm:p-8">
        <img src="/fnc-logo.png" alt="Fund Now Capital — Many funders. More approvals." className="mb-6 h-auto w-56" />
        {sent ? (
          <div className="space-y-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-teal/10 text-brand-teal">
              <MailCheck className="h-6 w-6" aria-hidden="true" />
            </div>
            <h1 className="text-2xl font-bold text-brand-navy">Check your email</h1>
            <p className="text-sm leading-6 text-muted-foreground">
              If an account exists for <strong>{email.trim()}</strong>, a link to choose a new password is on its way. It works once and
              expires after a short time. Check your spam folder if it does not arrive within a few minutes.
            </p>
            <Link to="/" className="inline-block text-sm font-semibold text-brand-teal hover:underline">Back to sign in</Link>
          </div>
        ) : (
          <>
            <h1 className="text-2xl font-bold text-brand-navy">Forgot your password?</h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Enter the email address you sign in with and we will email you a link to choose a new password.
            </p>
            <form className="mt-6 space-y-4" onSubmit={submit}>
              <label className="block text-sm font-semibold text-brand-navy">
                Email address
                <input
                  required
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-border px-3 py-2.5 outline-none focus:border-brand-teal focus:ring-2 focus:ring-brand-teal/20"
                />
              </label>
              {error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}
              <button
                type="submit"
                disabled={busy}
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-brand-teal px-5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                Email me a reset link
              </button>
            </form>
            <Link to="/" className="mt-4 inline-block text-sm font-semibold text-brand-teal hover:underline">Back to sign in</Link>
          </>
        )}
      </section>
    </main>
  );
}
