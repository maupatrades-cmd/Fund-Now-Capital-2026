// TRAINING lane — types + pure helpers for the contractor Product Knowledge
// training platform (Sprint 5 Lane 5a). Kept separate from the hooks so the
// progress math is trivially testable and has no React/Supabase dependency.

// A training module as returned by get_training_modules_for_role().
export type TrainingModule = {
  module_id: string;
  module_order: number;
  title: string;
  description: string;
  content_markdown: string;
  is_published: boolean;
};

// One (contractor, module) progress row from get_contractor_training_progress().
export type TrainingProgressRow = {
  module_id: string;
  started_at: string | null;
  completed_at: string | null;
};

export type ModuleStatus = "not_started" | "in_progress" | "completed";

// Derive a module's status for the calling contractor from its progress row.
export function moduleStatus(row: TrainingProgressRow | undefined): ModuleStatus {
  if (!row) return "not_started";
  if (row.completed_at) return "completed";
  if (row.started_at) return "in_progress";
  return "not_started";
}

// Index progress rows by module_id for O(1) lookup against the module list.
export function progressByModule(
  rows: TrainingProgressRow[] | undefined,
): Record<string, TrainingProgressRow> {
  const map: Record<string, TrainingProgressRow> = {};
  for (const r of rows ?? []) map[r.module_id] = r;
  return map;
}

// Overall completion tally for the "3 of 6 modules complete" card + progress bar.
export function trainingCompletion(
  modules: TrainingModule[] | undefined,
  rows: TrainingProgressRow[] | undefined,
): { completed: number; total: number; percent: number } {
  const total = modules?.length ?? 0;
  const done = new Set(
    (rows ?? []).filter((r) => r.completed_at).map((r) => r.module_id),
  );
  // Count only completions that map to a currently-listed module, so a stale
  // completion for an unpublished/removed module never inflates the tally.
  const completed = (modules ?? []).filter((m) => done.has(m.module_id)).length;
  const percent = total === 0 ? 0 : Math.round((completed / total) * 100);
  return { completed, total, percent };
}

export const MODULE_STATUS_BADGE: Record<ModuleStatus, string> = {
  not_started: "bg-slate-100 text-slate-600 ring-slate-500/20",
  in_progress: "bg-amber-50 text-amber-700 ring-amber-600/20",
  completed: "bg-green-50 text-green-700 ring-green-600/20",
};

export const MODULE_STATUS_LABEL: Record<ModuleStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  completed: "Completed",
};
