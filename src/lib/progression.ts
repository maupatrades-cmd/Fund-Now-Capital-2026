// Contractor Progression (Sprint 3, Lane 3a) — shared types + reference data.
//
// Levels Base → Level 3, each with a monthly petrol/airtime/data reimbursement
// (CONTRACTOR.md Feature 3 — documented business facts). Progression is
// OWNER-CONTROLLED: the owner promotes each level via owner_promote_contractor().
// The thresholds below are DISPLAY HINTS for the progress bar only — they never
// auto-promote, and their exact numbers are provisional pending an owner ruling
// (flagged in the PR). The reimbursement figures are canonical.

export type ProgressionLevel = "Base" | "1" | "2" | "3";

export const LEVEL_ORDER: ProgressionLevel[] = ["Base", "1", "2", "3"];

export const LEVEL_LABEL: Record<ProgressionLevel, string> = {
  Base: "Base",
  "1": "Level 1",
  "2": "Level 2",
  "3": "Level 3",
};

// Monthly reimbursement per level (CONTRACTOR.md Feature 3). Canonical.
export const REIMBURSEMENT_ZAR: Record<ProgressionLevel, number> = {
  Base: 7000,
  "1": 9500,
  "2": 12000,
  "3": 14500,
};

// Provisional progression targets — owner ruling pending. Used only to render
// the "progress to next level" bars; promotion stays a manual owner decision.
export type Threshold = { leads_submitted: number; deals_funded: number };

export const NEXT_LEVEL_THRESHOLD: Record<Exclude<ProgressionLevel, "3">, Threshold> = {
  Base: { leads_submitted: 5, deals_funded: 1 },
  "1": { leads_submitted: 15, deals_funded: 3 },
  "2": { leads_submitted: 30, deals_funded: 6 },
};

export function nextLevel(level: ProgressionLevel): ProgressionLevel | null {
  const i = LEVEL_ORDER.indexOf(level);
  return i >= 0 && i < LEVEL_ORDER.length - 1 ? LEVEL_ORDER[i + 1] : null;
}

// Metrics as returned by get_contractor_progression. fnc_gross_generated is
// present ONLY for the owner view (S7C — contractors never see FNC gross), so
// it is optional here.
export type ProgressionMetrics = {
  leads_submitted: number;
  deals_funded: number;
  modules_completed: number;
  fnc_gross_generated?: number;
};

// Full shape returned by get_contractor_progression(p_contractor_id).
export type ProgressionData = {
  contractor_id: string;
  current_level: ProgressionLevel;
  metrics: ProgressionMetrics;
  activated_at: string | null;
  promoted_at_l1: string | null;
  promoted_at_l2: string | null;
  promoted_at_l3: string | null;
  is_owner_view: boolean;
  updated_at: string | null;
};

// Coerce a possibly-partial jsonb payload into a well-typed ProgressionData with
// numeric metrics (Postgres returns jsonb numbers as JS numbers, but be defensive).
export function normaliseProgression(raw: unknown): ProgressionData {
  const r = (raw ?? {}) as Record<string, unknown>;
  const m = (r.metrics ?? {}) as Record<string, unknown>;
  const num = (v: unknown): number => {
    const n = typeof v === "number" ? v : Number(v ?? 0);
    return Number.isFinite(n) ? n : 0;
  };
  const level = (r.current_level as ProgressionLevel) ?? "Base";
  const metrics: ProgressionMetrics = {
    leads_submitted: num(m.leads_submitted),
    deals_funded: num(m.deals_funded),
    modules_completed: num(m.modules_completed),
  };
  // Only carry FNC gross through when the server included it (owner view).
  if (m.fnc_gross_generated !== undefined) {
    metrics.fnc_gross_generated = num(m.fnc_gross_generated);
  }
  return {
    contractor_id: String(r.contractor_id ?? ""),
    current_level: LEVEL_ORDER.includes(level) ? level : "Base",
    metrics,
    activated_at: (r.activated_at as string) ?? null,
    promoted_at_l1: (r.promoted_at_l1 as string) ?? null,
    promoted_at_l2: (r.promoted_at_l2 as string) ?? null,
    promoted_at_l3: (r.promoted_at_l3 as string) ?? null,
    is_owner_view: Boolean(r.is_owner_view),
    updated_at: (r.updated_at as string) ?? null,
  };
}

export type LevelProgress = {
  next: ProgressionLevel | null;
  threshold: Threshold | null;
  leadsPct: number; // 0–100
  dealsPct: number; // 0–100
  overallPct: number; // min of the dimensions — the gating metric
  metThreshold: boolean;
};

// Progress toward the next level from the contractor's own metrics (leads +
// deals only — FNC gross is owner-only and never gates a contractor-facing bar).
export function computeLevelProgress(data: ProgressionData): LevelProgress {
  const next = nextLevel(data.current_level);
  if (!next || data.current_level === "3") {
    return { next: null, threshold: null, leadsPct: 100, dealsPct: 100, overallPct: 100, metThreshold: true };
  }
  const threshold = NEXT_LEVEL_THRESHOLD[data.current_level as Exclude<ProgressionLevel, "3">];
  const pct = (have: number, need: number) =>
    need <= 0 ? 100 : Math.min(100, Math.round((have / need) * 100));
  const leadsPct = pct(data.metrics.leads_submitted, threshold.leads_submitted);
  const dealsPct = pct(data.metrics.deals_funded, threshold.deals_funded);
  const overallPct = Math.min(leadsPct, dealsPct);
  return { next, threshold, leadsPct, dealsPct, overallPct, metThreshold: overallPct >= 100 };
}
