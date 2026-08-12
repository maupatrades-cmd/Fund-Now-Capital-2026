import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, MessageSquare, Send } from "lucide-react";
import { toast } from "sonner";
import {
  useDealCommunications,
  useAddCommunication,
  useDealPortalMessages,
  useReplyToClientPortalMessage,
} from "@/hooks/useDealDetail";
import { formatRelative } from "@/lib/format";

const CHANNELS = ["note", "call", "email", "whatsapp", "meeting"];
const cls =
  "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:border-brand-teal focus:ring-2 focus:ring-brand-teal/20";
const errCls = "text-xs text-red-600";

const schema = z
  .object({
    channel: z.string().min(1),
    subject: z.string().optional().default(""),
    body: z.string().optional().default(""),
  })
  .refine((v) => Boolean(v.subject?.trim() || v.body?.trim()), {
    message: "Add a subject or note",
    path: ["subject"],
  });
type FormValues = z.input<typeof schema>;

export function CommunicationsLog({
  dealId,
  clientId,
  referralPartnerId,
}: {
  dealId: string;
  clientId: string | null;
  referralPartnerId: string | null;
}) {
  const { data: comms, isLoading } = useDealCommunications(dealId);
  const add = useAddCommunication();
  const portal = useDealPortalMessages(dealId);
  const reply = useReplyToClientPortalMessage();
  const [open, setOpen] = useState(false);
  const [replyByThread, setReplyByThread] = useState<Record<string, string>>({});
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { channel: "note", subject: "", body: "" },
  });

  const onSubmit = async (v: FormValues) => {
    try {
      await add.mutateAsync({
        dealId,
        clientId,
        referralPartnerId,
        channel: v.channel as string,
        subject: (v.subject as string) ?? "",
        body: (v.body as string) ?? "",
      });
      reset({ channel: "note", subject: "", body: "" });
      setOpen(false);
    } catch (e) {
      toast.error((e as Error).message || "Could not log");
    }
  };

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-brand-navy">Communications</h3>
        {!open && (
          <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-teal hover:underline">
            <Plus className="h-4 w-4" /> Log
          </button>
        )}
      </div>

      {open && (
        <form onSubmit={handleSubmit(onSubmit)} className="mb-3 space-y-2 rounded-lg border border-brand-teal/40 bg-slate-50 p-3">
          <div className="flex gap-2">
            <select className={cls + " max-w-[140px]"} {...register("channel")}>
              {CHANNELS.map((c) => (
                <option key={c} value={c}>{c[0].toUpperCase() + c.slice(1)}</option>
              ))}
            </select>
            <input className={cls} placeholder="Subject" {...register("subject")} />
          </div>
          {errors.subject && <p className={errCls}>{errors.subject.message}</p>}
          <textarea className={cls} rows={2} placeholder="Details" {...register("body")} />
          <div className="flex items-center gap-2">
            <button type="submit" disabled={isSubmitting} className="rounded-lg bg-brand-teal px-4 py-2 text-sm font-semibold text-white hover:bg-brand-teal/90 disabled:opacity-60">
              {isSubmitting ? "Saving…" : "Save"}
            </button>
            <button type="button" onClick={() => { reset(); setOpen(false); }} className="rounded-lg border border-border px-4 py-2 text-sm text-brand-navy hover:bg-white">Cancel</button>
          </div>
        </form>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : comms && comms.length > 0 ? (
        <ul className="space-y-2">
          {comms.map((c) => (
            <li key={c.id} className="flex items-start gap-2.5 rounded-lg border border-border p-2.5">
              <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-brand-teal" />
              <div className="min-w-0 flex-1">
                <div className="text-sm text-brand-navy">{c.subject || c.body || c.channel}</div>
                {c.subject && c.body && <div className="text-xs text-muted-foreground truncate">{c.body}</div>}
                <div className="text-[11px] text-muted-foreground">
                  {c.channel} · {formatRelative(c.occurred_at)}
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No communications logged.</p>
      )}

      <div className="mt-5 border-t border-border pt-4">
        <h4 className="text-sm font-semibold text-brand-navy">Client portal inbox</h4>
        <p className="mt-1 text-xs text-muted-foreground">Only messages explicitly shared through the secure portal appear here. Internal communications remain private.</p>
        {portal.isLoading ? <p className="mt-3 text-sm text-muted-foreground">Loading portal messages…</p> : null}
        {portal.isError ? <p role="alert" className="mt-3 text-sm text-red-600">Could not load portal messages: {portal.error.message}</p> : null}
        {portal.data?.length ? (
          <ul className="mt-3 space-y-3">
            {portal.data.map((thread) => (
              <li key={thread.id} className="rounded-lg border border-border p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-brand-navy">{thread.subject}</p>
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{thread.status}</span>
                </div>
                <ol className="mt-3 space-y-2">
                  {[...thread.client_portal_messages]
                    .sort((a, b) => a.created_at.localeCompare(b.created_at))
                    .map((message) => (
                      <li key={message.id} className={`rounded-lg p-2.5 text-sm ${message.sender_kind === "owner" ? "ml-6 bg-brand-teal/10" : "mr-6 bg-slate-100"}`}>
                        <p className="whitespace-pre-wrap break-words text-brand-navy">{message.body}</p>
                        <p className="mt-1 text-[10px] text-muted-foreground">{message.sender_kind === "owner" ? "FNC Owner" : "Client"} · {formatRelative(message.created_at)}</p>
                      </li>
                    ))}
                </ol>
                {thread.status === "open" ? (
                  <form
                    className="mt-3 flex gap-2"
                    onSubmit={async (event) => {
                      event.preventDefault();
                      const body = (replyByThread[thread.id] ?? "").trim();
                      if (!body) return;
                      try {
                        await reply.mutateAsync({ threadId: thread.id, dealId, body });
                        setReplyByThread((current) => ({ ...current, [thread.id]: "" }));
                        toast.success("Reply sent to the client portal");
                      } catch (error) {
                        toast.error(error instanceof Error ? error.message : "Could not send reply");
                      }
                    }}
                  >
                    <input
                      value={replyByThread[thread.id] ?? ""}
                      onChange={(event) => setReplyByThread((current) => ({ ...current, [thread.id]: event.target.value }))}
                      maxLength={5000}
                      className={cls}
                      placeholder="Reply to the client…"
                      aria-label={`Reply to ${thread.subject}`}
                    />
                    <button type="submit" disabled={reply.isPending || !(replyByThread[thread.id] ?? "").trim()} className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand-teal text-white disabled:opacity-50" aria-label="Send portal reply">
                      <Send className="h-4 w-4" />
                    </button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        ) : portal.isSuccess ? <p className="mt-3 text-sm text-muted-foreground">No client portal conversations for this deal.</p> : null}
      </div>
    </div>
  );
}
