import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { CommissionBreakdownView } from "@/components/deals/CommissionBreakdownView";
import { useFunderOptions } from "@/hooks/useDeals";
import {
  useDealSubmissions,
  useSaveSubmission,
  useDeleteSubmission,
  funderName,
  type DealSubmission,
  type SubmissionInput,
} from "@/hooks/useDealDetail";
import { SUBMISSION_STATUSES, submissionStatusLabel, SUBMISSION_STATUS_BADGE } from "@/lib/deals";
import { formatZAR } from "@/lib/format";

const cls =
  "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:border-brand-teal focus:ring-2 focus:ring-brand-teal/20";
const errCls = "mt-1 text-xs text-red-600";

const nullableAmount = z.preprocess(
  (v) => (v === "" || v == null ? null : Number(v)),
  z.number().finite("Enter a valid amount").nonnegative("Must be zero or more").nullable(),
);

const submissionSchema = z.object({
  funder_id: z.string().min(1, "Choose a funder"),
  status: z.string().min(1),
  submitted_at: z.string().optional().default(""),
  quote_amount: nullableAmount,
  offered_commission: nullableAmount,
  notes: z.string().optional().default(""),
});
type SubmissionValues = z.input<typeof submissionSchema>;

export function FunderSubmissions({
  dealId,
  isPurchaseOrder,
}: {
  dealId: string;
  isPurchaseOrder: boolean;
}) {
  const { data: submissions, isLoading } = useDealSubmissions(dealId);
  const del = useDeleteSubmission();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<DealSubmission | null>(null);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-brand-navy">Funder submissions</h3>
        {!adding && !editing && (
          <button
            type="button"
            onClick={() => setAdding(true)}
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
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => { setAdding(false); setEditing(s); }}
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
    </div>
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
    },
  });

  const offeredRaw = watch("offered_commission");
  const gross =
    offeredRaw === "" || offeredRaw == null || !Number.isFinite(Number(offeredRaw))
      ? null
      : Number(offeredRaw);

  const onSubmit = async (v: SubmissionValues) => {
    const input: SubmissionInput = {
      funder_id: v.funder_id as string,
      status: v.status as string,
      submitted_at: v.submitted_at ? new Date(v.submitted_at as string).toISOString() : null,
      quote_amount: (v.quote_amount as number | null) ?? null,
      offered_commission: (v.offered_commission as number | null) ?? null,
      notes: (v.notes as string) ? (v.notes as string) : null,
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
