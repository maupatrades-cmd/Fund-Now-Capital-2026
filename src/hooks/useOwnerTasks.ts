import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { invalidateActivity } from "@/hooks/useActivity";

export type OwnerTask = {
  id: string; title: string; notes: string | null; due_at: string | null;
  priority: "low" | "normal" | "high"; status: "open" | "completed" | "cancelled";
  created_at: string; client: { business_name: string } | { business_name: string }[] | null;
  deal: { reference: string | null } | { reference: string | null }[] | null;
};

export function useOwnerTasks() {
  return useQuery({ queryKey: ["owner-tasks"], queryFn: async () => {
    const { data, error } = await supabase.from("owner_tasks")
      .select("id,title,notes,due_at,priority,status,created_at,client:clients(business_name),deal:deals(reference)")
      .order("status").order("due_at", { ascending: true, nullsFirst: false });
    if (error) throw error;
    return (data ?? []) as unknown as OwnerTask[];
  }});
}

export function useCreateOwnerTask() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async (task: { title: string; notes?: string; dueAt?: string; priority: OwnerTask["priority"] }) => {
    const { error } = await supabase.from("owner_tasks").insert({ title: task.title.trim(), notes: task.notes?.trim() || null, due_at: task.dueAt || null, priority: task.priority });
    if (error) throw error;
  }, onSuccess: () => { void qc.invalidateQueries({ queryKey: ["owner-tasks"] }); invalidateActivity(qc); }});
}

export function useSetOwnerTaskStatus() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async ({ id, status }: { id: string; status: OwnerTask["status"] }) => {
    const { error } = await supabase.rpc("owner_set_task_status", { p_task_id: id, p_status: status });
    if (error) throw error;
  }, onSuccess: () => { void qc.invalidateQueries({ queryKey: ["owner-tasks"] }); invalidateActivity(qc); }});
}
