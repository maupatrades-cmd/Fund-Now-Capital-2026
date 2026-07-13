import { useNavigate, useParams, Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import {
  useFunder,
  useCreateFunder,
  useUpdateFunder,
  type FunderInput,
} from "@/hooks/useFunders";
import { AGREEMENT_STATUSES, FUNDER_TYPE_OPTIONS } from "@/lib/funders";

// Empty string / null -> null, otherwise a non-negative number.
const nullableAmount = z.preprocess(
  (v) => (v === "" || v == null ? null : Number(v)),
  z.number().nonnegative("Must be zero or more").nullable(),
);

const schema = z
  .object({
    name: z.string().trim().min(1, "Funder name is required"),
    display_name_for_partner: z
      .string()
      .trim()
      .min(1, "Partner display name is required"),
    funder_type: z.string().optional().default(""),
    agreement_status: z.string().optional().default(""),
    ticket_min: nullableAmount,
    ticket_max: nullableAmount,
    is_active: z.boolean(),
    notes: z.string().optional().default(""),
  })
  .refine(
    (d) => d.ticket_min == null || d.ticket_max == null || d.ticket_max >= d.ticket_min,
    { message: "Max must be greater than or equal to min", path: ["ticket_max"] },
  );

type FormValues = z.input<typeof schema>;

const inputCls =
  "w-full rounded-lg border border-border bg-white px-3 py-2.5 text-sm text-brand-navy outline-none focus:border-brand-teal focus:ring-2 focus:ring-brand-teal/20";
const labelCls = "block text-sm font-medium text-brand-navy mb-1.5";
const errCls = "mt-1 text-xs text-red-600";

export default function FunderFormPage() {
  const { id } = useParams();
  const isEdit = !!id;
  const navigate = useNavigate();
  const existing = useFunder(id);
  const createFunder = useCreateFunder();
  const updateFunder = useUpdateFunder();

  if (isEdit && existing.isLoading) {
    return <div className="text-sm text-muted-foreground">Loading…</div>;
  }

  const f = existing.data;
  const defaults: FormValues = {
    name: f?.name ?? "",
    display_name_for_partner: f?.display_name_for_partner ?? "",
    funder_type: f?.funder_type ?? "",
    agreement_status: f?.agreement_status ?? "",
    ticket_min: f?.ticket_min == null ? "" : String(f.ticket_min),
    ticket_max: f?.ticket_max == null ? "" : String(f.ticket_max),
    is_active: f?.is_active ?? true,
    notes: f?.notes ?? "",
  } as FormValues;

  return (
    <FunderForm
      key={f?.id ?? "new"}
      defaults={defaults}
      isEdit={isEdit}
      submitting={createFunder.isPending || updateFunder.isPending}
      onCancel={() => navigate(isEdit ? `/funders/${id}` : "/funders")}
      onSubmit={async (values) => {
        const input: FunderInput = {
          name: values.name!.trim(),
          display_name_for_partner: values.display_name_for_partner!.trim(),
          funder_type: values.funder_type ? values.funder_type : null,
          agreement_status: values.agreement_status ? values.agreement_status : null,
          ticket_min: (values.ticket_min as number | null) ?? null,
          ticket_max: (values.ticket_max as number | null) ?? null,
          is_active: values.is_active!,
          notes: values.notes ? values.notes : null,
        };
        try {
          if (isEdit) {
            await updateFunder.mutateAsync({ id: id!, input });
            toast.success("Funder updated");
            navigate(`/funders/${id}`);
          } else {
            const created = await createFunder.mutateAsync(input);
            toast.success("Funder added");
            navigate(`/funders/${created.id}`);
          }
        } catch (e) {
          toast.error((e as Error).message || "Could not save funder");
        }
      }}
    />
  );
}

function FunderForm({
  defaults,
  isEdit,
  submitting,
  onSubmit,
  onCancel,
}: {
  defaults: FormValues;
  isEdit: boolean;
  submitting: boolean;
  onSubmit: (v: FormValues) => void;
  onCancel: () => void;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: defaults });

  return (
    <div className="max-w-2xl space-y-4">
      <Link
        to="/funders"
        className="inline-flex items-center gap-1.5 text-sm text-brand-teal hover:underline"
      >
        <ArrowLeft className="h-4 w-4" /> Back to funders
      </Link>

      <form
        onSubmit={handleSubmit(onSubmit)}
        className="space-y-5 rounded-xl border border-border bg-white p-6 shadow-sm"
      >
        <h2 className="text-lg font-semibold text-brand-navy">
          {isEdit ? "Edit funder" : "Add funder"}
        </h2>

        <div>
          <label className={labelCls} htmlFor="name">
            Funder name <span className="text-muted-foreground">(real — owner only)</span>
          </label>
          <input id="name" className={inputCls} {...register("name")} />
          {errors.name && <p className={errCls}>{errors.name.message}</p>}
        </div>

        <div>
          <label className={labelCls} htmlFor="display_name_for_partner">
            Partner display name <span className="text-muted-foreground">(fictional)</span>
          </label>
          <input
            id="display_name_for_partner"
            className={inputCls}
            {...register("display_name_for_partner")}
          />
          {errors.display_name_for_partner && (
            <p className={errCls}>{errors.display_name_for_partner.message}</p>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelCls} htmlFor="funder_type">
              Product type
            </label>
            <select id="funder_type" className={inputCls} {...register("funder_type")}>
              <option value="">—</option>
              {FUNDER_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls} htmlFor="agreement_status">
              Agreement status
            </label>
            <select
              id="agreement_status"
              className={inputCls}
              {...register("agreement_status")}
            >
              <option value="">—</option>
              {AGREEMENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s[0].toUpperCase() + s.slice(1)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelCls} htmlFor="ticket_min">
              Ticket min (R)
            </label>
            <input
              id="ticket_min"
              type="number"
              min="0"
              step="1000"
              className={inputCls}
              {...register("ticket_min")}
            />
            {errors.ticket_min && <p className={errCls}>{errors.ticket_min.message}</p>}
          </div>
          <div>
            <label className={labelCls} htmlFor="ticket_max">
              Ticket max (R)
            </label>
            <input
              id="ticket_max"
              type="number"
              min="0"
              step="1000"
              className={inputCls}
              {...register("ticket_max")}
            />
            {errors.ticket_max && <p className={errCls}>{errors.ticket_max.message}</p>}
          </div>
        </div>

        <div>
          <label className={labelCls} htmlFor="notes">
            Notes
          </label>
          <textarea id="notes" rows={3} className={inputCls} {...register("notes")} />
        </div>

        <label className="flex items-center gap-2 text-sm text-brand-navy">
          <input type="checkbox" className="h-4 w-4 accent-brand-teal" {...register("is_active")} />
          Active funder
        </label>

        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={submitting}
            className="rounded-lg bg-brand-teal px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-teal/90 disabled:opacity-60"
          >
            {submitting ? "Saving…" : isEdit ? "Save changes" : "Add funder"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-border px-5 py-2.5 text-sm font-medium text-brand-navy hover:bg-slate-50"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
