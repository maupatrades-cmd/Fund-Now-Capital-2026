import { supabase } from "@/lib/supabase";

// Sign out, then HARD-redirect to the login screen via window.location.
//
// Why a hard navigation instead of a React Router transition: a full page load
// discards all in-memory state — React trees AND the TanStack Query cache,
// including the per-user role cache — so the next login always reads a fresh
// role and can never be served a stale one. It also guarantees the UI actually
// leaves the current portal even if the client-side redirect chain stalls
// (the "sign-out button does nothing" symptom).
//
// The redirect runs in `finally` so a failed server-side session revocation
// (e.g. an already-rotated refresh token, which makes signOut() reject) still
// clears the client and lands on login — the button never looks dead.
//
// Target is "/", the app's real login screen: AuthPage renders at "/" when
// signed out. We deliberately do NOT hard-navigate to "/login" — that path
// exists only as a client-side catch-all redirect to "/", so a full-page GET
// to it would depend on a Vercel SPA rewrite that isn't configured in-repo and
// could 404. "/" is the safe, equivalent target.
export async function signOutAndRedirect(): Promise<void> {
  try {
    await supabase.auth.signOut();
  } finally {
    window.location.href = "/";
  }
}
