import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { daysSince, startOfMonth } from "@/lib/format";
import { DEAL_STAGES, isInFlight, type DealStage } from "@/lib/dealStages";

// ---- Row shapes returned by the Supabase queries -------------------------
// Supabase can return an embedded to-one relation as an object or a 1-element
// array depending on how it infers the relationship; `one()` normalises it.
type Named = { business_name: string } | { business_name: string }[] | null;

export type DealRow = {
  id: string;
  reference: string | null;
  stage: DealStage;
  stage_entered_at: string;
  gross_commission: string | null;
  created_at: string;
  client: Named;
};

type CommissionRow = {
  gross_commission: string | null;
  status: string;
  created_at: string;
};

type SubmissionRow = {
  id: string;
  status: string;
  submitted_at: string | null;
  created_at: string;
  deal:
    | { reference: string | null; client: Named }
    | { reference: string | null; client: Named }[]
    | null;
};

export type ActivityRow = {
  id: string;
  channel: string;
  subject: string | null;
  body: string | null;
  occurred_at: string;
  client: Named;
};

function one<T>(rel: T | T[] | null): T | null {
  if (Array.isArray(rel)) return rel[0] ?? null;
  return rel ?? null;
}

export function businessName(rel: Named): string {
  const c = one(rel);
  return c?.business_name ?? "Unknown client";
}

function num(v: string | null): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

// ---- Fetch ---------------------------------------------------------------
async function fetchDashboard() {
  const [deals, commissions, submissions, activity] = await Promise.all([
    supabase
      .from("deals")
      .select(
        "id, reference, stage, stage_entered_at, gross_commission, created_at, client:clients(business_name)",
      ),
    supabase.from("commission_records").select("gross_commission, status, created_at"),
    supabase
      .from("deal_funder_submissions")
      .select(
        "id, status, submitted_at, created_at, deal:deals(reference, client:clients(business_name))",
      ),
    supabase
      .from("communications")
      .select("id, channel, subject, body, occurred_at, client:clients(business_name)")
      .order("occurred_at", { ascending: false })
      .limit(12),
  ]);

  const firstError =
    deals.error || commissions.error || submissions.error || activity.error;
  if (firstError) throw firstError;

  return {
    deals: (deals.data ?? []) as DealRow[],
    commissions: (commissions.data ?? []) as CommissionRow[],
    submissions: (submissions.data ?? []) as SubmissionRow[],
    activity: (activity.data ?? []) as ActivityRow[],
  };
}

// ---- Derived metrics -----------------------------------------------------
const STUCK_DAYS = 5;
const AWAITING_DAYS = 7;
const AWAITING_STATUSES = ["submitted", "in_credit"];

function compute(
  data: Awaited<ReturnType<typeof fetchDashboard>>,
  now: Date,
) {
  const monthStart = startOfMonth(now);
  const inMonth = (iso: string) => new Date(iso) >= monthStart;

  const fundedThisMonth = data.commissions.filter((c) => inMonth(c.created_at));
  const grossMtd = fundedThisMonth.reduce((s, c) => s + num(c.gross_commission), 0);

  const received = data.commissions
    .filter((c) => c.status === "paid")
    .reduce((s, c) => s + num(c.gross_commission), 0);
  const pending = data.commissions
    .filter((c) => c.status !== "paid")
    .reduce((s, c) => s + num(c.gross_commission), 0);

  const dealsInFlight = data.deals.filter((d) => isInFlight(d.stage)).length;

  // Pipeline snapshot: count per stage, in canonical order.
  const counts = new Map<string, number>();
  for (const d of data.deals) counts.set(d.stage, (counts.get(d.stage) ?? 0) + 1);
  const pipeline = DEAL_STAGES.map((s) => ({
    stage: s.value,
    label: s.label,
    count: counts.get(s.value) ?? 0,
  }));
  const pipelineMax = pipeline.reduce((m, p) => Math.max(m, p.count), 0);

  // Actions needed.
  const stuckDeals = data.deals
    .filter((d) => isInFlight(d.stage) && daysSince(d.stage_entered_at, now) >= STUCK_DAYS)
    .sort((a, b) => daysSince(b.stage_entered_at, now) - daysSince(a.stage_entered_at, now));

  const awaitingDecision = data.submissions
    .filter(
      (s) =>
        AWAITING_STATUSES.includes(s.status) &&
        daysSince(s.submitted_at ?? s.created_at, now) >= AWAITING_DAYS,
    )
    .sort(
      (a, b) =>
        daysSince(b.submitted_at ?? b.created_at, now) -
        daysSince(a.submitted_at ?? a.created_at, now),
    );

  const fundedNotInvoiced = data.deals.filter((d) => d.stage === "funded");

  return {
    kpis: {
      fundedThisMonth: fundedThisMonth.length,
      grossMtd,
      received,
      pending,
      dealsInFlight,
    },
    pipeline,
    pipelineMax,
    actions: { stuckDeals, awaitingDecision, fundedNotInvoiced },
    activity: data.activity,
  };
}

export type DashboardMetrics = ReturnType<typeof compute>;

export function useDashboard() {
  const query = useQuery({ queryKey: ["dashboard"], queryFn: fetchDashboard });
  const metrics = useMemo(
    () => (query.data ? compute(query.data, new Date()) : null),
    [query.data],
  );
  return { ...query, metrics };
}
