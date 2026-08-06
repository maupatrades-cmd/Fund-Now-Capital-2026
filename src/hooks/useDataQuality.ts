import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export type QualityIssue = {
  key: string;
  area: "Client" | "Lead" | "Deal" | "Funder";
  label: string;
  problem: string;
  to: string;
  severity: "high" | "medium";
};

type ClientRow = {
  id: string; business_name: string; cipc_number: string | null;
  industry_id: string | null; monthly_turnover: string | null;
  contacts: { count: number }[] | null;
};
type LeadRow = {
  id: string; business_name: string; cipc_number: string | null;
  industry_id: string | null; contact_cell: string | null; contact_email: string | null;
  funding_amount: string | null; qualification_stage: string;
};
type DealRow = { id: string; reference: string | null; amount_requested: string | null };
type FunderRow = {
  id: string; name: string; is_active: boolean; is_contracted: boolean;
  short_code: string | null; display_name_for_partner: string | null;
};

const PAGE_SIZE = 500;

async function fetchAllRows<T>(
  loadPage: (from: number, to: number) => Promise<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await loadPage(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

export function useDataQuality() {
  return useQuery({
    queryKey: ["data-quality"],
    queryFn: async (): Promise<QualityIssue[]> => {
      const [clients, leads, deals, funders] = await Promise.all([
        fetchAllRows<ClientRow>(async (from, to) => {
          const { data, error } = await supabase.from("clients")
            .select("id,business_name,cipc_number,industry_id,monthly_turnover,contacts:client_contacts(count)")
            .order("id").range(from, to);
          return { data: data as unknown as ClientRow[] | null, error };
        }),
        fetchAllRows<LeadRow>(async (from, to) => {
          const { data, error } = await supabase.from("leads")
            .select("id,business_name,cipc_number,industry_id,contact_cell,contact_email,funding_amount,qualification_stage")
            .order("id").range(from, to);
          return { data: data as LeadRow[] | null, error };
        }),
        fetchAllRows<DealRow>(async (from, to) => {
          const { data, error } = await supabase.from("deals")
            .select("id,reference,amount_requested").order("id").range(from, to);
          return { data: data as DealRow[] | null, error };
        }),
        fetchAllRows<FunderRow>(async (from, to) => {
          const { data, error } = await supabase.from("funders")
            .select("id,name,is_active,is_contracted,short_code,display_name_for_partner")
            .order("id").range(from, to);
          return { data: data as FunderRow[] | null, error };
        }),
      ]);

      const issues: QualityIssue[] = [];
      for (const row of clients) {
        const missing = [!row.cipc_number && "CIPC number", !row.industry_id && "industry", row.monthly_turnover == null && "monthly turnover", Number(row.contacts?.[0]?.count ?? 0) === 0 && "contact"].filter(Boolean);
        if (missing.length) issues.push({ key: `client-${row.id}`, area: "Client", label: row.business_name, problem: `Missing ${missing.join(", ")}`, to: `/clients/${row.id}/edit`, severity: missing.length > 2 ? "high" : "medium" });
      }
      for (const row of leads) {
        if (row.qualification_stage !== "qualified") {
          const missing = [!row.cipc_number && "CIPC number", !row.industry_id && "industry", (!row.contact_cell && !row.contact_email) && "contact method", row.funding_amount == null && "funding amount"].filter(Boolean);
          if (missing.length) issues.push({ key: `lead-${row.id}`, area: "Lead", label: row.business_name, problem: `Missing ${missing.join(", ")}`, to: `/leads/${row.id}/edit`, severity: missing.length > 2 ? "high" : "medium" });
        }
      }
      for (const row of deals) {
        if (row.amount_requested == null) issues.push({ key: `deal-${row.id}`, area: "Deal", label: row.reference ?? "Deal", problem: "Missing amount requested", to: `/deals/${row.id}`, severity: "high" });
      }
      for (const row of funders) {
        const missing = [row.is_contracted && !row.short_code && "short code", !row.display_name_for_partner && "partner display name"].filter(Boolean);
        if (row.is_active && missing.length) issues.push({ key: `funder-${row.id}`, area: "Funder", label: row.name, problem: `Missing ${missing.join(", ")}`, to: `/funders/${row.id}/edit`, severity: "high" });
      }
      return issues.sort((a, b) => a.severity === b.severity ? a.area.localeCompare(b.area) : a.severity === "high" ? -1 : 1);
    },
  });
}
