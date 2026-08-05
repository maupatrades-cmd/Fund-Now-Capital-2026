import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/lib/useSession";
import type { TrainingModule, TrainingProgressRow } from "@/lib/training";

/*
 * TRAINING lane — contractor Product Knowledge training data hooks.
 *
 * All reads/writes go through the SECURITY DEFINER RPCs (get_training_modules_
 * for_role / get_contractor_training_progress / mark_module_started /
 * mark_module_completed), which re-check the caller's role + is_active and scope
 * strictly to auth.uid(). A contractor only ever sees their OWN progress.
 *
 * Caches are keyed by the session user id (the Macroscope cache-isolation rule):
 * a same-tab sign-out/sign-in as a different user can never surface the previous
 * user's cached modules or progress. Queries stay disabled until a concrete uid
 * resolves, so real rows are never cached under a placeholder null key.
 */

const MODULES_KEY = "training-modules";
const PROGRESS_KEY = "training-progress";

export function useTrainingModules() {
  const uid = useSession()?.user?.id ?? null;

  const query = useQuery({
    queryKey: [MODULES_KEY, uid],
    enabled: uid !== null,
    queryFn: async (): Promise<TrainingModule[]> => {
      const { data, error } = await supabase.rpc("get_training_modules_for_role");
      if (error) throw error;
      return (data ?? []) as TrainingModule[];
    },
  });

  return { ...query, isLoading: query.isLoading || uid === null };
}

export function useTrainingProgress() {
  const uid = useSession()?.user?.id ?? null;

  const query = useQuery({
    queryKey: [PROGRESS_KEY, uid],
    enabled: uid !== null,
    queryFn: async (): Promise<TrainingProgressRow[]> => {
      const { data, error } = await supabase.rpc("get_contractor_training_progress");
      if (error) throw error;
      return (data ?? []) as TrainingProgressRow[];
    },
  });

  return { ...query, isLoading: query.isLoading || uid === null };
}

// A single module by id, resolved from the already-fetched modules list (the
// module viewer only ever opens a module the contractor could list). Avoids a
// second round-trip and keeps the viewer working offline of a per-id RPC.
export function useTrainingModule(moduleId: string | undefined) {
  const { data, isLoading, isError, error } = useTrainingModules();
  const module = (data ?? []).find((m) => m.module_id === moduleId);
  return { module, isLoading, isError, error };
}

// Mark a module started (idempotent server-side). Fire-and-forget from the
// viewer on open; refreshes progress so the status pill + home card update.
export function useMarkModuleStarted() {
  const qc = useQueryClient();
  const uid = useSession()?.user?.id ?? null;

  return useMutation({
    mutationFn: async (moduleId: string) => {
      const { data, error } = await supabase.rpc("mark_module_started", {
        p_module_id: moduleId,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [PROGRESS_KEY, uid] });
    },
  });
}

// Mark a module completed (idempotent server-side, audited on first completion).
export function useMarkModuleCompleted() {
  const qc = useQueryClient();
  const uid = useSession()?.user?.id ?? null;

  return useMutation({
    mutationFn: async (moduleId: string) => {
      const { data, error } = await supabase.rpc("mark_module_completed", {
        p_module_id: moduleId,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [PROGRESS_KEY, uid] });
    },
  });
}
