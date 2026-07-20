import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, Plus, Pencil, Trash2, ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { useFunders, type Funder } from "@/hooks/useFunders";
import {
  useRateStructures,
  useSaveRateStructure,
  useDeleteRateStructure,
} from "@/hooks/useFunderCommissions";
import {
  DEAL_TYPES,
  RATE_TYPES,
  dealTypeLabel,
  rateTypeLabel,
  formatRateValue,
  isPercentRate,
  isActive,
  type RateStructure,
  type RateStructureInput,
  type DealType,
  type FunderRateType,
} from "@/lib/funderCommissions";

const fieldCls =
  "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-brand-navy outline-none focus:border-brand-teal focus:ring-2 focus:ring-brand-teal/20";
const labelCls = "block text-xs font-medium text-muted-foreground mb-1";
const errCls = "mt-1 text-xs text-red-600";
const btnPrimary =
  "inline-flex items-center gap-1.5 rounded-lg bg-brand-teal px-4 py-2 text-sm font-semibold text-white hover:bg-brand-teal/90 disabled:opacity-60";
const btnNeutral =
  "inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-brand-navy hover:bg-slate-50";

// The modal is opened either to add a rate for a funder, or edit an existing row.
type Editing =
  | { funder: Funder; row: null } // add
  | { funder: Funder; row: RateStructure }; // edit

export default function FundersSettingsPage() {
  const { data: funders, isLoading: fundersLoading } = useFunders();
  const { data: rates, isLoading: ratesLoading } = useRateStructures();
  const [editing, setEditing] = useState<Editing | null>(null);

  const activeFunders = useMemo(
    () => (funders ?? []).filter((f) => f.is_active),
    [funders],
  );

  // group rates by funder_id
  const ratesByFunder = useMemo(() => {
    const map = new Map<string, RateStructure[]>();
    for (const r of rates ?? []) {
      const list = map.get(r.funder_id) ?? [];
      list.push(r);
      map.set(r.funder_id, list);
    }
    return map;
  }, [rates]);

  const fundersWithRates = useMemo(
    () => activeFunders.filter((f) => (ratesByFunder.get(f.id)?.length ?? 0) > 0).length,
    [activeFunders, ratesByFunder],
  );

  if (fundersLoading || ratesLoading) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading funder rates…
      </div>
    );
  }

  return (
    <div className="max-w-5xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-brand-navy">Funder commission rates</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          What Fund Now Capital earns <strong>from each funder</strong> per signed broker agreement. These rates
          drive invoicing (C1) and honest commission calculations (C2). Rates are effective-dated — to change a
          funder's rate, <strong>close the current one</strong> (set an end date), then add the new one. Owner-only;
          never shown to partners.
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          {activeFunders.length} active funders · {fundersWithRates} with a rate set
        </p>
      </div>

      <div className="space-y-3">
        {activeFunders.map((f) => (
          <FunderRateCard
            key={f.id}
            funder={f}
            rows={ratesByFunder.get(f.id) ?? []}
            onAdd={() => setEditing({ funder: f, row: null })}
            onEdit={(row) => setEditing({ funder: f, row })}
          />
        ))}
        {activeFunders.length === 0 && (
          <p className="rounded-xl border border-border bg-white p-5 text-sm text-muted-foreground">
            No active funders. Add funders in the Funder panel first.
          </p>
        )}
      </div>

      {editing && (
        <RateFormModal
          funder={editing.funder}
          existing={editing.row}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function FunderRateCard({
  funder,
  rows,
  onAdd,
  onEdit,
}: {
  funder: Funder;
  rows: RateStructure[];
  onAdd: () => void;
  onEdit: (row: RateStructure) => void;
}) {
  const [showHistory, setShowHistory] = useState(false);
  const active = rows.filter(isActive);
  const history = rows.filter((r) => !isActive(r));

  return (
    <section className="rounded-xl border border-border bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-brand-navy">{funder.name}</h2>
        <button type="button" onClick={onAdd} className={btnPrimary}>
          <Plus className="h-4 w-4" /> Add rate
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No rate structure yet.</p>
      ) : (
        <div className="space-y-2">
          {active.map((r) => (
            <RateRow key={r.id} row={r} onEdit={() => onEdit(r)} />
          ))}
          {active.length === 0 && (
            <p className="text-sm text-amber-700">
              No active rate — all rates for this funder are closed. Add a current rate.
            </p>
          )}

          {history.length > 0 && (
            <div className="pt-1">
              <button
                type="button"
                onClick={() => setShowHistory((s) => !s)}
                className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-brand-navy"
              >
                {showHistory ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                {showHistory ? "Hide" : "Show"} closed rates ({history.length})
              </button>
              {showHistory && (
                <div className="mt-2 space-y-2 border-l-2 border-border pl-3">
                  {history.map((r) => (
                    <RateRow key={r.id} row={r} onEdit={() => onEdit(r)} muted />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function RateRow({ row, onEdit, muted }: { row: RateStructure; onEdit: () => void; muted?: boolean }) {
  return (
    <div
      className={
        "flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-border px-3 py-2 text-sm " +
        (muted ? "bg-slate-50 text-muted-foreground" : "bg-white text-brand-navy")
      }
    >
      <span className="min-w-[9rem] font-medium">{dealTypeLabel(row.deal_type)}</span>
      <span className="min-w-[5rem] font-semibold text-brand-teal">{formatRateValue(row)}</span>
      <span className="text-xs text-muted-foreground">{rateTypeLabel(row.rate_type)}</span>
      <span className="text-xs">
        {formatDate(row.effective_from)} →{" "}
        {row.effective_to ? formatDate(row.effective_to) : <span className="text-brand-green font-medium">active</span>}
      </span>
      {row.contract_clause_ref && (
        <span className="text-xs text-muted-foreground">clause {row.contract_clause_ref}</span>
      )}
      <button type="button" onClick={onEdit} className="ml-auto text-muted-foreground hover:text-brand-navy" aria-label="Edit rate">
        <Pencil className="h-4 w-4" />
      </button>
    </div>
  );
}

// ---- add/edit modal ---------------------------------------------------------
// Form stack per project convention: react-hook-form + zod (mirrors
// StakeholdersPanel). Fields are strings; a superRefine enforces the
// rate_type-conditional rule (percent needs 0..100, flat needs >= 0) and the
// date order. Percent is entered/displayed as % (8.5), stored as a fraction
// (0.085). Rendering stays plain <input className={fieldCls}> — the repo's RHF
// forms don't use shadcn/ui Form components.
const DEAL_TYPE_VALUES = DEAL_TYPES.map((d) => d.value) as [DealType, ...DealType[]];
const RATE_TYPE_VALUES = RATE_TYPES.map((r) => r.value) as [FunderRateType, ...FunderRateType[]];

const rateFormSchema = z
  .object({
    deal_type: z.enum(DEAL_TYPE_VALUES),
    rate_type: z.enum(RATE_TYPE_VALUES),
    rate_percent: z.string(),
    flat_amount: z.string(),
    effective_from: z.string().min(1, "A start date is required."),
    effective_to: z.string(),
    contract_clause_ref: z.string(),
    notes: z.string(),
  })
  .superRefine((v, ctx) => {
    if (v.effective_to && v.effective_to <= v.effective_from) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["effective_to"], message: "The end date must be after the start date." });
    }
    if (isPercentRate(v.rate_type)) {
      const n = Number(v.rate_percent);
      if (v.rate_percent.trim() === "" || !Number.isFinite(n)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["rate_percent"], message: "Enter a percentage rate." });
      } else if (n < 0 || n > 100) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["rate_percent"], message: "The percentage must be between 0 and 100." });
      }
    } else {
      const n = Number(v.flat_amount);
      if (v.flat_amount.trim() === "" || !Number.isFinite(n)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["flat_amount"], message: "Enter a flat rand amount." });
      } else if (n < 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["flat_amount"], message: "The flat amount can't be negative." });
      }
    }
  });

type RateFormValues = z.infer<typeof rateFormSchema>;

function RateFormModal({
  funder,
  existing,
  onClose,
}: {
  funder: Funder;
  existing: RateStructure | null;
  onClose: () => void;
}) {
  const isEdit = existing !== null;
  const save = useSaveRateStructure();
  const del = useDeleteRateStructure();
  const [serverErr, setServerErr] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<RateFormValues>({
    resolver: zodResolver(rateFormSchema),
    defaultValues: {
      deal_type: existing?.deal_type ?? "non_po",
      rate_type: existing?.rate_type ?? "percent_of_gross_funded",
      rate_percent: existing?.rate_fraction != null ? String(Number(existing.rate_fraction) * 100) : "",
      flat_amount: existing?.flat_amount != null ? String(existing.flat_amount) : "",
      effective_from: existing?.effective_from ?? "",
      effective_to: existing?.effective_to ?? "",
      contract_clause_ref: existing?.contract_clause_ref ?? "",
      notes: existing?.notes ?? "",
    },
  });

  // Escape-to-dismiss (keyboard a11y).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const pct = isPercentRate(watch("rate_type"));

  const onSubmit = async (v: RateFormValues) => {
    setServerErr(null);
    const isPct = isPercentRate(v.rate_type);
    const input: RateStructureInput = {
      funder_id: funder.id,
      deal_type: v.deal_type,
      rate_type: v.rate_type,
      rate_fraction: isPct ? Number(v.rate_percent) / 100 : null,
      flat_amount: isPct ? null : Number(v.flat_amount),
      effective_from: v.effective_from,
      effective_to: v.effective_to.trim() || null,
      contract_clause_ref: v.contract_clause_ref.trim() || null,
      notes: v.notes.trim() || null,
    };
    try {
      await save.mutateAsync({ id: existing?.id, input });
      toast.success(isEdit ? "Rate updated" : "Rate added");
      onClose();
    } catch (e) {
      const msg = (e as Error).message || "Could not save the rate structure.";
      setServerErr(msg);
      toast.error(msg);
    }
  };

  const onDelete = async () => {
    if (!existing) return;
    if (!window.confirm("Delete this rate structure? This is for correcting a mistaken entry — it removes the row entirely.")) {
      return;
    }
    try {
      await del.mutateAsync(existing.id);
      toast.success("Rate deleted");
      onClose();
    } catch (e) {
      toast.error((e as Error).message || "Could not delete the rate structure.");
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-xl border border-border bg-white p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={isEdit ? "Edit funder rate" : "Add funder rate"}
      >
        <div>
          <h3 className="text-base font-semibold text-brand-navy">
            {isEdit ? "Edit rate" : "Add rate"} — {funder.name}
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Percentage rates are stored as a fraction and shown as %. To supersede an active rate, set its end date
            first, then add the new one.
          </p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className={labelCls} htmlFor="fcs-deal-type">Deal type</label>
              <select id="fcs-deal-type" className={fieldCls} {...register("deal_type")}>
                {DEAL_TYPES.map((d) => (
                  <option key={d.value} value={d.value}>{d.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className={labelCls} htmlFor="fcs-rate-type">Rate type</label>
              <select id="fcs-rate-type" className={fieldCls} {...register("rate_type")}>
                {RATE_TYPES.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </div>

            {pct ? (
              <div>
                <label className={labelCls} htmlFor="fcs-rate-percent">Rate (%)</label>
                <input
                  id="fcs-rate-percent"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  className={fieldCls}
                  placeholder="e.g. 8.5"
                  {...register("rate_percent")}
                />
                {errors.rate_percent && <p className={errCls}>{errors.rate_percent.message}</p>}
              </div>
            ) : (
              <div>
                <label className={labelCls} htmlFor="fcs-flat-amount">Flat amount (R)</label>
                <input
                  id="fcs-flat-amount"
                  type="number"
                  min="0"
                  step="0.01"
                  className={fieldCls}
                  placeholder="e.g. 5000"
                  {...register("flat_amount")}
                />
                {errors.flat_amount && <p className={errCls}>{errors.flat_amount.message}</p>}
              </div>
            )}

            <div>
              <label className={labelCls} htmlFor="fcs-clause">Contract clause ref</label>
              <input id="fcs-clause" className={fieldCls} placeholder="optional" {...register("contract_clause_ref")} />
            </div>

            <div>
              <label className={labelCls} htmlFor="fcs-from">Effective from</label>
              <input id="fcs-from" type="date" className={fieldCls} {...register("effective_from")} />
              {errors.effective_from && <p className={errCls}>{errors.effective_from.message}</p>}
            </div>

            <div>
              <label className={labelCls} htmlFor="fcs-to">Effective to</label>
              <input id="fcs-to" type="date" className={fieldCls} {...register("effective_to")} />
              {errors.effective_to ? (
                <p className={errCls}>{errors.effective_to.message}</p>
              ) : (
                <p className="mt-1 text-xs text-muted-foreground">Leave blank while the rate is active.</p>
              )}
            </div>

            <div className="sm:col-span-2">
              <label className={labelCls} htmlFor="fcs-notes">Notes</label>
              <textarea id="fcs-notes" rows={2} className={fieldCls} placeholder="optional" {...register("notes")} />
            </div>
          </div>

          {serverErr && <p className={errCls}>{serverErr}</p>}

          <div className="flex items-center justify-between gap-2 pt-1">
            <div>
              {isEdit && (
                <button
                  type="button"
                  onClick={onDelete}
                  disabled={del.isPending}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
                >
                  <Trash2 className="h-4 w-4" /> Delete
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={onClose} className={btnNeutral}>Cancel</button>
              <button type="submit" disabled={save.isPending} className={btnPrimary}>
                {save.isPending ? "Saving…" : isEdit ? "Save changes" : "Add rate"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

function formatDate(iso: string): string {
  // date column → yyyy-mm-dd; render en-ZA short.
  const d = new Date(iso + "T00:00:00");
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric" });
}
