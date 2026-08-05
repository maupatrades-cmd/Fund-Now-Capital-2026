import { Link } from "react-router-dom";
import { GraduationCap } from "lucide-react";
import { useTrainingModules, useTrainingProgress } from "@/hooks/useTraining";
import { trainingCompletion } from "@/lib/training";

/*
 * "Training Progress" card for the contractor home page — "3 of 6 modules
 * complete" with a progress bar, linking through to /contractor/training.
 *
 * Coordination note (ContractorHomePage collision zone): PROGRESSION + GAMIFICATION
 * also add cards to the home page. This card is fully self-contained (its own
 * data hooks, no shared state), so whichever lane merges last just stacks its
 * card alongside this one — no integration beyond keeping the cards in the
 * content column.
 */
export default function TrainingProgressCard() {
  const modules = useTrainingModules();
  const progress = useTrainingProgress();

  const isLoading = modules.isLoading || progress.isLoading;
  // Distinguish a real fetch failure from the legitimate no-modules state — on
  // error both data values are undefined, so total === 0 would otherwise render
  // the misleading "No modules published yet". The card links to
  // /contractor/training, which carries the full error + retry UI.
  const isError = modules.isError || progress.isError;
  const { completed, total, percent } = trainingCompletion(modules.data, progress.data);

  return (
    <Link
      to="/contractor/training"
      className="block rounded-xl border border-border bg-white p-5 shadow-sm transition-colors hover:border-brand-teal/40 hover:bg-slate-50"
    >
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-teal/10 text-brand-teal">
          <GraduationCap className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-brand-navy">Training Progress</div>
          <div className={`text-sm ${isError ? "text-red-600" : "text-muted-foreground"}`}>
            {isLoading
              ? "Loading…"
              : isError
                ? "Couldn't load training progress — tap to retry"
                : total === 0
                  ? "No modules published yet"
                  : `${completed} of ${total} modules complete`}
          </div>
        </div>
      </div>

      {!isLoading && !isError && total > 0 && (
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100">
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
      )}
    </Link>
  );
}
