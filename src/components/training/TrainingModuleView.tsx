import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { TrainingMarkdown } from "@/components/training/TrainingMarkdown";
import {
  useTrainingModule,
  useTrainingProgress,
  useMarkModuleStarted,
  useMarkModuleCompleted,
} from "@/hooks/useTraining";
import { moduleStatus, progressByModule } from "@/lib/training";

/*
 * Contractor module viewer — renders a module's markdown content and a
 * "Mark as complete" button. Opening the module marks it started (idempotent,
 * fire-and-forget); the button marks it completed (idempotent, audited server-
 * side). Once complete, the button becomes a static "Completed" state.
 */
export default function TrainingModuleView({ moduleId }: { moduleId: string }) {
  const { module, isLoading, isError, error } = useTrainingModule(moduleId);
  const progress = useTrainingProgress();
  const markStarted = useMarkModuleStarted();
  const markCompleted = useMarkModuleCompleted();

  const status = moduleStatus(progressByModule(progress.data)[moduleId]);
  const isComplete = status === "completed";

  // Mark started once when the module is first opened. Guarded with a ref so a
  // re-render (or the progress refetch this triggers) doesn't re-fire it.
  const startedRef = useRef(false);
  useEffect(() => {
    if (!module || startedRef.current) return;
    startedRef.current = true;
    // Fire-and-forget: a start-tracking failure must not block reading.
    markStarted.mutate(moduleId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [module, moduleId]);

  const handleComplete = () => {
    markCompleted.mutate(moduleId, {
      onSuccess: () => toast.success("Module marked complete"),
      onError: (e) =>
        toast.error(`Couldn't mark complete: ${(e as Error)?.message ?? "unknown error"}`),
    });
  };

  return (
    <div className="space-y-5">
      <Link
        to="/contractor/training"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-brand-navy"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to training
      </Link>

      {isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}

      {isError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Couldn't load this module: {(error as Error)?.message ?? "unknown error"}.
        </div>
      )}

      {!isLoading && !isError && !module && (
        <div className="rounded-xl border border-border bg-white p-8 text-center text-sm text-muted-foreground shadow-sm">
          This module isn't available.{" "}
          <Link to="/contractor/training" className="font-medium text-brand-navy underline">
            Back to training
          </Link>
          .
        </div>
      )}

      {module && (
        <>
          <div className="space-y-1">
            <div className="text-xs font-medium uppercase tracking-wide text-brand-teal">
              Module {module.module_order}
            </div>
            <h1 className="text-2xl font-bold text-brand-navy">{module.title}</h1>
            {module.description && (
              <p className="text-sm text-muted-foreground">{module.description}</p>
            )}
          </div>

          <article className="rounded-xl border border-border bg-white p-6 shadow-sm">
            <TrainingMarkdown markdown={module.content_markdown} />
          </article>

          <div className="flex items-center justify-end">
            {isComplete ? (
              <span className="inline-flex items-center gap-2 rounded-lg bg-green-50 px-4 py-2.5 text-sm font-semibold text-green-700 ring-1 ring-inset ring-green-600/20">
                <CheckCircle2 className="h-4 w-4" />
                Completed
              </span>
            ) : (
              <button
                type="button"
                onClick={handleComplete}
                disabled={markCompleted.isPending}
                className="inline-flex items-center gap-2 rounded-lg bg-brand-navy px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-navy/90 disabled:opacity-60"
              >
                <CheckCircle2 className="h-4 w-4" />
                {markCompleted.isPending ? "Saving…" : "Mark as complete"}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
