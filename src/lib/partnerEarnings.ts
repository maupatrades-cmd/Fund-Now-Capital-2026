// C3 Partner Earnings — owner-only reconciliation view over the C2 money-truth
// tables (commission_records + bonus_records). SPEC S8 / S7C.
//
// This is a PURE READ surface. All lifecycle math + belt-and-braces live in the
// C2 write-path RPCs and triggers; nothing here mutates. The two source tables
// share the commission_state enum but diverge on column names —
// commission_records.status vs bonus_records.state, partner_share vs
// bonus_amount — so we normalise both into one EarningRow shape here and let the
// page treat them uniformly (Decision A: one table, a "Bonus" chip on bonus rows).
//
// OWNER VIEW: funder REAL names are shown (funders.name), no anonymisation — the
// S7C 50/50 Doctor-facing presentation policy applies only to partner-facing
// surfaces (Phase D5), never to this owner reconciliation screen.
import { startOfMonth } from "@/lib/format";

// ---- state -----------------------------------------------------------------
export type EarningState = "earned" | "outstanding" | "payable" | "settled" | "void";
export type LiveEarningState = Exclude<EarningState, "void">;
export type EarningKind = "commission" | "bonus";

// The four live states in lifecycle order (void is terminal, handled separately).
export const LIVE_EARNING_STATES: LiveEarningState[] = [
  "earned",
  "outstanding",
  "payable",
  "settled",
];

// All five in a stable order for the filter multi-select.
export const EARNING_STATES: EarningState[] = [
  "earned",
  "outstanding",
  "payable",
  "settled",
  "void",
];

// Chip styling + labels. The progression reads earned (neutral) → outstanding
// (in motion, teal) → payable (action needed, amber) → settled (done, green).
// "Payable" is the owner's cue that this earning is ready to pay the partner.
export const EARNING_STATE_META: Record<
  EarningState,
  { label: string; badge: string; help: string }
> = {
  earned: {
    label: "Earned",
    badge: "bg-slate-100 text-slate-600 ring-slate-500/20",
    help: "Deal funded — commission computed, not yet on a funder invoice.",
  },
  outstanding: {
    label: "Outstanding",
    badge: "bg-brand-teal/10 text-brand-teal ring-brand-teal/30",
    help: "On an issued funder invoice — awaiting the funder's payment.",
  },
  payable: {
    label: "Payable",
    badge: "bg-amber-100 text-amber-700 ring-amber-500/30",
    help: "Funder has paid — this earning is ready to pay the partner.",
  },
  settled: {
    label: "Settled",
    badge: "bg-brand-green/15 text-brand-green ring-brand-green/30",
    help: "Paid out to the partner (via a partner invoice — Phase C4).",
  },
  void: {
    label: "Void",
    badge: "bg-slate-100 text-slate-400 ring-slate-400/20 line-through",
    help: "Reversed — excluded from all totals.",
  },
};

export function earningStateLabel(state: EarningState): string {
  return EARNING_STATE_META[state]?.label ?? state;
}

// ---- number coercion (PostgREST returns numeric as string) -----------------
export function toNum(value: string | number | null | undefined): number {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

// ---- normalised row --------------------------------------------------------
// Owner-side commission breakdown, shown in the drill-down only (the table's
// headline money column is the partner's share). Undefined for bonus rows.
export interface CommissionBreakdown {
  gross: number;
  companyRetention: number;
  partnerPool: number;
  partnerShare: number;
  ownerShare: number;
  tierPct: number;
  isPurchaseOrder: boolean;
}

export interface EarningRow {
  id: string;
  kind: EarningKind;
  partnerId: string | null;
  partnerName: string | null;
  dealId: string;
  dealReference: string | null;
  clientId: string | null;
  clientName: string | null;
  funderId: string | null;
  funderName: string | null; // REAL name — owner view
  // Headline amount: partner_share (commission) or bonus_amount (bonus).
  amount: number;
  state: EarningState;
  earnedAt: string | null;
  outstandingAt: string | null;
  payableAt: string | null;
  settledAt: string | null;
  // bonus_reason (bonus) or notes (commission) — context in the drill-down.
  reason: string | null;
  breakdown?: CommissionBreakdown;
  createdAt: string;
}

// ---- raw PostgREST shapes (embeds are !left → each may be null) -------------
type RawEmbed = {
  deal: {
    id: string;
    reference: string | null;
    client: { id: string; business_name: string } | null;
  } | null;
  submission: {
    id: string;
    funder: { id: string; name: string; short_code: string | null } | null;
  } | null;
  partner: { id: string; name: string } | null;
};

export type RawCommissionRow = RawEmbed & {
  id: string;
  deal_id: string;
  referral_partner_id: string | null;
  gross_commission: string | number;
  company_retention: string | number;
  partner_pool: string | number;
  partner_share: string | number;
  owner_share: string | number;
  tier_pct: string | number;
  is_purchase_order: boolean;
  status: EarningState;
  earned_at: string | null;
  outstanding_at: string | null;
  payable_at: string | null;
  settled_at: string | null;
  notes: string | null;
  created_at: string;
};

export type RawBonusRow = RawEmbed & {
  id: string;
  deal_id: string;
  referral_partner_id: string | null;
  bonus_amount: string | number;
  bonus_reason: string | null;
  state: EarningState;
  earned_at: string | null;
  outstanding_at: string | null;
  payable_at: string | null;
  settled_at: string | null;
  notes: string | null;
  created_at: string;
};

function mapEmbed(raw: RawEmbed) {
  return {
    dealReference: raw.deal?.reference ?? null,
    clientId: raw.deal?.client?.id ?? null,
    clientName: raw.deal?.client?.business_name ?? null,
    funderId: raw.submission?.funder?.id ?? null,
    funderName: raw.submission?.funder?.name ?? null,
    partnerName: raw.partner?.name ?? null,
  };
}

export function normaliseCommission(raw: RawCommissionRow): EarningRow {
  return {
    id: raw.id,
    kind: "commission",
    partnerId: raw.referral_partner_id,
    dealId: raw.deal_id,
    amount: toNum(raw.partner_share),
    state: raw.status,
    earnedAt: raw.earned_at,
    outstandingAt: raw.outstanding_at,
    payableAt: raw.payable_at,
    settledAt: raw.settled_at,
    reason: raw.notes,
    createdAt: raw.created_at,
    breakdown: {
      gross: toNum(raw.gross_commission),
      companyRetention: toNum(raw.company_retention),
      partnerPool: toNum(raw.partner_pool),
      partnerShare: toNum(raw.partner_share),
      ownerShare: toNum(raw.owner_share),
      tierPct: toNum(raw.tier_pct),
      isPurchaseOrder: raw.is_purchase_order,
    },
    ...mapEmbed(raw),
  };
}

export function normaliseBonus(raw: RawBonusRow): EarningRow {
  return {
    id: raw.id,
    kind: "bonus",
    partnerId: raw.referral_partner_id,
    dealId: raw.deal_id,
    amount: toNum(raw.bonus_amount),
    state: raw.state,
    earnedAt: raw.earned_at,
    outstandingAt: raw.outstanding_at,
    payableAt: raw.payable_at,
    settledAt: raw.settled_at,
    reason: raw.bonus_reason,
    createdAt: raw.created_at,
    ...mapEmbed(raw),
  };
}

// ---- date helpers ----------------------------------------------------------
// The lifecycle timestamps are timestamptz; the filter inputs are 'YYYY-MM-DD'.
// Compare by calendar day so a timezone never shifts an earning across a bound.
export function dayOf(iso: string | null | undefined): string | null {
  return iso ? iso.slice(0, 10) : null;
}

export function firstOfMonthISO(now = new Date()): string {
  const s = startOfMonth(now);
  return `${s.getFullYear()}-${String(s.getMonth() + 1).padStart(2, "0")}-01`;
}

export function firstOfYearISO(now = new Date()): string {
  return `${now.getFullYear()}-01-01`;
}

export function todayISO(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate(),
  ).padStart(2, "0")}`;
}

// Whole days a timestamp is in the past (0 for the future / missing).
export function daysInState(iso: string | null | undefined, now = new Date()): number {
  const day = dayOf(iso);
  if (!day) return 0;
  const [y, m, d] = day.split("-").map(Number);
  if (!y || !m || !d) return 0;
  const then = new Date(y, m - 1, d).getTime();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.max(0, Math.floor((today - then) / 86_400_000));
}

// The timestamp a row entered its current live state — drives aging.
export function stateEnteredAt(row: EarningRow): string | null {
  switch (row.state) {
    case "earned":
      return row.earnedAt;
    case "outstanding":
      return row.outstandingAt;
    case "payable":
      return row.payableAt;
    case "settled":
      return row.settledAt;
    default:
      return null;
  }
}

// ---- KPI / aging buckets (current-state snapshot) --------------------------
// Merges the KPI tiles (#1) and the aging report (#4): per live state, how many
// earnings are sitting in it right now, their total Rand value, and the age of
// the oldest one. Void is always excluded — it is not a live earning. NOT
// date-windowed: "what is the backlog right now" is inherently a current
// question; the date-range control filters the TABLE, not these tiles.
export interface StateBucket {
  state: LiveEarningState;
  count: number;
  total: number;
  oldestDays: number; // 0 when the bucket is empty
}

export function computeStateBuckets(
  rows: EarningRow[],
  now = new Date(),
): Record<LiveEarningState, StateBucket> {
  const buckets = Object.fromEntries(
    LIVE_EARNING_STATES.map((s) => [s, { state: s, count: 0, total: 0, oldestDays: 0 }]),
  ) as Record<LiveEarningState, StateBucket>;

  for (const row of rows) {
    if (row.state === "void") continue;
    const b = buckets[row.state];
    b.count += 1;
    b.total += row.amount;
    const age = daysInState(stateEnteredAt(row), now);
    if (age > b.oldestDays) b.oldestDays = age;
  }
  return buckets;
}

// ---- per-partner totals card (#5) ------------------------------------------
// Mixed windows exactly as specced: Earned this month, Outstanding + Payable
// current, Settled year-to-date. Rows are the already partner-filtered set.
export interface PartnerTotals {
  earnedMtd: number;
  outstanding: number;
  payable: number;
  settledYtd: number;
}

export function computePartnerTotals(rows: EarningRow[], now = new Date()): PartnerTotals {
  const monthStart = firstOfMonthISO(now);
  const yearStart = firstOfYearISO(now);
  const totals: PartnerTotals = { earnedMtd: 0, outstanding: 0, payable: 0, settledYtd: 0 };
  for (const row of rows) {
    if (row.state === "void") continue;
    if (row.state === "outstanding") totals.outstanding += row.amount;
    if (row.state === "payable") totals.payable += row.amount;
    // Earned-this-month is windowed on earned_at (when the earning first arose),
    // independent of its current state — a now-settled earning still "earned"
    // this month if that is when it was computed.
    const earnedDay = dayOf(row.earnedAt);
    if (earnedDay && earnedDay >= monthStart) totals.earnedMtd += row.amount;
    // Settled YTD is windowed on settled_at within the calendar year.
    const settledDay = dayOf(row.settledAt);
    if (row.state === "settled" && settledDay && settledDay >= yearStart) {
      totals.settledYtd += row.amount;
    }
  }
  return totals;
}

// ---- table filtering -------------------------------------------------------
export interface EarningFilters {
  partnerId: string; // "" = all
  states: Set<EarningState>; // empty = all (subject to showVoid)
  from: string; // "" = unbounded (YYYY-MM-DD)
  to: string; // "" = unbounded
  search: string; // matches DEAL reference OR client name
  showVoid: boolean;
}

// A row is in the date window if ANY of its lifecycle timestamps falls in range
// (per the C3 brief: "date range on earned_at OR any state timestamp").
function rowInWindow(row: EarningRow, from: string, to: string): boolean {
  if (!from && !to) return true;
  const days = [row.earnedAt, row.outstandingAt, row.payableAt, row.settledAt]
    .map(dayOf)
    .filter((d): d is string => d !== null);
  if (days.length === 0) return !from; // undated row only passes an open-start window
  return days.some((d) => (!from || d >= from) && (!to || d <= to));
}

export function filterEarnings(rows: EarningRow[], f: EarningFilters): EarningRow[] {
  const q = f.search.trim().toLowerCase();
  return rows.filter((row) => {
    // Void is hidden unless explicitly shown (Decision D), and even then only
    // when the state filter permits it.
    if (row.state === "void" && !f.showVoid) return false;
    if (f.states.size > 0 && !f.states.has(row.state)) return false;
    if (f.partnerId && row.partnerId !== f.partnerId) return false;
    if (!rowInWindow(row, f.from, f.to)) return false;
    if (q) {
      const hay = `${row.dealReference ?? ""} ${row.clientName ?? ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}
