import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/lib/useSession";

export type ClientProgressStatus =
  | "received"
  | "documents"
  | "review"
  | "funding_review"
  | "decision"
  | "finalising"
  | "funded"
  | "closed";

export type ClientProgressEvent = {
  status: ClientProgressStatus;
  occurredAt: string;
};

export type ClientApplicationProgress = {
  dealId: string;
  dealReference: string;
  productLabel: string;
  currentStatus: ClientProgressStatus;
  openedAt: string;
  lastProgressAt: string;
  isComplete: boolean;
  timeline: ClientProgressEvent[];
};

type ProgressRow = {
  deal_id: string;
  deal_reference: string;
  product_label: string;
  current_status: ClientProgressStatus;
  opened_at: string;
  last_progress_at: string;
  is_complete: boolean;
  timeline: ClientProgressEvent[] | null;
};

const statuses = new Set<ClientProgressStatus>([
  "received", "documents", "review", "funding_review", "decision", "finalising", "funded", "closed",
]);

function isProgressEvent(value: unknown): value is ClientProgressEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Record<string, unknown>;
  return typeof event.status === "string" && statuses.has(event.status as ClientProgressStatus) && typeof event.occurredAt === "string";
}

function isProgressRow(value: unknown): value is ProgressRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.deal_id === "string"
    && typeof row.deal_reference === "string"
    && typeof row.product_label === "string"
    && typeof row.current_status === "string"
    && statuses.has(row.current_status as ClientProgressStatus)
    && typeof row.opened_at === "string"
    && typeof row.last_progress_at === "string"
    && typeof row.is_complete === "boolean"
    && (row.timeline === null || (Array.isArray(row.timeline) && row.timeline.every(isProgressEvent)));
}

export function useClientApplicationProgress() {
  const session = useSession();
  const userId = session?.user.id ?? null;

  const query = useQuery({
    queryKey: ["client-application-progress", userId],
    enabled: Boolean(userId),
    staleTime: 60_000,
    queryFn: async (): Promise<ClientApplicationProgress[]> => {
      const { data, error } = await supabase.rpc("client_portal_application_progress");
      if (error) throw error;

      if (!Array.isArray(data) || !data.every(isProgressRow)) {
        throw new Error("Application progress returned an unexpected response.");
      }
      return data.map((row) => ({
        dealId: row.deal_id,
        dealReference: row.deal_reference,
        productLabel: row.product_label,
        currentStatus: row.current_status,
        openedAt: row.opened_at,
        lastProgressAt: row.last_progress_at,
        isComplete: row.is_complete,
        timeline: row.timeline ?? [],
      }));
    },
  });
  return { ...query, isSessionLoading: session === undefined };
}
