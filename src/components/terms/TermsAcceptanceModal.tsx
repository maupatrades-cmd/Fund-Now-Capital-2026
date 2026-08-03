import { useEffect, useRef, useState } from "react";
import { ScrollText, ArrowDown } from "lucide-react";
import { signOutAndRedirect } from "@/lib/signOut";
import type { TermsVersion } from "@/lib/terms";
import { TermsMarkdown } from "./TermsMarkdown";

/*
 * First-login Terms & Conditions gate for the partner + contractor portals.
 *
 * Real behaviour (Sprint 4, Lane 4d brief):
 *   - Blocks the portal home page until the user Accepts (or Declines → sign out).
 *   - Accept is DISABLED until the terms have been scrolled to the bottom.
 *   - Dismissable ONLY via Accept or Decline — no X, no backdrop click, no Escape.
 *     (Deliberately no click-outside/Escape handlers; the overlay swallows clicks.)
 *   - Accept has a useRef in-flight guard (Fix #4 pattern) so a double-click can't
 *     fire two accept_terms calls — the RPC is idempotent, but the UI shouldn't rely
 *     on that.
 *   - Decline signs the user out cleanly: they must accept to use the portal.
 */
export function TermsAcceptanceModal({
  version,
  onAccept,
  accepting,
  errorMessage,
}: {
  version: TermsVersion;
  onAccept: () => void;
  accepting: boolean;
  errorMessage?: string | null;
}) {
  const [scrolledToBottom, setScrolledToBottom] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inFlight = useRef(false);

  // Lock background scroll while the gate is open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // If the content is short enough that there's nothing to scroll, enable Accept
  // immediately (never trap the user behind a scroll that can't happen).
  const checkAtBottom = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= 24;
    if (atBottom) setScrolledToBottom(true);
  };
  useEffect(() => {
    // A new version must be reviewed from the top: reset the gate and scroll
    // position so a user who'd scrolled the previous version can't accept the
    // new one unread (Macroscope Medium).
    setScrolledToBottom(false);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    checkAtBottom();
    // Re-check after layout settles (fonts/markdown height).
    const t = setTimeout(checkAtBottom, 150);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version.id]);

  // Release the in-flight guard whenever a submit settles (success closes the
  // modal via the parent; on error the guard reopens so the user can retry).
  useEffect(() => {
    if (!accepting) inFlight.current = false;
  }, [accepting]);

  const canAccept = scrolledToBottom && !accepting;

  const handleAccept = () => {
    if (inFlight.current || !canAccept) return;
    inFlight.current = true;
    onAccept();
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/70 p-4" role="dialog" aria-modal="true" aria-labelledby="terms-modal-title">
      <div className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-border bg-brand-navy px-6 py-4">
          <span className="grid h-9 w-9 place-items-center rounded-full bg-white/10 text-brand-teal">
            <ScrollText className="h-5 w-5" />
          </span>
          <div className="leading-tight">
            <h2 id="terms-modal-title" className="text-base font-semibold text-white">
              Terms &amp; Conditions
            </h2>
            <p className="text-[12px] text-white/60">
              Version {version.version_number} · Please review and accept to continue.
            </p>
          </div>
        </div>

        {/* Scrollable body */}
        <div
          ref={scrollRef}
          onScroll={checkAtBottom}
          className="min-h-0 flex-1 overflow-y-auto px-6 py-5"
        >
          <TermsMarkdown markdown={version.content_markdown} />
        </div>

        {/* Footer */}
        <div className="border-t border-border bg-slate-50 px-6 py-4">
          {!scrolledToBottom && (
            <p className="mb-3 flex items-center justify-center gap-1.5 text-[12px] text-muted-foreground">
              <ArrowDown className="h-3.5 w-3.5" />
              Scroll to the bottom to enable acceptance
            </p>
          )}
          {errorMessage && (
            <p className="mb-3 text-center text-sm text-red-600">{errorMessage}</p>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => void signOutAndRedirect()}
              disabled={accepting}
              className="rounded-lg border border-border px-4 py-2.5 text-sm font-medium text-brand-navy hover:bg-white disabled:opacity-50"
            >
              Decline &amp; sign out
            </button>
            <button
              type="button"
              onClick={handleAccept}
              disabled={!canAccept}
              className="rounded-lg bg-brand-teal px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-teal/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {accepting ? "Recording…" : "I Accept"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
