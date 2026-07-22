import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { FileText, Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { formatZAR } from "@/lib/format";
import { Modal } from "@/components/ui/modal";
import { InvoiceStateChip } from "@/components/invoices/InvoiceStateChip";
import { useRateStructures } from "@/hooks/useFunderCommissions";
import {
  useDealInvoices,
  useFundableSubmissions,
  useGenerateInvoice,
  type FundableSubmission,
} from "@/hooks/useInvoices";
import {
  computeInvoicePreview,
  formatInvoiceDate,
  rateFromSnapshot,
  resolveEffectiveRate,
  toNum,
  todaySastISO,
  type InvoicePreview,
} from "@/lib/invoices";
import type { DealType } from "@/lib/funderCommissions";

const primaryBtn =
  "rounded-lg bg-brand-teal px-4 py-2 text-sm font-semibold text-white hover:bg-brand-teal/90 disabled:opacity-60";
const secondaryBtn =
  "rounded-lg border border-border px-4 py-2 text-sm font-medium text-brand-navy hover:bg-slate-50";
const inputCls =
  "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:border-brand-teal focus:ring-2 focus:ring-brand-teal/20";

function funderName(s: FundableSubmission): string {
  return s.funder?.name ?? "Unknown funder";
}

// Invoices section on the deal-detail page. Lists this deal's invoices and, for
// each funded submission without an active invoice, offers a Generate button →
// preview modal → generate_funder_invoice. Only meaningful once the deal is
// Funded (the RPC + button gate on amount_funded).
export function DealInvoices({
  dealId,
  clientId,
  isPurchaseOrder,
  stage,
}: {
  dealId: string;
  clientId: string;
  isPurchaseOrder: boolean;
  stage: string;
}) {
  const { data: invoices, isLoading, isError: invoicesError } = useDealInvoices(dealId);
  const { data: submissions, isError: submissionsError } = useFundableSubmissions(dealId);
  const [generateFor, setGenerateFor] = useState<FundableSubmission | null>(null);

  // Close any open Generate modal when navigating to a different deal (the parent
  // route reuses this component for a cached deal without unmounting it), so a
  // stale submission from deal A can't be previewed/invoiced against B's
  // dealId/clientId. Mirrors DealDetailPage's reset-on-:id pattern.
  useEffect(() => {
    setGenerateFor(null);
  }, [dealId]);

  // A failed fetch must not masquerade as "no invoices" (silent empty state).
  const hasError = invoicesError || submissionsError;

  const dealType: DealType = isPurchaseOrder ? "po" : "non_po";

  // Submission ids that already have a non-void invoice — not offered again
  // (the DB unique index enforces one active invoice per submission anyway).
  const invoicedSubmissionIds = useMemo(
    () => new Set((invoices ?? []).filter((i) => i.state !== "void").map((i) => i.deal_funder_submission_id)),
    [invoices],
  );

  // Fundable = deal is Funded (or already Invoiced), the submission has an
  // amount_funded, and it has no active invoice yet. Issuing the first invoice
  // advances the deal Funded → Invoiced, so `invoiced` must stay eligible or a
  // multi-funder deal would lose the Generate button for its remaining
  // submissions after the first issue. Finance-charge completeness is handled
  // inside the modal (the only place a submission's finance charge is captured).
  const fundable = useMemo(
    () =>
      (submissions ?? []).filter(
        (s) =>
          (stage === "funded" || stage === "invoiced") &&
          s.amount_funded != null &&
          !invoicedSubmissionIds.has(s.id),
      ),
    [submissions, stage, invoicedSubmissionIds],
  );

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-brand-navy">Invoices</h3>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : hasError ? (
        <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          Couldn't load this deal's invoices. Refresh the page to try again.
        </p>
      ) : invoices && invoices.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2 font-semibold">Invoice</th>
                <th className="px-3 py-2 font-semibold">Funder</th>
                <th className="px-3 py-2 font-semibold">Total</th>
                <th className="px-3 py-2 font-semibold">State</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2 font-medium text-brand-navy">{inv.invoice_number}</td>
                  <td className="px-3 py-2 text-muted-foreground">{inv.funder?.name ?? "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground">{formatZAR(inv.total_amount, { cents: true })}</td>
                  <td className="px-3 py-2">
                    <InvoiceStateChip state={inv.state} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Link to={`/invoices/${inv.id}`} className="text-sm font-medium text-brand-teal hover:underline">
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {stage === "funded"
            ? "No invoices yet for this deal."
            : "Invoices become available once the deal is Funded."}
        </p>
      )}

      {!hasError && fundable.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {fundable.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setGenerateFor(s)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-brand-teal/40 bg-brand-teal/5 px-3 py-2 text-sm font-medium text-brand-teal hover:bg-brand-teal/10"
            >
              <Plus className="h-4 w-4" /> Generate invoice — {funderName(s)}
            </button>
          ))}
        </div>
      )}

      {generateFor && (
        <GenerateInvoiceModal
          submission={generateFor}
          dealId={dealId}
          clientId={clientId}
          dealType={dealType}
          onClose={() => setGenerateFor(null)}
        />
      )}
    </div>
  );
}

function GenerateInvoiceModal({
  submission,
  dealId,
  clientId,
  dealType,
  onClose,
}: {
  submission: FundableSubmission;
  dealId: string;
  clientId: string;
  dealType: DealType;
  onClose: () => void;
}) {
  const { data: rates } = useRateStructures();
  const generate = useGenerateInvoice();

  // Client short_code + business name for the payment-reference preview.
  const {
    data: client,
    isLoading: clientLoading,
    isError: clientError,
  } = useQuery({
    queryKey: ["client-short-info", clientId],
    queryFn: async (): Promise<{ business_name: string; short_code: string | null }> => {
      const { data, error } = await supabase
        .from("clients")
        .select("business_name, short_code")
        .eq("id", clientId)
        .single();
      if (error) throw error;
      return data as { business_name: string; short_code: string | null };
    },
  });

  // approval pins the rate (S7A): as-of = approved_at ?? funded_at ?? today.
  const asOf =
    submission.approved_at?.slice(0, 10) ??
    submission.funded_at?.slice(0, 10) ??
    todaySastISO();
  // Snapshot-first, exactly like generate_funder_invoice: prefer the submission's
  // applied_rate_snapshot; fall back to the live effective rate only when there's
  // no snapshot (the case in production today). Keeps the preview in agreement
  // with the invoice the RPC actually creates.
  const rate = useMemo(
    () =>
      rateFromSnapshot(submission.applied_rate_snapshot) ??
      resolveEffectiveRate(rates, submission.funder_id, dealType, asOf),
    [rates, submission.applied_rate_snapshot, submission.funder_id, dealType, asOf],
  );

  const isFinanceChargeRate = rate?.rate_type === "percent_of_finance_charge";
  const [financeCharge, setFinanceCharge] = useState<string>(
    submission.finance_charge_amount != null ? String(toNum(submission.finance_charge_amount)) : "",
  );
  const financeChargeNum =
    financeCharge.trim() === "" ? null : Number(financeCharge);

  const preview: InvoicePreview = useMemo(
    () =>
      computeInvoicePreview({
        rate,
        amountFunded: toNum(submission.amount_funded),
        financeCharge: financeChargeNum != null && Number.isFinite(financeChargeNum) ? financeChargeNum : null,
        funderName: submission.funder?.name ?? "the funder",
        funderShort: submission.funder?.short_code ?? null,
        clientBusinessName: client?.business_name ?? "the client",
        clientShort: client?.short_code ?? null,
      }),
    [rate, submission, financeChargeNum, client],
  );

  // Require the client record to be loaded before generating — otherwise the
  // preview (and the created invoice's description / payment reference) would be
  // built on the "the client" / null-short-code placeholders while the query is
  // still in flight or has errored.
  const canGenerate = preview.ok && !!client;

  const doGenerate = async () => {
    if (!preview.ok) return;
    try {
      // One source of truth: if the finance charge was entered/changed in the
      // modal, persist it back to the submission before generating (row-count
      // checked per the silent-RLS rule).
      const enteredFc = financeChargeNum != null && Number.isFinite(financeChargeNum) ? financeChargeNum : null;
      // Compare against the raw stored value (null-aware). toNum(null) === 0 would
      // make entering 0 against a stored null look unchanged, skip the update, and
      // leave the column null while the RPC invoices a 0 charge — breaking the
      // single source of truth.
      const storedFc =
        submission.finance_charge_amount != null ? toNum(submission.finance_charge_amount) : null;
      if (isFinanceChargeRate && enteredFc !== storedFc) {
        const { data, error } = await supabase
          .from("deal_funder_submissions")
          .update({ finance_charge_amount: enteredFc })
          .eq("id", submission.id)
          .select("id");
        if (error) throw error;
        if (!data || data.length !== 1) throw new Error("Finance charge was not saved (no row written).");
      }

      const result = await generate.mutateAsync({
        submissionId: submission.id,
        dealId,
        financeCharge: enteredFc,
      });
      const num = (result as { invoice_number?: string }).invoice_number;
      const created = (result as { was_created?: boolean }).was_created;
      toast.success(created === false ? `Invoice ${num ?? ""} already exists` : `Draft ${num ?? "invoice"} created`);
      onClose();
    } catch (e) {
      toast.error((e as Error).message || "Could not generate the invoice");
    }
  };

  return (
    <Modal title="Generate draft invoice" onClose={onClose} maxWidth="max-w-lg">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <FileText className="h-4 w-4 text-brand-teal" />
        Preview for <span className="font-medium text-brand-navy">{submission.funder?.name}</span> —{" "}
        {client?.business_name ?? "client"}
      </div>

      {clientLoading && <p className="text-xs text-muted-foreground">Loading client details…</p>}
      {clientError && (
        <p className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">
          Couldn't load client details — refresh before generating.
        </p>
      )}

      {isFinanceChargeRate && (
        <div>
          <label className="mb-1 block text-xs font-medium text-brand-navy">
            Finance charge on the facility (R)
          </label>
          <input
            type="number"
            min="0"
            step="0.01"
            className={inputCls}
            value={financeCharge}
            onChange={(e) => setFinanceCharge(e.target.value)}
            placeholder="Enter the client's finance charge"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            This funder's commission is a % of the finance charge — required to invoice.
          </p>
        </div>
      )}

      {preview.ok ? (
        <dl className="space-y-2 rounded-lg border border-border bg-slate-50 p-4 text-sm">
          <Row label="Facility advanced" value={formatZAR(preview.facilityAdvanced, { cents: true })} />
          {preview.rateType === "percent_of_finance_charge" && (
            <Row label="Finance charge" value={preview.financeCharge != null ? formatZAR(preview.financeCharge, { cents: true }) : "—"} />
          )}
          <Row label="Rate" value={`${preview.rateDisplay} of the ${preview.basis}`} />
          <Row label="Lead Provider Commission" value={formatZAR(preview.commission, { cents: true })} />
          <Row label="VAT" value="Not VAT registered" />
          <div className="border-t border-border pt-2">
            <Row label="Total due" value={formatZAR(preview.total, { cents: true })} strong />
          </div>
          <Row label="Payment terms" value={preview.paymentTerms} />
          <Row label="Due date" value={formatInvoiceDate(preview.dueDate)} />
          <Row label="Payment reference" value={preview.paymentReferencePattern} />
          <div className="border-t border-border pt-2">
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Description</dt>
            <dd className="mt-1 text-sm text-brand-navy">{preview.description}</dd>
          </div>
          <p className="pt-1 text-xs text-muted-foreground">
            The invoice number (####) is assigned when the draft is created. Final figures are recomputed
            and the rate snapshotted server-side on generate.
          </p>
        </dl>
      ) : (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          {preview.reason}
        </div>
      )}

      <div className="flex items-center gap-2">
        <button type="button" className={primaryBtn} disabled={!canGenerate || generate.isPending} onClick={doGenerate}>
          {generate.isPending ? "Generating…" : "Generate draft invoice"}
        </button>
        <button type="button" className={secondaryBtn} onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={strong ? "font-semibold text-brand-navy" : "font-medium text-brand-navy"}>{value}</dd>
    </div>
  );
}
