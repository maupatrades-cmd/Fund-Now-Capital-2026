import { useEffect, type ReactNode } from "react";

// Lightweight modal shell matching the hand-rolled overlay already used on the
// deal-detail reopen dialog (no shadcn Dialog in this project). Click-outside
// and Escape close; the caller owns the body + footer.
export function Modal({
  title,
  onClose,
  children,
  maxWidth = "max-w-md",
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  maxWidth?: string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 grid place-items-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div className={"relative z-10 w-full space-y-4 rounded-xl border border-border bg-white p-6 shadow-xl " + maxWidth}>
        <h3 className="text-lg font-semibold text-brand-navy">{title}</h3>
        {children}
      </div>
    </div>
  );
}
