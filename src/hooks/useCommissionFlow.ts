import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

// Commission flow (owner spec §4, Batch 5a): routes the Director's Agent Commission Notice (Codex's notice: client
// name, deal reference and the agent's amount only) Director → Administrator → Sales Coordinator → agent, the agent's
// portal invoice agent → HR → Administrator → Director, and the proof of payment Director → Administrator → HR →
// agent. This layer never calculates or pays commission; the Director pays in the commission editor.

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data as T;
}

export type RouteStatus =
  | "not_sent" | "with_administrator" | "with_coordinator" | "with_agent" | "invoice_with_hr" | "invoice_with_administrator"
  | "invoice_with_director" | "paid_with_administrator" | "paid_with_hr" | "closed";

export const ROUTE_LABEL: Record<RouteStatus, string> = {
  not_sent: "Not sent yet",
  with_administrator: "With the Administrator",
  with_coordinator: "With the Sales Coordinator",
  with_agent: "With the agent",
  invoice_with_hr: "Invoice with HR",
  invoice_with_administrator: "Invoice with the Administrator",
  invoice_with_director: "Invoice with the Director",
  paid_with_administrator: "Paid: proof with the Administrator",
  paid_with_hr: "Paid: proof with HR",
  closed: "Paid and sent to the agent",
};

// What the button says for each step a person can take.
export const STEP_LABEL: Record<string, string> = {
  with_administrator: "Send to the Administrator",
  with_coordinator: "Pass to the Sales Coordinator",
  with_agent: "Send to the agent",
  invoice_with_administrator: "Invoice checked: pass to the Administrator",
  invoice_with_director: "Pass to the Director",
  paid_with_administrator: "Paid: send proof to the Administrator",
  paid_with_hr: "Pass the proof to HR",
  closed: "Send the proof to the agent",
};

export type RouteHistory = { at: string; who: string | null; role: string; from: string | null; to: string; note: string | null };
export type RouteRow = {
  commission_notice_id: string; client_name: string; deal_reference: string; beneficiary_name: string; beneficiary_kind: string;
  commission_amount: string; status: RouteStatus; invoice_number: string | null; invoice_total: string | null;
  invoice_state: string | null; amounts_match: boolean | null; paid_reference: string | null; paid_at: string | null;
  next_steps: string[]; history: RouteHistory[]; updated_at: string;
};
export type MyNotice = {
  commission_notice_id: string; client_name: string; deal_reference: string; commission_amount: string; status: RouteStatus;
  invoice_number: string | null; invoice_state: string | null; sent_back_note: string | null; paid_reference: string | null;
  paid_at: string | null; updated_at: string;
};
export type InvoiceOption = { invoice_kind: "contractor" | "partner"; invoice_id: string; invoice_number: string; total_amount: string; state: string };

export const rands = (v: string | number | null) =>
  v === null ? "" : new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR", maximumFractionDigits: 2 }).format(Number(v));

export function useCommissionBoard() {
  return useQuery({ queryKey: ["commission-routes"], queryFn: () => rpc<RouteRow[]>("commission_routes_board") });
}
export function useMyCommissionNotices() {
  return useQuery({ queryKey: ["my-commission-notices"], queryFn: () => rpc<MyNotice[]>("my_commission_notices") });
}
export function useInvoiceOptions(noticeId: string | null) {
  return useQuery({
    queryKey: ["commission-invoice-options", noticeId], enabled: !!noticeId,
    queryFn: () => rpc<InvoiceOption[]>("my_commission_invoice_options", { p_notice: noticeId }),
  });
}
export function useMoveCommission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (i: { noticeId: string; to: string; note?: string; invoice?: InvoiceOption | null }) =>
      (i.to === "with_administrator"
        ? rpc<string>("owner_send_commission_notice", { p_notice: i.noticeId, p_note: i.note || null })
        : rpc<string>("commission_route_move", {
            p_notice: i.noticeId, p_to: i.to, p_note: i.note || null,
            p_invoice_kind: i.invoice?.invoice_kind ?? null, p_invoice_id: i.invoice?.invoice_id ?? null,
          })).then((s) => { if (s !== i.to) throw new Error("The notice did not move"); return s; }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["commission-routes"] });
      void qc.invalidateQueries({ queryKey: ["my-commission-notices"] });
    },
  });
}
