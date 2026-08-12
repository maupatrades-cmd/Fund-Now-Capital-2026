import { useMemo, useState, type FormEvent } from "react";
import { ArrowLeft, Loader2, LockKeyhole, MessageCircle, Plus, Send } from "lucide-react";
import { toast } from "sonner";
import {
  useClientMessageWorkspace,
  useSendClientPortalMessage,
  type ClientMessageThread,
} from "@/hooks/useClientPortalMessages";

const fieldClass =
  "w-full rounded-xl border border-white/12 bg-white/[0.055] px-3 py-2.5 text-sm text-white outline-none placeholder:text-white/30 focus:border-[#6ec144]/55 focus:ring-2 focus:ring-[#6ec144]/15";

function formatWhen(value: string) {
  return new Intl.DateTimeFormat("en-ZA", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default function ClientMessagesPanel() {
  const workspace = useClientMessageWorkspace();
  const send = useSendClientPortalMessage();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [subject, setSubject] = useState("");
  const [dealId, setDealId] = useState("");
  const [body, setBody] = useState("");
  const selected = useMemo(
    () => workspace.data?.threads.find((thread) => thread.id === selectedId) ?? null,
    [selectedId, workspace.data?.threads],
  );

  const resetComposer = () => {
    setBody("");
    setSubject("");
    setDealId("");
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const message = body.trim();
    if (!message) return;
    try {
      const threadId = await send.mutateAsync(
        selected
          ? { threadId: selected.id, body: message }
          : { subject: subject.trim(), dealId: dealId || undefined, body: message },
      );
      resetComposer();
      setCreating(false);
      setSelectedId(threadId);
      toast.success("Message sent securely");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not send your message");
    }
  };

  if (workspace.isLoading) {
    return <p className="mt-5 flex items-center gap-2 text-sm text-white/50"><Loader2 className="h-4 w-4 animate-spin" /> Loading your conversations…</p>;
  }

  if (workspace.isError) {
    return <p role="alert" className="mt-5 text-sm text-red-200">Could not load secure messages: {workspace.error.message}</p>;
  }

  if (selected || creating) {
    return (
      <div className="mt-5">
        <button type="button" onClick={() => { setSelectedId(null); setCreating(false); resetComposer(); }} className="inline-flex items-center gap-2 text-xs font-bold text-white/55 hover:text-white">
          <ArrowLeft className="h-3.5 w-3.5" /> All conversations
        </button>
        <h3 className="mt-4 text-base font-extrabold">{selected?.subject ?? "New conversation"}</h3>

        {selected ? (
          <ol className="mt-4 max-h-80 space-y-3 overflow-y-auto pr-1" aria-label="Conversation messages">
            {selected.messages.map((message) => (
              <li key={message.id} className={`flex ${message.senderKind === "client" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[88%] rounded-2xl px-4 py-3 text-sm leading-6 ${message.senderKind === "client" ? "bg-[#6ec144] text-[#06131d]" : "border border-white/10 bg-white/[0.06] text-white/80"}`}>
                  <p className="whitespace-pre-wrap break-words">{message.body}</p>
                  <p className={`mt-1 text-[10px] ${message.senderKind === "client" ? "text-[#06131d]/55" : "text-white/35"}`}>{formatWhen(message.createdAt)}</p>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-bold text-white/60">Subject
              <input value={subject} onChange={(event) => setSubject(event.target.value)} maxLength={160} required minLength={3} className={`${fieldClass} mt-1.5`} placeholder="How can we help?" />
            </label>
            <label className="text-xs font-bold text-white/60">Funding application (optional)
              <select value={dealId} onChange={(event) => setDealId(event.target.value)} className={`${fieldClass} mt-1.5`}>
                <option value="" className="text-slate-900">General support</option>
                {workspace.data?.deals.map((deal) => <option key={deal.id} value={deal.id} className="text-slate-900">{deal.reference ?? "Funding application"}</option>)}
              </select>
            </label>
          </div>
        )}

        {selected?.status === "closed" ? (
          <p className="mt-4 rounded-xl border border-white/10 bg-white/5 p-3 text-xs text-white/45">This conversation is closed. Start a new conversation if you still need help.</p>
        ) : (
          <form onSubmit={submit} className="mt-4">
            <label className="text-xs font-bold text-white/60">Message
              <textarea value={body} onChange={(event) => setBody(event.target.value)} rows={4} maxLength={5000} required className={`${fieldClass} mt-1.5 resize-y`} placeholder="Write your message to Fund Now Capital…" />
            </label>
            <div className="mt-3 flex items-center justify-between gap-3">
              <span className="inline-flex items-center gap-1.5 text-[10px] text-white/35"><LockKeyhole className="h-3 w-3" /> Visible to your linked business and FNC Owner</span>
              <button type="submit" disabled={send.isPending || !body.trim() || (!selected && subject.trim().length < 3)} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-[#6ec144] px-4 text-xs font-extrabold text-[#06131d] disabled:opacity-45">
                {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send
              </button>
            </div>
          </form>
        )}
      </div>
    );
  }

  const threads = workspace.data?.threads ?? [];
  return (
    <div className="mt-5">
      <button type="button" onClick={() => setCreating(true)} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-[#6ec144] px-4 text-xs font-extrabold text-[#06131d]">
        <Plus className="h-4 w-4" /> New conversation
      </button>
      {threads.length ? (
        <ol className="mt-4 space-y-2" aria-label="Secure conversations">
          {threads.map((thread: ClientMessageThread) => (
            <li key={thread.id}>
              <button type="button" onClick={() => setSelectedId(thread.id)} className="flex w-full items-center gap-3 rounded-2xl border border-white/9 bg-white/[0.035] p-3 text-left transition hover:border-white/18 hover:bg-white/[0.06]">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#2ca8a8]/15 text-[#7fd4e8]"><MessageCircle className="h-4 w-4" /></span>
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold">{thread.subject}</span><span className="mt-1 block text-[10px] text-white/35">Updated {formatWhen(thread.updated_at)}</span></span>
                <span className="rounded-full border border-white/10 px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-white/40">{thread.status}</span>
              </button>
            </li>
          ))}
        </ol>
      ) : <p className="mt-4 text-sm leading-6 text-white/45">No conversations yet. Start one whenever you need help with your application or paperwork.</p>}
    </div>
  );
}
