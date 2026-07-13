import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { Building2, Landmark } from "lucide-react";
import { PriorityGlow } from "@/components/ui/priority-glow";
import { formatZAR, daysSince } from "@/lib/format";
import { stageUrgency, URGENCY_ACCENT, URGENCY_BADGE } from "@/lib/deals";
import { clientName, submittedFunders, type PipelineDeal } from "@/hooks/useDeals";

// Presentational card body (also used inside the drag overlay).
export function DealCardBody({ deal }: { deal: PipelineDeal }) {
  const days = daysSince(deal.stage_entered_at);
  const urgency = stageUrgency(days);
  const funders = submittedFunders(deal);

  return (
    <div className="p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-brand-teal">
          {deal.reference ?? "DEAL-—"}
        </span>
        <span className={"rounded-full px-2 py-0.5 text-[11px] font-semibold " + URGENCY_BADGE[urgency]}>
          {days}d
        </span>
      </div>
      <div className="mt-1.5 flex items-center gap-1.5 text-sm font-medium text-brand-navy">
        <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate">{clientName(deal)}</span>
      </div>
      <div className="mt-1 text-sm text-brand-navy">
        {deal.amount_requested != null ? formatZAR(deal.amount_requested) : "Amount TBC"}
      </div>
      <div className="mt-1.5 flex items-start gap-1.5 text-xs text-muted-foreground">
        <Landmark className="mt-0.5 h-3 w-3 shrink-0" />
        <span className="truncate">
          {funders.length ? funders.join(", ") : "Not submitted"}
        </span>
      </div>
    </div>
  );
}

export function DraggableDeal({
  deal,
  onOpen,
}: {
  deal: PipelineDeal;
  onOpen: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: deal.id,
  });
  const days = daysSince(deal.stage_entered_at);
  const urgency = stageUrgency(days);

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.4 : 1,
  };

  const shell = deal.is_priority ? (
    <PriorityGlow outerClassName="shadow-sm">
      <DealCardBody deal={deal} />
    </PriorityGlow>
  ) : (
    <div className={"rounded-xl border border-l-4 border-border bg-white shadow-sm " + URGENCY_ACCENT[urgency]}>
      <DealCardBody deal={deal} />
    </div>
  );

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      onClick={() => onOpen(deal.id)}
      className="cursor-pointer touch-none select-none"
      role="button"
    >
      {shell}
    </div>
  );
}
