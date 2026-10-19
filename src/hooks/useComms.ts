import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

// Administrator batch 3 (owner spec §8–9): notices with a "Needs attention" acknowledgement, and internal
// messages (the Director is copied on everything the Sales Coordinator sends or receives). Every read and
// write goes through a role-checked database function; the tables have no grants.

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data as T;
}

export type NoticeAudience = "staff" | "sub_agents" | "team_leaders";
export type MyNotice = {
  notice_id: string; title: string; body: string; needs_attention: boolean; posted_by: string | null;
  created_at: string; acknowledged_at: string | null;
};
export type NoticeBoardRow = {
  notice_id: string; title: string; needs_attention: boolean; audience: NoticeAudience[]; posted_by: string | null;
  created_at: string; recipients: number; acknowledged: number; outstanding: string[];
};

export function useMyNotices() {
  return useQuery({ queryKey: ["my-notices"], queryFn: () => rpc<MyNotice[]>("my_notices") });
}
export function useNoticeBoard(enabled: boolean) {
  return useQuery({ queryKey: ["notice-board"], enabled, queryFn: () => rpc<NoticeBoardRow[]>("staff_notice_board") });
}
export function usePostNotice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (i: { title: string; body: string; needsAttention: boolean; audience: NoticeAudience[] }) =>
      rpc<string>("staff_post_notice", { p_title: i.title, p_body: i.body, p_needs_attention: i.needsAttention, p_audience: i.audience })
        .then((id) => { if (!id) throw new Error("The notice was not posted"); return id; }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["notice-board"] }); },
  });
}
export function useAcknowledgeNotice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (noticeId: string) =>
      rpc<string | null>("acknowledge_notice", { p_notice_id: noticeId })
        .then((at) => { if (!at) throw new Error("The notice was not acknowledged"); return at; }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["my-notices"] }); },
  });
}

export type MsgContact = { profile_id: string; full_name: string | null; role_label: string };
export type MsgThread = { thread_id: string; subject: string | null; last_at: string; last_from: string | null; unread: number; people: string | null };
export type MsgMessage = {
  message_id: string; sender_name: string | null; sender_role: string; subject: string | null; body: string; created_at: string;
  recipients: { name: string | null; kind: "to" | "cc"; auto: boolean }[]; mine: boolean;
};

export function useMsgContacts(enabled: boolean) {
  return useQuery({ queryKey: ["msg-contacts"], enabled, staleTime: 5 * 60_000, queryFn: () => rpc<MsgContact[]>("msg_contacts") });
}
export function useMsgThreads() {
  return useQuery({ queryKey: ["msg-threads"], queryFn: () => rpc<MsgThread[]>("msg_threads") });
}
export function useMsgThread(threadId: string | null) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: ["msg-thread", threadId], enabled: !!threadId,
    // Opening a conversation marks it read, so refresh the unread counts afterwards.
    queryFn: () => rpc<MsgMessage[]>("msg_thread", { p_thread: threadId }).then((rows) => {
      void qc.invalidateQueries({ queryKey: ["msg-threads"] });
      return rows;
    }),
  });
}
export function useSendMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (i: { to: string[]; subject: string; body: string }) =>
      rpc<string>("msg_send", { p_to: i.to, p_subject: i.subject, p_body: i.body })
        .then((t) => { if (!t) throw new Error("The message was not sent"); return t; }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["msg-threads"] }); },
  });
}
export function useReplyMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (i: { threadId: string; body: string }) =>
      rpc<string>("msg_reply", { p_thread: i.threadId, p_body: i.body })
        .then((m) => { if (!m) throw new Error("The reply was not sent"); return m; }),
    onSuccess: (_m, i) => {
      void qc.invalidateQueries({ queryKey: ["msg-thread", i.threadId] });
      void qc.invalidateQueries({ queryKey: ["msg-threads"] });
    },
  });
}
