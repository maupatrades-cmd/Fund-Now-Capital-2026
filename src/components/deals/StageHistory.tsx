import { ArrowRight } from "lucide-react";
import { useDealStageHistory } from "@/hooks/useDealDetail";
import { stageLabel } from "@/lib/dealStages";
import { formatRelative } from "@/lib/format";

export function StageHistory({ dealId }: { dealId: string }) {
  const { data: history, isLoading, isError, error } = useDealStageHistory(dealId);

  return (
    <div>
      <h3 className="mb-3 text-sm font-semibold text-brand-navy">Stage history</h3>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : isError ? (
        <p className="text-sm text-red-600">
          Couldn't load stage history: {(error as Error)?.message}
        </p>
      ) : history && history.length > 0 ? (
        <ul className="space-y-2">
          {history.map((h) => (
            <li key={h.id} className="flex items-center gap-2 text-sm">
              <span className="text-[11px] text-muted-foreground w-20 shrink-0">
                {formatRelative(h.changed_at)}
              </span>
              <span className="flex items-center gap-1.5 text-brand-navy">
                {h.from_stage && (
                  <>
                    <span className="text-muted-foreground">{stageLabel(h.from_stage)}</span>
                    <ArrowRight className="h-3 w-3 text-muted-foreground" />
                  </>
                )}
                <span className="font-medium">{stageLabel(h.to_stage)}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No stage changes recorded.</p>
      )}
    </div>
  );
}
