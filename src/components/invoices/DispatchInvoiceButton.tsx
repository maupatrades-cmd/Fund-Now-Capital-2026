import { useState } from "react";
import { Send, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Modal } from "@/components/ui/modal";
import { useQueueInvoiceDispatch, type InvoiceDispatch } from "@/hooks/useInvoiceDispatches";

const inputClass =
  "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:border-brand-teal focus:ring-2 focus:ring-brand-teal/20";

export function DispatchInvoiceButton({
  invoiceId,
  invoiceNumber,
  previousAttempt,
}: {
  invoiceId: string;
  invoiceNumber: string;
  previousAttempt: InvoiceDispatch | null;
}) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState(previousAttempt?.recipient_email ?? "");
  const [name, setName] = useState(previousAttempt?.recipient_name ?? "");
  const queue = useQueueInvoiceDispatch();
  const retryable = previousAttempt?.status === "failed" || previousAttempt?.status === "bounced";

  const submit = async () => {
    const recipientEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) {
      toast.error("Enter a valid funder billing email.");
      return;
    }
    try {
      await queue.mutateAsync({
        invoiceId,
        recipientEmail,
        recipientName: name.trim() || null,
        retryOf: retryable ? previousAttempt.id : null,
      });
      toast.success(retryable ? "Invoice retry queued" : "Invoice email queued");
      setOpen(false);
    } catch (error) {
      toast.error((error as Error).message || "Could not queue the invoice email");
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg bg-brand-teal px-3 py-2 text-xs font-semibold text-white hover:bg-brand-teal/90"
      >
        {retryable ? <RotateCcw className="h-3.5 w-3.5" /> : <Send className="h-3.5 w-3.5" />}
        {retryable ? "Retry email" : "Queue email"}
      </button>
      {open ? (
        <Modal title={`${retryable ? "Retry" : "Send"} ${invoiceNumber}`} onClose={() => setOpen(false)}>
          <p className="text-sm text-muted-foreground">
            This records an idempotent dispatch attempt in the invoice delivery ledger. The delivery worker sends the issued PDF.
          </p>
          <div>
            <label className="mb-1 block text-xs font-medium text-brand-navy">Funder billing email</label>
            <input className={inputClass} type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-brand-navy">Recipient name (optional)</label>
            <input className={inputClass} value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={queue.isPending}
              onClick={() => void submit()}
              className="rounded-lg bg-brand-teal px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {queue.isPending ? "Queuing…" : retryable ? "Queue retry" : "Queue invoice email"}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-border px-4 py-2 text-sm font-medium">
              Cancel
            </button>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
