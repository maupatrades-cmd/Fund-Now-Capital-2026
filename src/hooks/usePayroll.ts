import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

// Payroll cycle and payslips (Batch 5c; docs/FNC-LAUNCH-PLAN-2026-11-09.md §3 decision 3 and §5). One cycle per pay
// month: capture 7th to 6th, queries to the 11th, pay day the 27th (or the last working day before it). Payslips go
// Administrator (prepares) → Director (approves) → Administrator (releases) → HR (distributes) → staff member.
// Every read and write is a role-checked database function; totals are computed by the database.

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data as T;
}

export type CycleStatus = "open" | "calculating" | "query_window" | "closed" | "paid";
export const CYCLE_LABEL: Record<CycleStatus, string> = {
  open: "Open (capturing)", calculating: "Calculating", query_window: "Open for queries", closed: "Closed", paid: "Paid",
};
export const CYCLE_STEP: Record<string, string> = {
  calculating: "Start calculating", query_window: "Open for queries", closed: "Close payroll", paid: "Mark paid",
};
export type PayslipStatus = "draft" | "awaiting_director" | "approved" | "with_hr" | "distributed" | "acknowledged";
export const PAYSLIP_LABEL: Record<PayslipStatus, string> = {
  draft: "Being prepared", awaiting_director: "With the Director", approved: "Approved", with_hr: "With HR",
  distributed: "Sent to staff member", acknowledged: "Acknowledged",
};
export const PAYSLIP_STEP: Record<string, string> = {
  awaiting_director: "Send to the Director", approved: "Approve", draft: "Send back", with_hr: "Release to HR",
  distributed: "Distribute to staff member", acknowledged: "I have received it",
};
export type LineKind = "salary" | "allowance" | "incentive" | "deduction" | "clawback";
export const LINE_LABEL: Record<LineKind, string> = {
  salary: "Salary", allowance: "Allowance", incentive: "Incentive", deduction: "Deduction", clawback: "Clawback",
};

export type PayrollCycle = {
  cycle_id: string; pay_month: string; period_start: string; period_end: string; query_close_on: string; pay_date: string;
  status: CycleStatus; payslips: number; draft: number; awaiting_director: number; approved_or_later: number;
  acknowledged: number; next_steps: string[];
};
export type PayslipLine = { line_id?: string; kind: LineKind; label: string; amount: string };
export type PayrollPayslip = {
  payslip_id: string; profile_id: string; full_name: string | null; staff_role: string; status: PayslipStatus;
  gross: string; deductions: string; net: string; lines: PayslipLine[]; next_steps: string[]; last_note: string | null;
  updated_at: string;
};
export type MyPayslip = { payslip_id: string; pay_month: string; pay_date: string; status: PayslipStatus; gross: string; deductions: string; net: string };
export type PayslipDocument = {
  payslip_id: string; status: PayslipStatus; full_name: string | null; staff_role: string; pay_month: string;
  period_start: string; period_end: string; pay_date: string; gross: string; deductions: string; net: string;
  lines: PayslipLine[]; can_acknowledge: boolean;
  company: { legal_name?: string | null; registration_number?: string | null; address?: string | null };
};

export const rands = (v: string | number | null | undefined) =>
  v === null || v === undefined ? "" : new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(Number(v));

const keys = ["payroll-cycles", "payroll-payslips", "my-payslips", "payslip-document"];
function useInvalidate() {
  const qc = useQueryClient();
  return () => { for (const k of keys) void qc.invalidateQueries({ queryKey: [k] }); };
}
const must = <T,>(v: T | null | undefined, what: string): T => { if (v === null || v === undefined) throw new Error(`${what} did not save`); return v; };

export function usePayrollCycles(enabled: boolean) {
  return useQuery({ queryKey: ["payroll-cycles"], enabled, queryFn: () => rpc<PayrollCycle[]>("payroll_cycles_list") });
}
export function usePayrollPayslips(cycleId: string | null) {
  return useQuery({ queryKey: ["payroll-payslips", cycleId], enabled: !!cycleId, queryFn: () => rpc<PayrollPayslip[]>("payroll_payslips", { p_cycle: cycleId }) });
}
export function useMyPayslips() {
  return useQuery({ queryKey: ["my-payslips"], queryFn: () => rpc<MyPayslip[]>("my_payslips") });
}
export function usePayslipDocument(payslipId: string | undefined) {
  return useQuery({ queryKey: ["payslip-document", payslipId], enabled: !!payslipId, queryFn: () => rpc<PayslipDocument>("payslip_document", { p_payslip: payslipId }) });
}

export function useOpenCycle() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (payMonth: string) => rpc<string>("payroll_open_cycle", { p_pay_month: payMonth }).then((id) => must(id, "The cycle")),
    onSuccess: invalidate,
  });
}
export function useMoveCycle() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (i: { cycleId: string; to: string; note?: string }) =>
      rpc<string>("payroll_move_cycle", { p_cycle: i.cycleId, p_to: i.to, p_note: i.note || null })
        .then((s) => { if (s !== i.to) throw new Error("The cycle did not move"); return s; }),
    onSuccess: invalidate,
  });
}
export function useAddPayslipLine() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (i: { payslipId: string; kind: LineKind; label: string; amount: string }) =>
      rpc<string>("payslip_add_line", { p_payslip: i.payslipId, p_kind: i.kind, p_label: i.label, p_amount: i.amount }).then((id) => must(id, "The line")),
    onSuccess: invalidate,
  });
}
export function useAddSalaryLine() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (i: { payslipId: string; monthly: string; startDate: string | null }) =>
      rpc<string>("payslip_add_salary_line", { p_payslip: i.payslipId, p_monthly: i.monthly, p_start: i.startDate }).then((id) => must(id, "The salary line")),
    onSuccess: invalidate,
  });
}
export function useRemovePayslipLine() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (i: { lineId: string; reason: string }) =>
      rpc<string>("payslip_remove_line", { p_line: i.lineId, p_reason: i.reason }).then((v) => must(v, "Removing the line")),
    onSuccess: invalidate,
  });
}
export function useMovePayslip() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (i: { payslipId: string; to: string; note?: string }) =>
      rpc<string>("payslip_move", { p_payslip: i.payslipId, p_to: i.to, p_note: i.note || null })
        .then((s) => { if (s !== i.to) throw new Error("The payslip did not move"); return s; }),
    onSuccess: invalidate,
  });
}
