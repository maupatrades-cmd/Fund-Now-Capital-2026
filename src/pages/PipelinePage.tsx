import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { DEAL_STAGES } from "@/lib/dealStages";
import {
  usePipeline,
  useClientOptions,
  useFunderOptions,
  useUpdateDealStage,
  submittedFunderIds,
  one,
  type PipelineDeal,
} from "@/hooks/useDeals";
import { KanbanColumn } from "@/components/pipeline/KanbanColumn";
import { DealCardBody } from "@/components/pipeline/DealCard";
import { NewDealDialog } from "@/components/pipeline/NewDealDialog";
import { FilterBar, EMPTY_FILTERS, type PipelineFilters } from "@/components/pipeline/FilterBar";

function matches(deal: PipelineDeal, f: PipelineFilters): boolean {
  if (f.clientId && one(deal.client)?.id !== f.clientId) return false;
  if (f.funderId && !submittedFunderIds(deal).includes(f.funderId)) return false;
  if (f.referral === "self" && deal.referral_partner_id) return false;
  if (f.referral === "partner" && !deal.referral_partner_id) return false;
  if (f.from && new Date(deal.created_at) < new Date(f.from)) return false;
  if (f.to && new Date(deal.created_at) > new Date(f.to + "T23:59:59")) return false;
  return true;
}

export default function PipelinePage() {
  const navigate = useNavigate();
  const { data: deals, isLoading, isError, error } = usePipeline();
  const { data: clients } = useClientOptions();
  const { data: funders } = useFunderOptions();
  const updateStage = useUpdateDealStage();

  const [filters, setFilters] = useState<PipelineFilters>(EMPTY_FILTERS);
  const [newOpen, setNewOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const draggingRef = useRef(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  const filtered = useMemo(
    () => (deals ?? []).filter((d) => matches(d, filters)),
    [deals, filters],
  );

  const byStage = useMemo(() => {
    const map = new Map<string, PipelineDeal[]>();
    for (const s of DEAL_STAGES) map.set(s.value, []);
    for (const d of filtered) map.get(d.stage)?.push(d);
    return map;
  }, [filtered]);

  const activeDeal = activeId ? (deals ?? []).find((d) => d.id === activeId) ?? null : null;

  const onDragStart = (e: DragStartEvent) => {
    draggingRef.current = true;
    setActiveId(String(e.active.id));
  };
  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = e;
    if (over) {
      const dealId = String(active.id);
      const newStage = String(over.id);
      const deal = (deals ?? []).find((d) => d.id === dealId);
      if (deal && deal.stage !== newStage) {
        if (deal.stage === "declined") {
          toast(
            "Declined deals can't be moved — reopen from the deal detail page if needed.",
          );
        } else {
          updateStage.mutate({ id: dealId, stage: newStage as PipelineDeal["stage"] });
        }
      }
    }
    setTimeout(() => {
      draggingRef.current = false;
    }, 0);
  };
  const onOpen = (id: string) => {
    if (draggingRef.current) return;
    navigate(`/deals/${id}`);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <FilterBar
          filters={filters}
          onChange={setFilters}
          clients={clients ?? []}
          funders={funders ?? []}
        />
        <button
          type="button"
          onClick={() => setNewOpen(true)}
          className="flex items-center gap-2 rounded-lg bg-brand-teal px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-teal/90"
        >
          <Plus className="h-4 w-4" /> New deal
        </button>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading pipeline…</p>}
      {isError && (
        <p className="text-sm text-red-600">Couldn't load pipeline: {(error as Error)?.message}</p>
      )}

      {!isLoading && !isError && (
        <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
          <div className="flex gap-3 overflow-x-auto pb-4">
            {DEAL_STAGES.map((s) => (
              <KanbanColumn
                key={s.value}
                stage={s.value}
                label={s.label}
                deals={byStage.get(s.value) ?? []}
                onOpen={onOpen}
              />
            ))}
          </div>
          <DragOverlay>
            {activeDeal ? (
              <div className="w-72 rounded-xl border border-border bg-white shadow-lg">
                <DealCardBody deal={activeDeal} />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      {newOpen && (
        <NewDealDialog
          onClose={() => setNewOpen(false)}
          onCreated={(id) => {
            setNewOpen(false);
            navigate(`/deals/${id}`);
          }}
        />
      )}
    </div>
  );
}
