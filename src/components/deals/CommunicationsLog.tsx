import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import { useDealCommunications, useAddCommunication } from "@/hooks/useDealDetail";
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
  const [open, setOpen] = useState(false);
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
    </div>
  );
}
