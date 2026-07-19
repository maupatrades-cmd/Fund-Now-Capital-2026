// Referred-by badge: "Self" (owner's own client, no partner) vs a partner name.
export function referredByMeta(partnerName: string | null) {
  if (!partnerName) {
    return { label: "Self", className: "bg-slate-100 text-slate-600 ring-slate-500/20" };
  }
  return { label: partnerName, className: "bg-brand-teal/10 text-brand-teal ring-brand-teal/20" };
}

// Document taxonomy moved to src/lib/documents.ts (B3.1 — full 52-type enum).
// SA data validation (cell, SA ID + Luhn, CIPC, VAT, postal) moved to the single
// source of truth src/lib/sa-validation.ts (B5). Import from there directly.
