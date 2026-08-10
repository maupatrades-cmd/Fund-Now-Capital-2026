// Build 11 — Unified payout reconciliation. Owner-only read surface that answers
// "who is owed what, and where is it in the payout pipeline" for BOTH referral
// partners and FNC contractors, in one view.
//
// This is a PURE READ. The money truth lives in commission_records (owner-full
// RLS) + the two invoice tables. We bucket each commission by payee type and
// lifecycle state, and layer the invoice-state amounts (awaiting approval /
// awaiting payment / rejected) from partner_invoices + contractor_invoices.
//
// OWNER VIEW: real names + amounts (S7C's partner-facing 50/50 masking applies
// only to partner/contractor surfaces, never to this owner reconciliation).
//
// NOTE: "overdue" is intentionally NOT computed here — invoice due dates land in
// Build 12; until then the page shows the states it can compute truthfully.

export type PayeeType = "partner" | "contractor";

// PostgREST numeric → number coercion (numeric columns arrive as strings).
export function toNum(value: string | number | null | undefined): number {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

// One commission_records row reduced to what reconciliation needs. Numeric
// columns arrive as strings from PostgREST.
export type RawReconCommission = {
  id: string;
  status: "earned" | "outstanding" | "payable" | "settled" | "void";
  attribution_type: string | null;
  referral_partner_id: string | null;
  contractor_id: string | null;
  partner_share: string | number | null;
  contractor_share: string | number | null;
  partner: { id: string; name: string | null } | null;
  contractor: { id: string; full_name: string | null } | null;
};

// A minimal invoice shape shared by both invoice tables for state aggregation.
export type ReconInvoice = {
  state: "draft" | "submitted" | "approved" | "paid" | "rejected";
  total_amount: string | number;
  payeeId: string;
  payeeName: string | null;
};

// Per-payee reconciliation row.
export type PayoutRow = {
  payeeType: PayeeType;
  payeeId: string;
  payeeName: string;
  payable: number; // commission ready to pay, not yet settled
  settled: number; // commission already paid out
  awaitingApproval: number; // on a submitted invoice
  awaitingPayment: number; // on an approved invoice
  rejectedCount: number; // invoices rejected (needs re-invoicing)
};

// Section (partner / contractor) totals across its payees.
export type PayoutTotals = {
  payable: number;
  settled: number;
  awaitingApproval: number;
  awaitingPayment: number;
  rejectedCount: number;
};

// Resolve which payee a commission belongs to, and the amount that payee sees.
// A contractor tier row carries attribution_type 'FNC_Contractor' + contractor_id;
// everything else attributed to a referral partner is a partner row. Owner-only
// (unattributed) rows have neither and are excluded from payout reconciliation.
function payeeOf(
  c: RawReconCommission,
): { type: PayeeType; id: string; name: string; amount: number } | null {
  if (c.attribution_type === "FNC_Contractor" && c.contractor_id) {
    return {
      type: "contractor",
      id: c.contractor_id,
      name: c.contractor?.full_name?.trim() || "Contractor",
      amount: toNum(c.contractor_share),
    };
  }
  if (c.referral_partner_id) {
    return {
      type: "partner",
      id: c.referral_partner_id,
      name: c.partner?.name?.trim() || "Partner",
      amount: toNum(c.partner_share),
    };
  }
  return null;
}

function emptyRow(type: PayeeType, id: string, name: string): PayoutRow {
  return {
    payeeType: type,
    payeeId: id,
    payeeName: name,
    payable: 0,
    settled: 0,
    awaitingApproval: 0,
    awaitingPayment: 0,
    rejectedCount: 0,
  };
}

// Build the per-payee reconciliation rows for one payee type from the commission
// ledger + that type's invoices. Void commissions are excluded from all totals.
export function buildPayoutRows(
  type: PayeeType,
  commissions: RawReconCommission[],
  invoices: ReconInvoice[],
): PayoutRow[] {
  const byId = new Map<string, PayoutRow>();
  const ensure = (id: string, name: string) => {
    let row = byId.get(id);
    if (!row) {
      row = emptyRow(type, id, name);
      byId.set(id, row);
    } else if (row.payeeName === "Partner" || row.payeeName === "Contractor") {
      // Prefer a real name if a later row carries one.
      if (name && name !== "Partner" && name !== "Contractor") row.payeeName = name;
    }
    return row;
  };

  for (const c of commissions) {
    if (c.status === "void") continue;
    const p = payeeOf(c);
    if (!p || p.type !== type) continue;
    const row = ensure(p.id, p.name);
    if (c.status === "payable") row.payable += p.amount;
    else if (c.status === "settled") row.settled += p.amount;
  }

  for (const inv of invoices) {
    const row = ensure(inv.payeeId, inv.payeeName?.trim() || (type === "partner" ? "Partner" : "Contractor"));
    const amount = toNum(inv.total_amount);
    if (inv.state === "submitted") row.awaitingApproval += amount;
    else if (inv.state === "approved") row.awaitingPayment += amount;
    else if (inv.state === "rejected") row.rejectedCount += 1;
  }

  return [...byId.values()].sort((a, b) => b.payable + b.awaitingPayment - (a.payable + a.awaitingPayment));
}

export function sumTotals(rows: PayoutRow[]): PayoutTotals {
  return rows.reduce<PayoutTotals>(
    (acc, r) => ({
      payable: acc.payable + r.payable,
      settled: acc.settled + r.settled,
      awaitingApproval: acc.awaitingApproval + r.awaitingApproval,
      awaitingPayment: acc.awaitingPayment + r.awaitingPayment,
      rejectedCount: acc.rejectedCount + r.rejectedCount,
    }),
    { payable: 0, settled: 0, awaitingApproval: 0, awaitingPayment: 0, rejectedCount: 0 },
  );
}
