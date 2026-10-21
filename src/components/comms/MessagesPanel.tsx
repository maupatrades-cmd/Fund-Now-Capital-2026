import { useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { useMsgContacts, useMsgThread, useMsgThreads, useReplyMessage, useSendMessage } from "@/hooks/useComms";

// Internal messages: conversations, one open conversation, and a new-message form. Who may write to whom, and
// the automatic copy to the Director on Sales Coordinator traffic, are decided by the database.
const fmt = (iso: string) => new Date(iso).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg", dateStyle: "medium", timeStyle: "short" });
const box = "rounded-2xl border border-border bg-white p-5 shadow-sm";
const area = "flex min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm";
const SAFE = "Do not type ID numbers, bank account numbers or salary details. Numbers of 9 or more digits are rejected.";
const err = (e: unknown) => (e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : "Something went wrong");

function Compose({ onSent }: { onSent: (threadId: string) => void }) {
  const contacts = useMsgContacts(true);
  const send = useSendMessage();
  const [to, setTo] = useState<string[]>([]);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const toggle = (id: string) => setTo((t) => (t.includes(id) ? t.filter((x) => x !== id) : [...t, id]));
  return (
    <form className={`${box} space-y-3`} onSubmit={(e) => {
      e.preventDefault();
      send.mutate({ to, subject, body }, {
        onSuccess: (t) => { toast.success("Sent"); setTo([]); setSubject(""); setBody(""); onSent(t); },
        onError: (x) => toast.error(err(x)),
      });
    }}>
      <h2 className="text-base font-bold text-brand-navy">New message</h2>
      <fieldset className="space-y-1">
        <legend className="text-sm font-semibold text-brand-navy">To</legend>
        {contacts.error ? <p role="alert" className="text-sm text-red-600">{err(contacts.error)}</p> : null}
        <div className="flex flex-wrap gap-2">
          {(contacts.data ?? []).map((c) => (
            <label key={c.profile_id} className={`cursor-pointer rounded-full border px-3 py-1 text-xs ${to.includes(c.profile_id) ? "border-brand-teal bg-teal-50" : "border-border"}`}>
              <input type="checkbox" className="sr-only" checked={to.includes(c.profile_id)} onChange={() => toggle(c.profile_id)} />
              {c.full_name ?? "Unnamed"} · {c.role_label}
            </label>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">Anything to or from the Sales Coordinator, and every message from an agent, sub-agent or Team Leader, is copied to the Director automatically.</p>
      </fieldset>
      <label className="block space-y-1 text-sm font-semibold text-brand-navy">Subject
        <Input maxLength={160} value={subject} onChange={(e) => setSubject(e.target.value)} />
      </label>
      <label className="block space-y-1 text-sm font-semibold text-brand-navy">Message
        <textarea className={area} maxLength={4000} value={body} onChange={(e) => setBody(e.target.value)} />
        <span className="block text-xs font-normal text-muted-foreground">{SAFE}</span>
      </label>
      <button type="submit" className="rounded-lg bg-brand-teal px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
        disabled={!to.length || subject.trim().length < 2 || !body.trim() || send.isPending}>Send</button>
    </form>
  );
}

function Conversation({ threadId }: { threadId: string }) {
  const thread = useMsgThread(threadId);
  const reply = useReplyMessage();
  const [body, setBody] = useState("");
  if (thread.error) return <p role="alert" className="text-sm text-red-600">{err(thread.error)}</p>;
  if (!thread.data) return <p className="text-sm text-muted-foreground">Loading…</p>;
  return (
    <div className={`${box} space-y-4`}>
      <h2 className="text-base font-bold text-brand-navy">{thread.data[0]?.subject ?? "(no subject)"}</h2>
      <ol className="space-y-3">
        {thread.data.map((m) => (
          <li key={m.message_id} className={`rounded-lg p-3 text-sm ${m.mine ? "bg-teal-50" : "bg-slate-50"}`}>
            <p className="text-xs text-muted-foreground">
              <span className="font-semibold text-brand-navy">{m.mine ? "You" : m.sender_name}</span> · {fmt(m.created_at)} · to{" "}
              {m.recipients.map((r) => `${r.name ?? "?"}${r.kind === "cc" ? (r.auto ? " (copy, automatic)" : " (copy)") : ""}`).join(", ")}
            </p>
            <p className="mt-1 whitespace-pre-line">{m.body}</p>
          </li>
        ))}
      </ol>
      <form className="space-y-2" onSubmit={(e) => {
        e.preventDefault();
        reply.mutate({ threadId, body }, { onSuccess: () => { setBody(""); toast.success("Reply sent"); }, onError: (x) => toast.error(err(x)) });
      }}>
        <textarea className={area} maxLength={4000} aria-label="Reply" placeholder="Reply to everyone in this conversation" value={body} onChange={(e) => setBody(e.target.value)} />
        <button type="submit" className="rounded-lg bg-brand-teal px-5 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={!body.trim() || reply.isPending}>Reply</button>
      </form>
    </div>
  );
}

export function MessagesPanel() {
  const threads = useMsgThreads();
  const [open, setOpen] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
      <section className={`${box} space-y-3`}>
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold text-brand-navy">Messages</h1>
          <button type="button" className="text-sm font-semibold text-brand-teal underline" onClick={() => { setComposing(true); setOpen(null); }}>New message</button>
        </div>
        {threads.error ? <p role="alert" className="text-sm text-red-600">{err(threads.error)}</p> : null}
        <ul className="divide-y divide-border">
          {(threads.data ?? []).map((t) => (
            <li key={t.thread_id}>
              <button type="button" className={`w-full py-3 text-left text-sm ${open === t.thread_id ? "font-semibold" : ""}`}
                onClick={() => { setOpen(t.thread_id); setComposing(false); }}>
                <span className="block text-brand-navy">
                  {t.subject ?? "(no subject)"}
                  {t.unread > 0 ? <span className="ml-2 rounded-full bg-brand-teal px-2 py-0.5 text-xs text-white">{t.unread}</span> : null}
                </span>
                <span className="block text-xs text-muted-foreground">{t.people ?? ""} · {t.last_from ?? ""} · {fmt(t.last_at)}</span>
              </button>
            </li>
          ))}
          {threads.data && threads.data.length === 0 ? <li className="py-3 text-sm text-muted-foreground">No messages yet.</li> : null}
        </ul>
      </section>
      <div>
        {composing ? <Compose onSent={(t) => { setComposing(false); setOpen(t); }} />
          : open ? <Conversation threadId={open} />
          : <p className="text-sm text-muted-foreground">Choose a conversation, or start a new message.</p>}
      </div>
    </div>
  );
}
