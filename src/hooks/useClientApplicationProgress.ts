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

export function useClientApplicationProgress() {
  const session = useSession();
  const userId = session?.user.id ?? null;

  return useQuery({
    queryKey: ["client-application-progress", userId],
    enabled: Boolean(userId),
    staleTime: 60_000,
    queryFn: async (): Promise<ClientApplicationProgress[]> => {
      const { data, error } = await supabase.rpc("client_portal_application_progress");
      if (error) throw error;

      return ((data ?? []) as ProgressRow[]).map((row) => ({
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
}
