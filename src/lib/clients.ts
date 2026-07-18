// Referred-by badge: "Self" (owner's own client, no partner) vs a partner name.
export function referredByMeta(partnerName: string | null) {
  if (!partnerName) {
    return { label: "Self", className: "bg-slate-100 text-slate-600 ring-slate-500/20" };
  }
  return { label: partnerName, className: "bg-brand-teal/10 text-brand-teal ring-brand-teal/20" };
}

// Document taxonomy moved to src/lib/documents.ts (B3.1 — full 52-type enum).

// ---- South African validation -------------------------------------------
// Mobile numbers: 0XX XXX XXXX or +27 XX XXX XXXX, starting 6/7/8. Spaces and
// dashes are ignored.
export function normaliseCell(raw: string): string {
  return raw.replace(/[\s-]/g, "");
}

export function isValidSACell(raw: string): boolean {
  return /^(\+?27|0)[6-8]\d{8}$/.test(normaliseCell(raw));
}

// SA ID number is 13 digits (Luhn not enforced here — light validation only).
export function isValidSAIdNumber(raw: string): boolean {
  return /^\d{13}$/.test(raw.replace(/\s/g, ""));
}
