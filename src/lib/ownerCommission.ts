export type CommissionKind = "agent" | "team_leader" | "organisation" | "external_payee";
export type ManualCommissionEntry = {
  id: string; deal_id: string; beneficiary_kind: CommissionKind;
  beneficiary_profile_id: string | null; beneficiary_organisation_id: string | null;
  beneficiary_name: string | null; currency: string; amount: string | number;
  basis: string | null; percentage: string | number | null;
  status: "draft" | "approved" | "paid" | "void"; reason: string | null;
};
export type CommissionAdjustment = { id: number; entry_id: string; delta: string | number; reason: string; created_at: string };
export type CommissionFlag = { id: string; entry_id: string; flag_kind: string; note: string; status: "open" | "acknowledged"; resolution: string | null };
export type CommissionReconciliation = {
  stated_total: string | number | null; currency: string | null;
  entered_effective_sum: string | number; difference: string | number | null;
  reconciled: boolean; open_flags: number;
};
export type CommissionPerson = { id: string; full_name: string | null; email: string | null; role: string; is_active: boolean };
export type CommissionOrganisation = { id: string; name: string; is_active: boolean };

export class UnconfirmedCommissionChange extends Error {
  constructor() { super("The result could not be confirmed. Refresh and check the allocations and adjustment history before trying again."); }
}

export async function collectCommissionRows<T>(page: (start: number, end: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>): Promise<T[]> {
  const result: T[] = [];
  for (;;) {
    const response = await page(result.length, result.length + 499);
    if (response.error) throw new Error(response.error.message);
    const rows = (response.data ?? []) as T[];
    // A server can cap results below our requested page size. Only an empty
    // next page proves completion; advance by the number actually returned.
    if (rows.length === 0) return result;
    result.push(...rows);
  }
}

// Preserve decimal strings on the way to Postgres. Never round an Owner's
// entered amount or use floating-point arithmetic to reconcile allocations.
export function commissionAmount(value: string | number, signed = false): string {
  const raw = String(value).trim();
  if (!(signed ? /^-?\d{1,12}(?:\.\d{1,2})?$/ : /^\d{1,12}(?:\.\d{1,2})?$/).test(raw)) {
    throw new Error("Enter an amount with up to 12 digits and two decimal places.");
  }
  const negative = raw.startsWith("-");
  const [whole, fraction = ""] = (negative ? raw.slice(1) : raw).split(".");
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  return `${negative && cents !== 0n ? "-" : ""}${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;
}

export function effectiveCommission(entry: ManualCommissionEntry, adjustments: CommissionAdjustment[]): string {
  const cents = (amount: string | number) => BigInt(commissionAmount(amount, true).replace(".", ""));
  const total = adjustments.filter((item) => item.entry_id === entry.id)
    .reduce((sum, item) => sum + cents(item.delta), cents(entry.amount));
  const absolute = total < 0n ? -total : total;
  return `${total < 0n ? "-" : ""}${absolute / 100n}.${String(absolute % 100n).padStart(2, "0")}`;
}

export function canApproveCommission(reconciliation: CommissionReconciliation, entries: ManualCommissionEntry[]): boolean {
  return reconciliation.reconciled === true && reconciliation.open_flags === 0 && entries.some((entry) => entry.status === "draft");
}

export function commissionPercentage(value: string): string | null {
  const raw = value.trim();
  if (!raw) return null;
  if (!/^\d{1,3}(?:\.\d{1,4})?$/.test(raw) || Number(raw) > 100) {
    throw new Error("Enter a percentage from 0 to 100, with up to four decimal places.");
  }
  return raw;
}
