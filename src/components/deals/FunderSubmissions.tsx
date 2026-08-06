import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Banknote, Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { CommissionBreakdownView } from "@/components/deals/CommissionBreakdownView";
import { useFunderOptions } from "@/hooks/useDeals";
import {
  useDealSubmissions,
  useSaveSubmission,
  useDeleteSubmission,
  useRecordSubmissionFunding,
  funderName,
  type DealSubmission,
  type SubmissionInput,
} from "@/hooks/useDealDetail";
import { SUBMISSION_STATUSES, submissionStatusLabel, SUBMISSION_STATUS_BADGE, DECLINE_REASONS } from "@/lib/deals";
import { formatZAR } from "@/lib/format";
import type { DealStage } from "@/lib/dealStages";

const cls =
  "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:border-brand-teal focus:ring-2 focus:ring-brand-teal/20";
const errCls = "mt-1 text-xs text-red-600";

const nullableAmount = z.preprocess(
  (v) => (v === "" || v == null ? null : Number(v)),
  z.number().finite("Enter a valid amount").nonnegative("Must be zero or more").nullable(),
);

const submissionSchema = z
  .object({
    funder_id: z.string().min(1, "Choose a funder"),
    status: z.string().min(1),
    submitted_at: z.string().optional().default(""),
    quote_amount: nullableAmount,
    offered_commission: nullableAmount,
    notes: z.string().optional().default(""),
    decline_reason_category: z.string().optional().default(""),
    decline_notes_internal: z.string().optional().default(""),
  })
  // A declined submission must carry a partner-safe reason category. The
  // database CHECK is the source of truth; this mirrors it for a friendly error.
  .superRefine((val, ctx) => {
    if (val.status === "declined" && !val.decline_reason_category) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["decline_reason_category"],
        message: "Pick a decline reason",
      });
    }
  });
type SubmissionValues = z.input<typeof submissionSchema>;

const fundingSchema = z.object({
  amount_funded: z.preprocess(
    (v) => Number(v),
    z.number().finite("Enter a valid amount").positive("Amount must be more than zero"),
  ),
  funded_at: z.string().min(1, "Choose the funding date"),
  finance_charge_amount: nullableAmount,
});
type FundingValues = z.input<typeof fundingSchema>;

export function FunderSubmissions({
  dealId,
  isPurchaseOrder,
  dealStage,
}: {
  dealId: string;
  isPurchaseOrder: boolean;
  dealStage: DealStage;
}) {
  const { data: submissions, isLoading } = useDealSubmissions(dealId);
  const del = useDeleteSubmission();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<DealSubmission | null>(null);
  const [recordingFunding, setRecordingFunding] = useState<DealSubmission | null>(null);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-brand-navy">Funder submissions</h3>
        {!adding && !editing && !recordingFunding && (
          <button
            type="button"
            onClick={() => { setRecordingFunding(null); setAdding(true); }}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-teal hover:underline"
          >
            <Plus className="h-4 w-4" /> Add submission
          </button>
        )}
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : submissions && submissions.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2 font-semibold">Funder</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 font-semibold">Quote</th>
                <th className="px-3 py-2 font-semibold">Offered comm.</th>
                <th className="px-3 py-2 font-semibold">Funded</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {submissions.map((s) => (
                <tr key={s.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2 font-medium text-brand-navy">{funderName(s)}</td>
                  <td className="px-3 py-2">
                    <Badge className={SUBMISSION_STATUS_BADGE[s.status] ?? "bg-slate-100 text-slate-600 ring-slate-500/20"}>
                      {submissionStatusLabel(s.status)}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {s.quote_amount != null ? formatZAR(s.quote_amount) : "—"}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {s.offered_commission != null ? formatZAR(s.offered_commission) : "—"}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {s.amount_funded != null ? (
                      <div>
                        <span className="font-medium text-green-700">{formatZAR(s.amount_funded)}</span>
                        {s.funded_at && <div className="text-xs">{new Date(s.funded_at).toLocaleDateString("en-ZA")}</div>}
                      </div>
                    ) : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-2">
                      {s.amount_funded == null && s.status !== "declined" && (
                        <button
                          type="button"
                          onClick={() => { setAdding(false); setEditing(null); setRecordingFunding(s); }}
                          className="inline-flex items-center gap-1 rounded-md border border-green-200 px-2 py-1 text-xs font-medium text-green-700 hover:bg-green-50"
                          aria-label={`Record funding from ${funderName(s)}`}
                        >
                          <Banknote className="h-3.5 w-3.5" /> Record funding
                        </button>
                      )}
                      {s.amount_funded == null && (
                        <>
                          <button
                            type="button"
                            onClick={() => { setAdding(false); setRecordingFunding(null); setEditing(s); }}
                            className="text-muted-foreground hover:text-brand-navy"
                            aria-label="Edit submission"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => del.mutate({ id: s.id, dealId })}
                            className="text-muted-foreground hover:text-red-600"
                            aria-label="Delete submission"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        !adding && <p className="text-sm text-muted-foreground">No funder submissions yet.</p>
      )}

      {(adding || editing) && (
        <div className="mt-3">
          <SubmissionForm
            key={editing?.id ?? "new"}
            dealId={dealId}
            isPurchaseOrder={isPurchaseOrder}
            submission={editing ?? undefined}
            onDone={() => { setAdding(false); setEditing(null); }}
            onCancel={() => { setAdding(false); setEditing(null); }}
          />
        </div>
      )}

      {recordingFunding && (
        <div className="mt-3">
          <RecordFundingForm
            dealId={dealId}
            dealStage={dealStage}
            submission={recordingFunding}
            onDone={() => setRecordingFunding(null)}
            onCancel={() => setRecordingFunding(null)}
          />
        </div>
      )}
    </div>
  );
}

function RecordFundingForm({
  dealId,
  dealStage,
  submission,
  onDone,
  onCancel,
}: {
  dealId: string;
  dealStage: DealStage;
  submission: DealSubmission;
  onDone: () => void;
  onCancel: () => void;
}) {
  const recordFunding = useRecordSubmissionFunding();
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FundingValues>({
    resolver: zodResolver(fundingSchema),
    defaultValues: {
      amount_funded: "",
      funded_at: today,
      finance_charge_amount: "",
    },
  });

  const onSubmit = async (values: FundingValues) => {
    try {
      await recordFunding.mutateAsync({
        dealId,
        submissionId: submission.id,
        funderId: submission.funder_id,
        dealStage,
        amountFunded: values.amount_funded as number,
        fundedAt: new Date(`${values.funded_at as string}T12:00:00+02:00`).toISOString(),
        financeCharge: (values.finance_charge_amount as number | null) ?? null,
      });
      toast.success("Funding recorded. This submission is now ready for invoice generation.");
      onDone();
    } catch (error) {
      toast.error((error as Error).message || "Could not record funding");
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-3 rounded-lg border border-green-300 bg-green-50/60 p-4">
      <div>
        <h4 className="text-sm font-semibold text-brand-navy">Record actual funding from {funderName(submission)}</h4>
        <p className="mt-1 text-xs text-muted-foreground">
          Enter the amount actually disbursed, not the requested or quoted amount. Saving unlocks invoice generation.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-brand-navy">Amount funded (R)</label>
          <input type="number" min="0.01" step="0.01" className={cls} {...register("amount_funded")} />
          {errors.amount_funded && <p className={errCls}>{errors.amount_funded.message}</p>}
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-brand-navy">Funding date</label>
          <input type="date" className={cls} {...register("funded_at")} />
          {errors.funded_at && <p className={errCls}>{errors.funded_at.message}</p>}
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-brand-navy">Finance charge (R, optional)</label>
          <input type="number" min="0" step="0.01" className={cls} {...register("finance_charge_amount")} />
          {errors.finance_charge_amount && <p className={errCls}>{errors.finance_charge_amount.message}</p>}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800 disabled:opacity-60"
        >
          {isSubmitting ? "Recording…" : "Confirm funding"}
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-border bg-white px-4 py-2 text-sm text-brand-navy hover:bg-slate-50">
          Cancel
        </button>
      </div>
    </form>
  );
}

function SubmissionForm({
  dealId,
  isPurchaseOrder,
  submission,
  onDone,
  onCancel,
}: {
  dealId: string;
  isPurchaseOrder: boolean;
  submission?: DealSubmission;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { data: funders } = useFunderOptions();
  const save = useSaveSubmission();
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<SubmissionValues>({
    resolver: zodResolver(submissionSchema),
    defaultValues: {
      funder_id: submission?.funder_id ?? "",
      status: submission?.status ?? "submitted",
      submitted_at: submission?.submitted_at ? submission.submitted_at.slice(0, 10) : "",
      quote_amount: submission?.quote_amount != null ? String(submission.quote_amount) : "",
      offered_commission: submission?.offered_commission != null ? String(submission.offered_commission) : "",
      notes: submission?.notes ?? "",
      decline_reason_category: submission?.decline_reason_category ?? "",
      decline_notes_internal: submission?.decline_notes_internal ?? "",
    },
  });

  const statusValue = watch("status");
  const offeredRaw = watch("offered_commission");
  const gross =
    offeredRaw === "" || offeredRaw == null || !Number.isFinite(Number(offeredRaw))
      ? null
      : Number(offeredRaw);

  const onSubmit = async (v: SubmissionValues) => {
    const declined = v.status === "declined";
    const input: SubmissionInput = {
      funder_id: v.funder_id as string,
      status: v.status as string,
      submitted_at: v.submitted_at ? new Date(v.submitted_at as string).toISOString() : null,
      quote_amount: (v.quote_amount as number | null) ?? null,
      offered_commission: (v.offered_commission as number | null) ?? null,
      notes: (v.notes as string) ? (v.notes as string) : null,
      // Only persist decline detail when the submission is actually declined.
      decline_reason_category: declined ? (v.decline_reason_category as string) || null : null,
      decline_notes_internal: declined ? (v.decline_notes_internal as string) || null : null,
    };
    try {
      await save.mutateAsync({ dealId, submissionId: submission?.id, input });
      toast.success(submission ? "Submission updated" : "Submission added");
      onDone();
    } catch (e) {
      toast.error((e as Error).message || "Could not save submission");
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-3 rounded-lg border border-brand-teal/40 bg-slate-50 p-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-brand-navy mb-1">Funder</label>
          <select className={cls} {...register("funder_id")}>
            <option value="">Select funder…</option>
            {(funders ?? []).map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
          {errors.funder_id && <p className={errCls}>{errors.funder_id.message}</p>}
        </div>
        <div>
          <label className="block text-xs font-medium text-brand-navy mb-1">Status</label>
          <select className={cls} {...register("status")}>
            {SUBMISSION_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-brand-navy mb-1">Submitted date</label>
          <input type="date" className={cls} {...register("submitted_at")} />
        </div>
        <div>
          <label className="block text-xs font-medium text-brand-navy mb-1">Quote amount (R)</label>
          <input type="number" min="0" step="1000" className={cls} {...register("quote_amount")} />
          {errors.quote_amount && <p className={errCls}>{errors.quote_amount.message}</p>}
        </div>
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-brand-navy mb-1">
            Offered commission (R) — gross for the split
          </label>
          <input type="number" min="0" step="100" className={cls} {...register("offered_commission")} />
          {errors.offered_commission && <p className={errCls}>{errors.offered_commission.message}</p>}
        </div>
      </div>

      {/* Decline detail — only when the funder declined this submission.
          Category is partner-safe; internal notes are owner-only. */}
      {statusValue === "declined" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-lg border border-red-200 bg-red-50/60 p-3">
          <div>
            <label className="block text-xs font-medium text-brand-navy mb-1">
              Decline reason <span className="font-normal text-muted-foreground">(partner-safe)</span>
            </label>
            <select className={cls} {...register("decline_reason_category")}>
              <option value="">Select reason…</option>
              {DECLINE_REASONS.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
            {errors.decline_reason_category && (
              <p className={errCls}>{errors.decline_reason_category.message}</p>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-brand-navy mb-1">
              Internal notes <span className="font-normal text-muted-foreground">(owner-only)</span>
            </label>
            <textarea
              className={cls}
              rows={2}
              placeholder="What the funder actually said — never shown to the partner"
              {...register("decline_notes_internal")}
            />
          </div>
        </div>
      )}

      {/* Embedded commission calculator (server-side function) */}
      <div className="rounded-lg border border-border bg-white p-3">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Commission split {isPurchaseOrder ? "(PO deal)" : ""}
        </p>
        <CommissionBreakdownView gross={gross} isPurchaseOrder={isPurchaseOrder} />
      </div>

      <textarea className={cls} rows={2} placeholder="Notes" {...register("notes")} />

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-lg bg-brand-teal px-4 py-2 text-sm font-semibold text-white hover:bg-brand-teal/90 disabled:opacity-60"
        >
          {isSubmitting ? "Saving…" : submission ? "Save" : "Add"}
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-border px-4 py-2 text-sm text-brand-navy hover:bg-white">
          Cancel
        </button>
      </div>
    </form>
  );
}
