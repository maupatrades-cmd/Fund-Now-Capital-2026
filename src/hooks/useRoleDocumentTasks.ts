import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/lib/useSession";

export type DocumentTaskStatus = "open" | "in_progress" | "blocked" | "completed" | "cancelled";

export type RoleDocumentTask = {
  task_id: string;
  title: string;
  task_kind: "document_request" | "paperwork_review";
  priority: "low" | "normal" | "high";
  status: DocumentTaskStatus;
  blocker_reason: string | null;
  due_at: string | null;
  escalation_at: string | null;
  assigned_to: string | null;
  assignee_name: string;
  assignee_role: string;
  client_id: string | null;
  client_business_name: string;
  deal_id: string | null;
  deal_reference: string | null;
  document_type: string;
  document_status: "missing" | "submitted" | "rejected" | "accepted" | "waived";
  is_submission_blocker: boolean;
  submission_blocking_reason: string | null;
  updated_at: string;
};

export type DocumentTaskAssignee = { profile_id: string; display_name: string; role: string };

function taskKey(uid: string | null) {
  return ["role-document-task-workspace", uid] as const;
}

export function useRoleDocumentTasks() {
  const session = useSession();
  const uid = session?.user.id ?? null;
  return useQuery({
    queryKey: taskKey(uid),
    enabled: Boolean(uid),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("role_document_task_workspace");
      if (error) throw error;
      return (data ?? []) as RoleDocumentTask[];
    },
  });
}

export function useDocumentTaskAssignees(enabled: boolean) {
  return useQuery({
    queryKey: ["document-task-assignees"],
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("owner_document_task_assignees");
      if (error) throw error;
      return (data ?? []) as DocumentTaskAssignee[];
    },
  });
}

export function useSetDocumentTaskStatus() {
  const session = useSession();
  const uid = session?.user.id ?? null;
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ taskId, status, blockerReason }: { taskId: string; status: Exclude<DocumentTaskStatus, "cancelled">; blockerReason?: string }) => {
      const { error } = await supabase.rpc("role_set_document_task_status", {
        p_task_id: taskId,
        p_status: status,
        p_blocker_reason: blockerReason?.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: taskKey(uid) }),
  });
}

export function useReassignDocumentTask() {
  const session = useSession();
  const uid = session?.user.id ?? null;
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ taskId, assignedTo, dueAt, priority }: { taskId: string; assignedTo: string; dueAt?: string | null; priority?: RoleDocumentTask["priority"] }) => {
      const { error } = await supabase.rpc("owner_reassign_document_task", {
        p_task_id: taskId,
        p_assigned_to: assignedTo,
        p_due_at: dueAt || null,
        p_priority: priority || null,
      });
      if (error) throw error;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: taskKey(uid) }),
  });
}
