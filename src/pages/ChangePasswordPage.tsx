import { useState, type FormEvent } from "react";
import { Eye, EyeOff, KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";

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
  return (error as { message?: string })?.message ?? "Could not change the password.";
}

export default function ChangePasswordPage() {
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPasswords, setShowPasswords] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setError(null);
    if (newPassword !== confirmPassword) {
      setError("The new passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const { error: functionError } = await supabase.functions.invoke("change-user-password", {
        body: { current_password: currentPassword, new_password: newPassword },
      });
      if (functionError) throw new Error(await functionErrorMessage(functionError));
      await supabase.auth.signOut();
      toast.success("Password changed. Sign in with your new password.");
      navigate("/", { replace: true });
    } catch (caught) {
      setError((caught as Error).message || "Could not change the password.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 via-white to-brand-teal/10 p-4">
      <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl sm:p-8">
        <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-navy text-white">
          <KeyRound className="h-6 w-6" aria-hidden="true" />
        </div>
        <h1 className="text-2xl font-bold text-brand-navy">Choose your private password</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          For security, replace the temporary password supplied by Fund Now Capital before entering your portal.
        </p>

        <form className="mt-6 space-y-4" onSubmit={submit}>
          <label className="block text-sm font-semibold text-brand-navy">
            Current temporary password
            <input
              required
              type={showPasswords ? "text" : "password"}
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              className="mt-1.5 w-full rounded-lg border border-border px-3 py-2.5 outline-none focus:border-brand-teal focus:ring-2 focus:ring-brand-teal/20"
            />
          </label>
          <label className="block text-sm font-semibold text-brand-navy">
            New password
            <input
              required
              minLength={12}
              type={showPasswords ? "text" : "password"}
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              className="mt-1.5 w-full rounded-lg border border-border px-3 py-2.5 outline-none focus:border-brand-teal focus:ring-2 focus:ring-brand-teal/20"
            />
          </label>
          <label className="block text-sm font-semibold text-brand-navy">
            Confirm new password
            <input
              required
              minLength={12}
              type={showPasswords ? "text" : "password"}
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              className="mt-1.5 w-full rounded-lg border border-border px-3 py-2.5 outline-none focus:border-brand-teal focus:ring-2 focus:ring-brand-teal/20"
            />
          </label>

          <button
            type="button"
            onClick={() => setShowPasswords((visible) => !visible)}
            className="inline-flex items-center gap-2 text-sm font-medium text-brand-teal hover:underline"
          >
            {showPasswords ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            {showPasswords ? "Hide passwords" : "Show passwords"}
          </button>

          <p className="rounded-lg bg-slate-50 p-3 text-xs leading-5 text-slate-600">
            Use at least 12 characters with uppercase, lowercase, a number and a symbol.
          </p>
          {error ? <p className="text-sm text-red-700" role="alert">{error}</p> : null}

          <button
            type="submit"
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-teal px-4 py-3 text-sm font-bold text-white hover:bg-brand-teal/90 disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            {busy ? "Changing password…" : "Change password and continue"}
          </button>
        </form>
      </section>
    </main>
  );
}
