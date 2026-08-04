// Monthly Statements — Sprint 4 Lane 4b (STATEMENTS).
//
// PURE types + month-picker helpers + a POPIA-safe client-side CSV exporter.
// Nothing here mutates or hits the network — the three role statements come from
// the DEFINER RPCs (get_owner/partner/contractor_monthly_statement) via
// useStatements. This module owns the shapes those RPCs return (kept in sync
// with the migration's jsonb contract) and the plumbing the views share.
//
// The CSV helper is intentionally self-contained (a small copy of the
// formula-injection-safe exporter) so this lane never couples to a sibling
// lane's file during a parallel sprint.

// ---- number coercion (jsonb numbers arrive as number; be defensive) --------
export function toNum(value: string | number | null | undefined): number {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

// ---- month picker ----------------------------------------------------------
export interface YearMonth {
  year: number;
  month: number; // 1–12
}

export const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function currentYearMonth(now = new Date()): YearMonth {
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

export function monthLabel(ym: YearMonth): string {
  return `${MONTH_NAMES[ym.month - 1]} ${ym.year}`;
}

// Shift a YearMonth by a whole number of months (delta may be negative),
// rolling the year over correctly.
export function addMonth(ym: YearMonth, delta: number): YearMonth {
  const zero = ym.year * 12 + (ym.month - 1) + delta;
  return { year: Math.floor(zero / 12), month: (zero % 12) + 1 };
}

// Is `ym` strictly in the future relative to `now`? Used to disable "next month"
// — a statement can't exist for a month that hasn't started.
export function isFutureMonth(ym: YearMonth, now = new Date()): boolean {
  const cur = currentYearMonth(now);
  return ym.year * 12 + ym.month > cur.year * 12 + cur.month;
}

// Years offered in the year <select>: from `back` years ago up to the current
// year (statements only look backward).
export function yearOptions(back = 4, now = new Date()): number[] {
  const y = now.getFullYear();
  const out: number[] = [];
  for (let i = 0; i <= back; i++) out.push(y - i);
  return out;
}

// ---- statement shapes (mirror the RPC jsonb contract) ----------------------
export interface StatementPeriod {
  year: number;
  month: number;
  label: string; // e.g. "August 2026"
  start: string; // 'YYYY-MM-DD'
  end: string; // 'YYYY-MM-DD' (last day of the month)
}

export type LineKind = "commission" | "bonus";

// OWNER — full breakdown, REAL names.
export interface OwnerStatementLine {
  id: string;
  kind: LineKind;
  deal_id: string;
  deal_reference: string | null;
  client_name: string | null;
  funder_name: string | null; // REAL name (owner view)
  attribution_type: string | null;
  partner_name: string | null;
  contractor_name: string | null;
  gross_commission: number;
  company_retention: number;
  partner_share: number;
  owner_share: number;
  contractor_share: number;
  bonus_amount: number;
  amount: number;
  state: string;
  occurred_at: string;
}

export interface OwnerStatementTotals {
  gross_commission: number;
  company_retention: number;
  partner_share: number;
  owner_share: number;
  contractor_share: number;
  bonus: number;
  line_count: number;
}

export interface OwnerStatement {
  period: StatementPeriod;
  totals: OwnerStatementTotals;
  line_items: OwnerStatementLine[];
}

// PARTNER — HIS take only (S7C: no gross/retention/pool/owner/tier; fictional
// funder name only).
export interface PartnerStatementLine {
  id: string;
  kind: LineKind;
  deal_reference: string | null;
  client_name: string | null;
  funder_name: string | null; // FICTIONAL display name
  amount: number; // his partner_share (commission) or bonus_amount (bonus)
  state: string;
  occurred_at: string;
}

export interface PartnerStatementTotals {
  commission_total: number;
  bonus_total: number;
  total_earned: number;
  line_count: number;
}

export interface PartnerStatement {
  period: StatementPeriod;
  totals: PartnerStatementTotals;
  line_items: PartnerStatementLine[];
}

// CONTRACTOR — HIS commission take (contractor_share) + reimbursements section.
export interface ContractorStatementLine {
  id: string;
  kind: "commission";
  deal_reference: string | null;
  client_name: string | null;
  funder_name: string | null; // FICTIONAL display name
  amount: number; // his contractor_share
  state: string;
  occurred_at: string;
}

export interface ContractorStatementTotals {
  commission_total: number;
  reimbursement_total: number;
  total: number;
  line_count: number;
}

// Shape reserved for the PROGRESSION lane's reimbursement ledger. Empty today
// (reimbursements_available = false) until that lane ships.
export interface ContractorReimbursement {
  id: string;
  label: string;
  amount: number;
  paid_at: string | null;
}

export interface ContractorStatement {
  period: StatementPeriod;
  totals: ContractorStatementTotals;
  line_items: ContractorStatementLine[];
  reimbursements: ContractorReimbursement[];
  reimbursements_available: boolean;
}

// ---- commission-state badge labels -----------------------------------------
// The commission lifecycle (earned → outstanding → payable → settled). Partner
// & contractor surfaces show the same words — they describe where the money is,
// not any FNC-internal figure, so they're S7C-safe.
export const STATE_LABEL: Record<string, string> = {
  earned: "Earned",
  outstanding: "Outstanding",
  payable: "Payable",
  settled: "Settled",
  void: "Void",
};

export const STATE_TONE: Record<string, string> = {
  earned: "bg-slate-100 text-slate-600",
  outstanding: "bg-amber-100 text-amber-700",
  payable: "bg-sky-100 text-sky-700",
  settled: "bg-brand-green/15 text-brand-green",
  void: "bg-red-100 text-red-700",
};

export function stateLabel(state: string): string {
  return STATE_LABEL[state] ?? state;
}

// ---- CSV export (client-side, formula-injection safe) ----------------------
export interface CsvColumn<T> {
  header: string;
  value: (row: T) => string | number | null | undefined;
}

// Money in a CSV always carries cents ("2436.40", never "2436" or "2436.4") so
// the exported figures read as currency in a spreadsheet. Returns a fixed
// 2-decimal string; the DB delivers exact numeric(14,2) values so this only
// normalises the text form, it does not change the amount.
export function csvMoney(value: string | number | null | undefined): string {
  return toNum(value).toFixed(2);
}

function csvCell(value: string | number | null | undefined): string {
  const s = value == null ? "" : String(value);
  // RFC 4180 quoting + neutralise spreadsheet formula injection (a partner or
  // contractor sets their own name / a client name can contain anything).
  const safe = /^[=+\-@\t\r\n＝]/.test(s) ? "'" + s : s;
  return '"' + safe.replace(/"/g, '""') + '"';
}

export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const head = columns.map((c) => csvCell(c.header)).join(",");
  const body = rows.map((r) => columns.map((c) => csvCell(c.value(r))).join(",")).join("\r\n");
  return body ? head + "\r\n" + body : head;
}

export function downloadCsv<T>(filename: string, rows: T[], columns: CsvColumn<T>[]): void {
  // Leading UTF-8 BOM (\uFEFF) so Excel on Windows reads the file as UTF-8 rather
  // than the system default (Windows-1252) — SA business/funder names with
  // non-ASCII characters ("O'Brien Trading", "Naïve Concepts") otherwise garble.
  const blob = new Blob(["\uFEFF" + toCsv(rows, columns)], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Defer revocation to the next tick — revoking synchronously in the same task
  // as a.click() can cancel the blob download before the browser starts it.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// A stable filename slug for a role's statement in a given month.
export function statementFilename(role: string, ym: YearMonth): string {
  return `${role}-statement-${ym.year}-${String(ym.month).padStart(2, "0")}.csv`;
}
