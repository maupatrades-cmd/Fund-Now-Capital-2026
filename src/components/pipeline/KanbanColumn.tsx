import { useDroppable } from "@dnd-kit/core";
import { DraggableDeal } from "./DealCard";
import type { PipelineDeal } from "@/hooks/useDeals";

export function KanbanColumn({
  stage,
  label,
  deals,
  onOpen,
}: {
  stage: string;
  label: string;
  deals: PipelineDeal[];
  onOpen: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });

  return (
    <div className="flex w-72 shrink-0 flex-col">
      <div className="mb-2 flex items-center justify-between px-1">
        <span className="text-sm font-semibold text-brand-navy">{label}</span>
        <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-semibold text-brand-navy">
          {deals.length}
        </span>
      </div>
      <div
        ref={setNodeRef}
        className={
          "flex-1 space-y-2 rounded-xl p-2 transition-colors min-h-[120px] " +
          (isOver ? "bg-brand-teal/10 ring-2 ring-brand-teal/40" : "bg-slate-100/70")
        }
      >
        {deals.map((deal) => (
          <DraggableDeal key={deal.id} deal={deal} onOpen={onOpen} />
        ))}
        {deals.length === 0 && (
          <p className="px-1 py-6 text-center text-xs text-muted-foreground">Drop deals here</p>
        )}
      </div>
    </div>
  );
}
