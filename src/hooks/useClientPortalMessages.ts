import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export type ClientPortalMessage = {
  id: string;
  senderKind: "client" | "owner";
  body: string;
  createdAt: string;
};

export type ClientMessageThread = {
  id: string;
  deal_id: string | null;
  subject: string;
  status: "open" | "closed";
  created_at: string;
  updated_at: string;
  messages: ClientPortalMessage[];
};

export type ClientMessageDeal = {
  id: string;
  reference: string | null;
  stage: string;
};

type ClientMessageWorkspace = {
  deals: ClientMessageDeal[];
  threads: ClientMessageThread[];
};

export function useClientMessageWorkspace() {
  return useQuery({
    queryKey: ["client-message-workspace"],
    queryFn: async (): Promise<ClientMessageWorkspace> => {
      const { data, error } = await supabase.rpc("client_portal_message_workspace");
      if (error) throw error;
      const workspace = data as Partial<ClientMessageWorkspace> | null;
      return {
        deals: Array.isArray(workspace?.deals) ? workspace.deals : [],
        threads: Array.isArray(workspace?.threads) ? workspace.threads : [],
      };
    },
  });
}

export function useSendClientPortalMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      body,
      threadId,
      dealId,
      subject,
    }: {
      body: string;
      threadId?: string;
      dealId?: string;
      subject?: string;
    }) => {
      const { data, error } = await supabase.rpc("client_send_portal_message", {
        p_body: body,
        p_thread_id: threadId ?? null,
        p_deal_id: dealId ?? null,
        p_subject: subject ?? null,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["client-message-workspace"] }),
  });
}
