// Stakeholder enums, option lists, badges, and validators (B6 / SPEC S3a).
// Kept framework-free so the form, the summary card, and any list filter share
// one source. Row/query types live in src/hooks/useStakeholders.ts.

export type StakeholderRole = "director" | "shareholder" | "surety" | "key_person" | "signatory";
export type StakeholderIdType = "sa_id" | "passport";

// Display + plural labels, in the order roles should render.
export const STAKEHOLDER_ROLES: { value: StakeholderRole; label: string; plural: string }[] = [
  { value: "director", label: "Director", plural: "directors" },
  { value: "shareholder", label: "Shareholder", plural: "shareholders" },
  { value: "surety", label: "Surety", plural: "sureties" },
  { value: "key_person", label: "Key person", plural: "key persons" },
  { value: "signatory", label: "Signatory", plural: "signatories" },
];

export const ID_TYPES: { value: StakeholderIdType; label: string }[] = [
  { value: "sa_id", label: "SA ID" },
  { value: "passport", label: "Passport" },
];

// Per-role pill colours (Badge className), mirroring QUALIFICATION_BADGE.
export const STAKEHOLDER_ROLE_BADGE: Record<StakeholderRole, string> = {
  director: "bg-brand-teal/10 text-brand-teal ring-brand-teal/20",
  shareholder: "bg-green-50 text-green-700 ring-green-600/20",
  surety: "bg-amber-50 text-amber-700 ring-amber-600/20",
  key_person: "bg-slate-100 text-slate-600 ring-slate-500/20",
  signatory: "bg-indigo-50 text-indigo-700 ring-indigo-600/20",
};

export const ROLE_LABEL: Record<StakeholderRole, string> = Object.fromEntries(
  STAKEHOLDER_ROLES.map((r) => [r.value, r.label]),
) as Record<StakeholderRole, string>;

// FICA: a person holding >= this % is suggested as a beneficial owner (owner can
// override — the DB stores the owner's final value). Decision 4.
export const BENEFICIAL_OWNER_THRESHOLD = 25;

// Passport: free-text 6-12 alphanumeric (SPEC S3a). Not Luhn-checked.
export function isValidPassportNumber(raw: string): boolean {
  return /^[A-Za-z0-9]{6,12}$/.test(raw.replace(/[\s-]/g, ""));
}

// "3 directors · 2 shareholders · 1 surety" — a person with multiple roles counts
// under each. Only non-zero roles appear, in STAKEHOLDER_ROLES order.
export function summarizeRoles(rows: readonly { roles: StakeholderRole[] }[]): string {
  const counts = new Map<StakeholderRole, number>();
  for (const row of rows) {
    for (const role of row.roles ?? []) counts.set(role, (counts.get(role) ?? 0) + 1);
  }
  const parts = STAKEHOLDER_ROLES.filter((r) => (counts.get(r.value) ?? 0) > 0).map((r) => {
    const n = counts.get(r.value)!;
    return `${n} ${n === 1 ? r.label.toLowerCase() : r.plural}`;
  });
  return parts.join(" · ");
}

// Sum of shareholding across a client's stakeholders (nulls ignored). Used for the
// over-100% warning / unallocated note (decision 2 — advisory, never blocks).
export function shareholdingSum(rows: readonly { shareholding_percent: number | null }[]): number {
  return rows.reduce((sum, r) => sum + (r.shareholding_percent ?? 0), 0);
}
