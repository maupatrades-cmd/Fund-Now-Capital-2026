// Reports v1 — owner-only analytics (Sprint 4 Lane 4c).
//
// PURE READ + PURE COMPUTE surface. This module holds the types, the date-range
// presets, the client-side aggregation, and a POPIA-safe CSV exporter for the
// /reports dashboard. Nothing here mutates; every number is derived from the
// live money-truth tables (commission_records + bonus_records), leads, and the
// people tables (referral_partners + contractor profiles).
//
// WHY client-side aggregation (no helper RPCs): owner data volume is tiny
// (≤ a few hundred rows for the foreseeable future) and the whole dashboard is
// served by ~4 read queries — far under the "20+ queries" bar that would make a
// Postgres aggregate cheaper. Keeping it client-side keeps this lane fully
// read-only, with no migration and no grant-matrix surface to maintain. If
// volume ever grows, the aggregation functions below map 1:1 onto SECURITY
// DEFINER helper RPCs (get_report_* per the lane brief) without changing the UI.
//
// OWNER VIEW: funder + partner REAL names are shown (no anonymisation). The S7C
// 50/50 Doctor-facing presentation policy governs partner-facing surfaces only
// (Phase D) — never this owner reconciliation/analytics screen.

// ---- number coercion (PostgREST returns numeric as string) -----------------
export function toNum(value: string | number | null | undefined): number {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

// ---- date range + presets --------------------------------------------------
// Ranges are inclusive calendar-day bounds as 'YYYY-MM-DD'. Empty string = the
// bound is open. Dates are date-only (no time), so comparing the day slice of a
// timestamp never shifts a row across a bound regardless of timezone.
export interface DateRange {
  from: string;
  to: string;
}

export type PresetKey =
  | "today"
  | "last7"
  | "last30"
  | "thisMonth"
  | "lastMonth"
  | "ytd"
  | "custom";

export const PRESETS: { key: PresetKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "last7", label: "Last 7 days" },
  { key: "last30", label: "Last 30 days" },
  { key: "thisMonth", label: "This month" },
  { key: "lastMonth", label: "Last month" },
  { key: "ytd", label: "Year to date" },
  { key: "custom", label: "Custom" },
];

function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

// Resolve a preset to a concrete inclusive range. "custom" returns the range
// unchanged (the caller owns the two date inputs). Default preset is last30.
export function presetRange(preset: PresetKey, now = new Date()): DateRange {
  const today = isoDay(now);
  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "last7": {
      const d = new Date(now);
      d.setDate(d.getDate() - 6); // inclusive of today → 7 calendar days
      return { from: isoDay(d), to: today };
    }
    case "last30": {
      const d = new Date(now);
      d.setDate(d.getDate() - 29);
      return { from: isoDay(d), to: today };
    }
    case "thisMonth":
      return { from: isoDay(new Date(now.getFullYear(), now.getMonth(), 1)), to: today };
    case "lastMonth": {
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const last = new Date(now.getFullYear(), now.getMonth(), 0); // day 0 = last of prev month
      return { from: isoDay(first), to: isoDay(last) };
    }
    case "ytd":
      return { from: `${now.getFullYear()}-01-01`, to: today };
    default:
      return { from: "", to: "" };
  }
}

// Day slice of a timestamptz ('2026-08-03T…' → '2026-08-03'); null-safe.
export function dayOf(iso: string | null | undefined): string | null {
  return iso ? iso.slice(0, 10) : null;
}

// Inclusive day-in-range test. An empty bound is open on that side.
export function dayInRange(day: string | null, range: DateRange): boolean {
  if (!day) return false;
  if (range.from && day < range.from) return false;
  if (range.to && day > range.to) return false;
  return true;
}

// ---- normalised rows (raw PostgREST → flat shapes) -------------------------
// Embeds are !left per the nullable-FK rule, so any link may be null.

// The commission ledger row is the money-truth: it exists only once a deal is
// genuinely funded (Funded + amount_funded). We window money metrics on its
// earned_at (falling back to created_at for a not-yet-stamped row), and always
// exclude void from every total.
export interface CommissionReportRow {
  id: string;
  dealId: string;
  dealReference: string | null;
  clientName: string | null;
  funderId: string | null;
  funderName: string | null; // REAL name — owner view
  partnerId: string | null; // referral_partners.id
  partnerName: string | null;
  contractorId: string | null; // leads.attributed_to_contractor_id
  grossCommission: number; // FNC's gross commission (X)
  partnerShare: number;
  amountFunded: number | null; // facility advanced (from the submission)
  state: string;
  windowDay: string | null; // earned_at ?? created_at, day slice
}

export interface LeadReportRow {
  id: string;
  referralPartnerId: string | null;
  attributedContractorId: string | null;
  createdDay: string | null;
}

// A discretionary owner bonus paid to a partner (C2.4). It rides the same
// funder-invoice lifecycle as a commission (shares the commission_state enum via
// its own `state` column) and is partner-attributed, so it is partner EARNINGS —
// folded into the partner leaderboard's totals alongside the commission share.
export interface BonusReportRow {
  id: string;
  dealId: string;
  partnerId: string | null; // referral_partners.id
  bonusAmount: number;
  state: string;
  windowDay: string | null; // earned_at ?? created_at, day slice
}

export interface PersonRow {
  id: string;
  name: string;
}

// ---- raw shapes ------------------------------------------------------------
type RawCommission = {
  id: string;
  deal_id: string;
  referral_partner_id: string | null;
  gross_commission: string | number | null;
  partner_share: string | number | null;
  status: string;
  earned_at: string | null;
  created_at: string;
  deal: {
    reference: string | null;
    client: { business_name: string } | null;
    lead: { attributed_to_contractor_id: string | null } | null;
  } | null;
  submission: {
    amount_funded: string | number | null;
    funder: { id: string; name: string } | null;
  } | null;
  partner: { id: string; name: string } | null;
};

type RawLead = {
  id: string;
  referral_partner_id: string | null;
  attributed_to_contractor_id: string | null;
  created_at: string;
};

type RawBonus = {
  id: string;
  deal_id: string;
  referral_partner_id: string | null;
  bonus_amount: string | number | null;
  state: string;
  earned_at: string | null;
  created_at: string;
};

export function normaliseCommission(raw: RawCommission): CommissionReportRow {
  return {
    id: raw.id,
    dealId: raw.deal_id,
    dealReference: raw.deal?.reference ?? null,
    clientName: raw.deal?.client?.business_name ?? null,
    funderId: raw.submission?.funder?.id ?? null,
    funderName: raw.submission?.funder?.name ?? null,
    partnerId: raw.referral_partner_id,
    partnerName: raw.partner?.name ?? null,
    contractorId: raw.deal?.lead?.attributed_to_contractor_id ?? null,
    grossCommission: toNum(raw.gross_commission),
    partnerShare: toNum(raw.partner_share),
    amountFunded: raw.submission?.amount_funded == null ? null : toNum(raw.submission.amount_funded),
    state: raw.status,
    windowDay: dayOf(raw.earned_at ?? raw.created_at),
  };
}

export function normaliseLead(raw: RawLead): LeadReportRow {
  return {
    id: raw.id,
    referralPartnerId: raw.referral_partner_id,
    attributedContractorId: raw.attributed_to_contractor_id,
    createdDay: dayOf(raw.created_at),
  };
}

export function normaliseBonus(raw: RawBonus): BonusReportRow {
  return {
    id: raw.id,
    dealId: raw.deal_id,
    partnerId: raw.referral_partner_id,
    bonusAmount: toNum(raw.bonus_amount),
    state: raw.state,
    windowDay: dayOf(raw.earned_at ?? raw.created_at),
  };
}

// A commission or bonus row counts toward money totals when it is not void.
function isLive(r: { state: string }): boolean {
  return r.state !== "void";
}

// ---- KPI cards -------------------------------------------------------------
export interface ReportKpis {
  totalCommission: number; // Σ gross_commission (FNC revenue) in range
  dealsFunded: number; // distinct funded deals in range
  activeContractors: number; // contractors with a lead submitted OR a funded deal in range
  activePartners: number; // partners with a lead submitted OR a funded deal in range
}

export function computeKpis(
  commissions: CommissionReportRow[],
  leads: LeadReportRow[],
  bonuses: BonusReportRow[],
  range: DateRange,
): ReportKpis {
  const live = commissions.filter((r) => isLive(r) && dayInRange(r.windowDay, range));
  const leadsIn = leads.filter((l) => dayInRange(l.createdDay, range));
  const bonusesIn = bonuses.filter((b) => isLive(b) && dayInRange(b.windowDay, range));

  const dealIds = new Set(live.map((r) => r.dealId));

  const activeContractors = new Set<string>();
  const activePartners = new Set<string>();
  for (const l of leadsIn) {
    if (l.attributedContractorId) activeContractors.add(l.attributedContractorId);
    if (l.referralPartnerId) activePartners.add(l.referralPartnerId);
  }
  for (const r of live) {
    if (r.contractorId) activeContractors.add(r.contractorId);
    if (r.partnerId) activePartners.add(r.partnerId);
  }
  // A partner who earned a bonus in-range is active even if their commission
  // row falls outside the window (bonuses have no contractor attribution).
  for (const b of bonusesIn) {
    if (b.partnerId) activePartners.add(b.partnerId);
  }

  return {
    totalCommission: live.reduce((s, r) => s + r.grossCommission, 0),
    dealsFunded: dealIds.size,
    activeContractors: activeContractors.size,
    activePartners: activePartners.size,
  };
}

// ---- funder performance ----------------------------------------------------
export interface FunderPerfRow {
  funderId: string;
  funderName: string;
  totalGross: number;
  dealsFunded: number;
  avgDealSize: number | null; // Σ amount_funded / deals with a captured amount
  pctOfTotal: number; // 0–100
}

export function computeFunderPerformance(
  commissions: CommissionReportRow[],
  range: DateRange,
): FunderPerfRow[] {
  const live = commissions.filter((r) => isLive(r) && dayInRange(r.windowDay, range));
  const grandTotal = live.reduce((s, r) => s + r.grossCommission, 0);

  type Acc = {
    funderId: string;
    funderName: string;
    totalGross: number;
    deals: Set<string>;
    fundedSum: number;
    fundedCount: number;
  };
  const map = new Map<string, Acc>();
  for (const r of live) {
    const key = r.funderId ?? "unknown";
    let acc = map.get(key);
    if (!acc) {
      acc = {
        funderId: key,
        funderName: r.funderName ?? "Unknown funder",
        totalGross: 0,
        deals: new Set(),
        fundedSum: 0,
        fundedCount: 0,
      };
      map.set(key, acc);
    }
    acc.totalGross += r.grossCommission;
    acc.deals.add(r.dealId);
    if (r.amountFunded != null) {
      acc.fundedSum += r.amountFunded;
      acc.fundedCount += 1;
    }
  }

  return [...map.values()]
    .map((a) => ({
      funderId: a.funderId,
      funderName: a.funderName,
      totalGross: a.totalGross,
      dealsFunded: a.deals.size,
      avgDealSize: a.fundedCount > 0 ? a.fundedSum / a.fundedCount : null,
      pctOfTotal: grandTotal > 0 ? (a.totalGross / grandTotal) * 100 : 0,
    }))
    .sort((a, b) => b.totalGross - a.totalGross);
}

// ---- contractor performance ------------------------------------------------
// Provisional display tier. This is NOT the authoritative contractor levels
// system (that arrives with the contractor-milestones module in a later lane);
// it is a transparent bracket over FNC gross generated so the leaderboard has a
// level column today. Kept here (one place) so it is trivial to retire.
export function contractorLevel(fncGross: number): string {
  if (fncGross >= 1_000_000) return "Level 4";
  if (fncGross >= 250_000) return "Level 3";
  if (fncGross >= 50_000) return "Level 2";
  return "Level 1";
}

export interface ContractorPerfRow {
  contractorId: string;
  name: string;
  leadsSubmitted: number;
  dealsFunded: number;
  fncGross: number;
  level: string;
}

export function computeContractorPerformance(
  contractors: PersonRow[],
  commissions: CommissionReportRow[],
  leads: LeadReportRow[],
  range: DateRange,
): ContractorPerfRow[] {
  const live = commissions.filter((r) => isLive(r) && dayInRange(r.windowDay, range));
  const leadsIn = leads.filter((l) => dayInRange(l.createdDay, range));

  const rows = contractors.map((c) => {
    const theirCommissions = live.filter((r) => r.contractorId === c.id);
    const dealIds = new Set(theirCommissions.map((r) => r.dealId));
    const fncGross = theirCommissions.reduce((s, r) => s + r.grossCommission, 0);
    const leadsSubmitted = leadsIn.filter((l) => l.attributedContractorId === c.id).length;
    return {
      contractorId: c.id,
      name: c.name,
      leadsSubmitted,
      dealsFunded: dealIds.size,
      fncGross,
      level: contractorLevel(fncGross),
    };
  });

  // Leaderboard: only contractors with activity in the window, best first.
  return rows
    .filter((r) => r.leadsSubmitted > 0 || r.dealsFunded > 0 || r.fncGross > 0)
    .sort((a, b) => b.fncGross - a.fncGross || b.leadsSubmitted - a.leadsSubmitted);
}

// ---- partner performance ---------------------------------------------------
// Partner EARNINGS fold in both sources: the commission `partner_share` and any
// discretionary `bonus_amount`. They are kept as separate columns for owner
// transparency (which portion is commission vs bonus) plus a Total Earned
// headline. `dealsFunded` is the distinct set of deals across BOTH sources — a
// bonus rides an already-funded deal, so in practice its deal is already in the
// commission set, but the union keeps a bonus-only deal from being missed.
export interface PartnerPerfRow {
  partnerId: string;
  name: string; // REAL name — owner view
  leadsSubmitted: number;
  dealsFunded: number;
  partnerShare: number; // commission partner_share
  bonusEarned: number; // Σ bonus_amount
  totalEarned: number; // partnerShare + bonusEarned
}

export function computePartnerPerformance(
  partners: PersonRow[],
  commissions: CommissionReportRow[],
  leads: LeadReportRow[],
  bonuses: BonusReportRow[],
  range: DateRange,
): PartnerPerfRow[] {
  const live = commissions.filter((r) => isLive(r) && dayInRange(r.windowDay, range));
  const liveBonuses = bonuses.filter((b) => isLive(b) && dayInRange(b.windowDay, range));
  const leadsIn = leads.filter((l) => dayInRange(l.createdDay, range));

  const rows = partners.map((p) => {
    const theirCommissions = live.filter((r) => r.partnerId === p.id);
    const theirBonuses = liveBonuses.filter((b) => b.partnerId === p.id);
    const dealIds = new Set<string>([
      ...theirCommissions.map((r) => r.dealId),
      ...theirBonuses.map((b) => b.dealId),
    ]);
    const partnerShare = theirCommissions.reduce((s, r) => s + r.partnerShare, 0);
    const bonusEarned = theirBonuses.reduce((s, b) => s + b.bonusAmount, 0);
    const leadsSubmitted = leadsIn.filter((l) => l.referralPartnerId === p.id).length;
    return {
      partnerId: p.id,
      name: p.name,
      leadsSubmitted,
      dealsFunded: dealIds.size,
      partnerShare,
      bonusEarned,
      totalEarned: partnerShare + bonusEarned,
    };
  });

  return rows
    .filter((r) => r.leadsSubmitted > 0 || r.dealsFunded > 0 || r.totalEarned > 0)
    .sort((a, b) => b.totalEarned - a.totalEarned || b.leadsSubmitted - a.leadsSubmitted);
}

// ---- commission by month (fixed last-12-months window) ---------------------
// Independent of the page date filter, per the brief ("last 12 months"). Buckets
// live commission gross by its window month, oldest → newest.
export interface MonthBucket {
  key: string; // 'YYYY-MM'
  label: string; // 'Aug 25'
  total: number;
}

export function commissionByMonth(
  commissions: CommissionReportRow[],
  now = new Date(),
): MonthBucket[] {
  const buckets: MonthBucket[] = [];
  const index = new Map<string, MonthBucket>();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleDateString("en-ZA", { month: "short", year: "2-digit" });
    const b = { key, label, total: 0 };
    buckets.push(b);
    index.set(key, b);
  }
  for (const r of commissions) {
    if (!isLive(r) || !r.windowDay) continue;
    const key = r.windowDay.slice(0, 7);
    const b = index.get(key);
    if (b) b.total += r.grossCommission;
  }
  return buckets;
}

// ---- CSV export (client-side, POPIA-safe: owner data only) -----------------
export interface CsvColumn<T> {
  header: string;
  value: (row: T) => string | number | null | undefined;
}

function csvCell(value: string | number | null | undefined): string {
  const s = value == null ? "" : String(value);
  // RFC 4180 quoting + neutralise spreadsheet formula injection. The leading-
  // character set covers the classic formula triggers (= + - @) plus tab, CR,
  // LF, and full-width equals (＝) — all of which spreadsheet apps can still
  // parse as a formula from inside a quoted field. Contractor/partner names can
  // be attacker-influenced (a contractor sets their own full_name via the
  // portal), so this guards the owner's CSV export against that path.
  const safe = /^[=+\-@\t\r\n＝]/.test(s) ? "'" + s : s;
  return '"' + safe.replace(/"/g, '""') + '"';
}

export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const head = columns.map((c) => csvCell(c.header)).join(",");
  const body = rows.map((r) => columns.map((c) => csvCell(c.value(r))).join(",")).join("\r\n");
  return body ? head + "\r\n" + body : head;
}

export function downloadCsv<T>(filename: string, rows: T[], columns: CsvColumn<T>[]): void {
  const blob = new Blob([toCsv(rows, columns)], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
