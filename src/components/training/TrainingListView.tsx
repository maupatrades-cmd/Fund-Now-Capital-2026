import { Link } from "react-router-dom";
import { GraduationCap, ChevronRight } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { useTrainingModules, useTrainingProgress } from "@/hooks/useTraining";
import {
  moduleStatus,
  progressByModule,
  trainingCompletion,
  MODULE_STATUS_BADGE,
  MODULE_STATUS_LABEL,
} from "@/lib/training";

/*
 * Contractor training home — the list of the 6 Product Knowledge modules in
 * order, each showing its completion status. Click through to the module viewer.
 * Read-only against the DEFINER RPCs; a contractor only ever sees their own
 * progress. This is the platform SKELETON — assessments, certification, badges
 * and points live in other lanes / later sub-lanes.
 */
export default function TrainingListView() {
  const modules = useTrainingModules();
  const progress = useTrainingProgress();

  const isLoading = modules.isLoading || progress.isLoading;
  const isError = modules.isError || progress.isError;
  const byModule = progressByModule(progress.data);
  const { completed, total, percent } = trainingCompletion(modules.data, progress.data);

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold text-brand-navy">Training</h1>
        <p className="text-sm text-muted-foreground">
          Work through your Product Knowledge modules. Completing them sharpens
          how you qualify leads and keeps you compliant.
        </p>
      </div>

      {isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}

      {isError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Couldn't load your training:{" "}
          {(modules.error as Error)?.message ??
            (progress.error as Error)?.message ??
            "unknown error"}
          .{" "}
          <button
            type="button"
            onClick={() => {
              void modules.refetch();
              void progress.refetch();
            }}
            className="font-medium underline"
          >
            Retry
          </button>
        </div>
      )}

      {!isLoading && !isError && (modules.data?.length ?? 0) === 0 && (
        <EmptyState
          icon={GraduationCap}
          title="No training modules yet"
          description="Your training modules will appear here once they're published."
        />
      )}

      {!isLoading && !isError && (modules.data?.length ?? 0) > 0 && (
        <>
          {/* Overall progress bar — mirrors the home-page card. */}
          <div className="rounded-xl border border-border bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-brand-navy">Your progress</span>
              <span className="text-muted-foreground">
                {completed} of {total} modules complete
              </span>
            </div>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-brand-teal transition-all"
                style={{ width: `${percent}%` }}
                role="progressbar"
                aria-valuenow={percent}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Training completion"
              />
            </div>
          </div>

          <ul className="space-y-2">
            {(modules.data ?? []).map((m) => {
              const status = moduleStatus(byModule[m.module_id]);
              return (
                <li key={m.module_id}>
                  <Link
                    to={`/contractor/training/${m.module_id}`}
                    className="flex items-center gap-4 rounded-xl border border-border bg-white p-4 shadow-sm transition-colors hover:border-brand-teal/40 hover:bg-slate-50"
                  >
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-navy/5 text-sm font-semibold text-brand-navy">
                      {m.module_order}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-brand-navy">{m.title}</div>
                      <div className="truncate text-sm text-muted-foreground">{m.description}</div>
                    </div>
                    <span
                      className={`hidden shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset sm:inline-flex ${MODULE_STATUS_BADGE[status]}`}
                    >
                      {MODULE_STATUS_LABEL[status]}
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
