import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

// Targets per role (launch plan §7): each landing page shows the person's targets against month-to-date; the Director
// sees every role on one screen and confirms or changes the proposed targets. Actuals come from the database; a measure
// the CRM does not record yet comes back as null ("not tracked yet").

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data as T;
}

export type TargetRow = {
  metric_key: string; label: string; target: string | null; unit: "count" | "percent" | "text"; scope: "person" | "office";
  status: "proposed" | "confirmed"; actual: string | null;
};
export type TargetOverviewRow = TargetRow & { profile_id: string; full_name: string | null; role: string };

export function useMyTargets(enabled = true) {
  return useQuery({ queryKey: ["my-targets"], enabled, queryFn: () => rpc<TargetRow[]>("my_targets") });
}
export function useTargetsOverview(enabled: boolean) {
  return useQuery({ queryKey: ["targets-overview"], enabled, queryFn: () => rpc<TargetOverviewRow[]>("owner_targets_overview") });
}
export function useSetTarget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (i: { role: string; metric: string; target: number | null }) =>
      rpc<string>("owner_set_role_target", { p_role: i.role, p_metric: i.metric, p_target: i.target, p_confirm: true })
        .then((at) => { if (!at) throw new Error("The target was not saved"); return at; }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["targets-overview"] });
      void qc.invalidateQueries({ queryKey: ["my-targets"] });
    },
  });
}

export const targetValue = (v: string | null, unit: TargetRow["unit"]) =>
  v === null ? "" : unit === "percent" ? `${Number(v)}%` : String(Number(v));
// Progress toward a count or percent target, 0–100; null when there is nothing to measure.
export const targetProgress = (r: TargetRow) =>
  r.unit === "text" || r.actual === null || r.target === null || Number(r.target) <= 0 ? null
    : Math.min(100, Math.round((100 * Number(r.actual)) / Number(r.target)));
