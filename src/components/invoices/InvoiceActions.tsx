import { useState } from "react";
import { toast } from "sonner";
import { Modal } from "@/components/ui/modal";
import { formatZAR } from "@/lib/format";
import { toNum } from "@/lib/invoices";
import type { InvoiceDetail } from "@/hooks/useInvoices";
import {
  useIssueInvoice,
  useMarkInvoicePaid,
  useUpdateDraftInvoice,
  useVoidInvoice,
} from "@/hooks/useInvoices";

const inputCls =
  "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:border-brand-teal focus:ring-2 focus:ring-brand-teal/20";
const primaryBtn =
  "rounded-lg bg-brand-teal px-4 py-2 text-sm font-semibold text-white hover:bg-brand-teal/90 disabled:opacity-60";
const secondaryBtn =
  "rounded-lg border border-border px-4 py-2 text-sm font-medium text-brand-navy hover:bg-slate-50";
const dangerBtn =
  "rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60";

type ModalKind = "edit" | "issue" | "paid" | "void" | null;

// State-driven action buttons + their modals for a single invoice. Rendered on
// the invoice detail page. Paid/void invoices are read-only (no buttons).
export function InvoiceActions({ invoice }: { invoice: InvoiceDetail }) {
  const [modal, setModal] = useState<ModalKind>(null);
  const close = () => setModal(null);

  const isDraft = invoice.state === "draft";
  const isOpen = invoice.state === "issued" || invoice.state === "overdue";
  const hasActions = isDraft || isOpen;

  if (!hasActions) {
    return (
      <p className="text-sm text-muted-foreground">
        This invoice is {invoice.state === "paid" ? "paid" : "void"} — no further actions.
      </p>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {isDraft && (
          <>
            <button type="button" className={primaryBtn} onClick={() => setModal("issue")}>
              Issue invoice
            </button>
            <button type="button" className={secondaryBtn} onClick={() => setModal("edit")}>
              Edit
            </button>
          </>
        )}
        {isOpen && (
          <button type="button" className={primaryBtn} onClick={() => setModal("paid")}>
            Mark as paid
          </button>
        )}
        <button type="button" className={dangerBtn} onClick={() => setModal("void")}>
          Void
        </button>
      </div>

      {modal === "edit" && <EditModal invoice={invoice} onClose={close} />}
      {modal === "issue" && <IssueModal invoice={invoice} onClose={close} />}
      {modal === "paid" && <PaidModal invoice={invoice} onClose={close} />}
      {modal === "void" && <VoidModal invoice={invoice} onClose={close} />}
    </>
  );
}

function EditModal({ invoice, onClose }: { invoice: InvoiceDetail; onClose: () => void }) {
  const [description, setDescription] = useState(invoice.commission_description);
  const [notes, setNotes] = useState(invoice.notes ?? "");
  const update = useUpdateDraftInvoice();

  const save = async () => {
    if (!description.trim()) {
      toast.error("The commission description can't be empty.");
      return;
    }
    try {
      await update.mutateAsync({
        invoiceId: invoice.id,
        dealId: invoice.deal_id,
        description: description.trim(),
        notes: notes.trim() ? notes.trim() : null,
      });
      toast.success("Draft invoice updated");
      onClose();
    } catch (e) {
      toast.error((e as Error).message || "Could not update the invoice");
    }
  };

  return (
    <Modal title="Edit draft invoice" onClose={onClose} maxWidth="max-w-lg">
      <p className="text-sm text-muted-foreground">
        Only the commission description and notes can be edited. Amounts, the rate, and the payment
        reference are fixed at generation.
      </p>
      <div>
        <label className="mb-1 block text-xs font-medium text-brand-navy">Commission description</label>
        <textarea rows={4} className={inputCls} value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-brand-navy">
          Notes <span className="font-normal text-muted-foreground">(internal, optional)</span>
        </label>
        <textarea rows={2} className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <div className="flex items-center gap-2">
        <button type="button" className={primaryBtn} disabled={update.isPending} onClick={save}>
          {update.isPending ? "Saving…" : "Save changes"}
        </button>
        <button type="button" className={secondaryBtn} onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

function IssueModal({ invoice, onClose }: { invoice: InvoiceDetail; onClose: () => void }) {
  const issue = useIssueInvoice();

  const confirm = async () => {
    try {
      await issue.mutateAsync({ invoiceId: invoice.id, dealId: invoice.deal_id });
      toast.success(`Invoice ${invoice.invoice_number} issued`);
      onClose();
    } catch (e) {
      toast.error((e as Error).message || "Could not issue the invoice");
    }
  };

  return (
    <Modal title="Issue invoice?" onClose={onClose}>
      <p className="text-sm text-muted-foreground">
        Issuing generates the branded PDF, notifies the owner, and moves the deal to{" "}
        <span className="font-medium text-brand-navy">Invoiced</span>. The invoice can still be voided
        afterwards (with confirmation), but its number and amounts are final.
      </p>
      <div className="flex items-center gap-2">
        <button type="button" className={primaryBtn} disabled={issue.isPending} onClick={confirm}>
          {issue.isPending ? "Issuing…" : "Yes, issue"}
        </button>
        <button type="button" className={secondaryBtn} onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

function PaidModal({ invoice, onClose }: { invoice: InvoiceDetail; onClose: () => void }) {
  const [amount, setAmount] = useState(String(toNum(invoice.total_amount)));
  const [reference, setReference] = useState(invoice.payment_reference_expected ?? "");
  const mark = useMarkInvoicePaid();

  const save = async () => {
    const paidAmount = Number(amount);
    if (!Number.isFinite(paidAmount) || paidAmount <= 0) {
      toast.error("Enter a valid amount received.");
      return;
    }
    try {
      await mark.mutateAsync({
        invoiceId: invoice.id,
        dealId: invoice.deal_id,
        paidAmount,
        paymentReference: reference.trim() ? reference.trim() : null,
      });
      toast.success(`Invoice ${invoice.invoice_number} marked paid`);
      onClose();
    } catch (e) {
      toast.error((e as Error).message || "Could not mark the invoice paid");
    }
  };

  return (
    <Modal title="Mark invoice as paid" onClose={onClose}>
      <div>
        <label className="mb-1 block text-xs font-medium text-brand-navy">Amount received (R)</label>
        <input type="number" min="0" step="0.01" className={inputCls} value={amount} onChange={(e) => setAmount(e.target.value)} />
        <p className="mt-1 text-xs text-muted-foreground">Invoice total: {formatZAR(invoice.total_amount, { cents: true })}</p>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-brand-navy">Payment reference received</label>
        <input type="text" className={inputCls} value={reference} onChange={(e) => setReference(e.target.value)} placeholder={invoice.payment_reference_expected ?? ""} />
        <p className="mt-1 text-xs text-muted-foreground">Expected: {invoice.payment_reference_expected}</p>
      </div>
      <div className="flex items-center gap-2">
        <button type="button" className={primaryBtn} disabled={mark.isPending} onClick={save}>
          {mark.isPending ? "Saving…" : "Confirm payment"}
        </button>
        <button type="button" className={secondaryBtn} onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

function VoidModal({ invoice, onClose }: { invoice: InvoiceDetail; onClose: () => void }) {
  // Voiding an already-issued invoice requires typing OVERRIDE (mirrors the RPC).
  const requiresOverride = invoice.state === "issued" || invoice.state === "overdue";
  const [override, setOverride] = useState("");
  const [reason, setReason] = useState("");
  const voidInvoice = useVoidInvoice();

  const confirm = async () => {
    if (requiresOverride && override.trim() !== "OVERRIDE") {
      toast.error("Type OVERRIDE (in capitals) to void an issued invoice.");
      return;
    }
    try {
      await voidInvoice.mutateAsync({
        invoiceId: invoice.id,
        dealId: invoice.deal_id,
        override: requiresOverride ? override.trim() : null,
        reason: reason.trim() ? reason.trim() : null,
      });
      toast.success(`Invoice ${invoice.invoice_number} voided`);
      onClose();
    } catch (e) {
      toast.error((e as Error).message || "Could not void the invoice");
    }
  };

  return (
    <Modal title="Void invoice" onClose={onClose}>
      <p className="text-sm text-muted-foreground">
        Voiding is permanent — the invoice number is retired and the submission can be re-invoiced.
        {requiresOverride
          ? " This invoice has already been issued, so type OVERRIDE to confirm."
          : ""}
      </p>
      <div>
        <label className="mb-1 block text-xs font-medium text-brand-navy">
          Reason <span className="font-normal text-muted-foreground">(optional, recorded in notes)</span>
        </label>
        <textarea rows={2} className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this invoice being voided?" />
      </div>
      {requiresOverride && (
        <div>
          <label className="mb-1 block text-xs font-medium text-brand-navy">Type OVERRIDE to confirm</label>
          <input type="text" className={inputCls} value={override} onChange={(e) => setOverride(e.target.value)} placeholder="OVERRIDE" />
        </div>
      )}
      <div className="flex items-center gap-2">
        <button type="button" className={dangerBtn} disabled={voidInvoice.isPending} onClick={confirm}>
          {voidInvoice.isPending ? "Voiding…" : "Void invoice"}
        </button>
        <button type="button" className={secondaryBtn} onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}
