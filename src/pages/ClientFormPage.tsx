import { Link, useNavigate, useParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import {
  useClient,
  useCreateClient,
  useUpdateClient,
  useReferralPartners,
  type ClientInput,
} from "@/hooks/useClients";

const nullableAmount = z.preprocess(
  (v) => (v === "" || v == null ? null : Number(v)),
  z.number().nonnegative("Must be zero or more").nullable(),
);

const schema = z.object({
  business_name: z.string().trim().min(1, "Business name is required"),
  cipc_number: z.string().optional().default(""),
  sector: z.string().optional().default(""),
  monthly_turnover: nullableAmount,
  address: z.string().optional().default(""),
  referral_partner_id: z.string().optional().default(""), // "" = Self
  notes: z.string().optional().default(""),
});

type FormValues = z.input<typeof schema>;

const inputCls =
  "w-full rounded-lg border border-border bg-white px-3 py-2.5 text-sm text-brand-navy outline-none focus:border-brand-teal focus:ring-2 focus:ring-brand-teal/20";
const labelCls = "block text-sm font-medium text-brand-navy mb-1.5";
const errCls = "mt-1 text-xs text-red-600";

export default function ClientFormPage() {
  const { id } = useParams();
  const isEdit = !!id;
  const navigate = useNavigate();
  const existing = useClient(id);
  const partners = useReferralPartners();
  const createClient = useCreateClient();
  const updateClient = useUpdateClient();

  if (isEdit && existing.isLoading) {
    return <div className="text-sm text-muted-foreground">Loading…</div>;
  }

  const c = existing.data;
  const defaults: FormValues = {
    business_name: c?.business_name ?? "",
    cipc_number: c?.cipc_number ?? "",
    sector: c?.sector ?? "",
    monthly_turnover: c?.monthly_turnover == null ? "" : String(c.monthly_turnover),
    address: c?.address ?? "",
    referral_partner_id: c?.referral_partner_id ?? "",
    notes: c?.notes ?? "",
  } as FormValues;

  return (
    <ClientForm
      key={c?.id ?? "new"}
      defaults={defaults}
      isEdit={isEdit}
      partners={partners.data ?? []}
      submitting={createClient.isPending || updateClient.isPending}
      onCancel={() => navigate(isEdit ? `/clients/${id}` : "/clients")}
      onSubmit={async (values) => {
        const input: ClientInput = {
          business_name: values.business_name!.trim(),
          cipc_number: values.cipc_number ? values.cipc_number : null,
          sector: values.sector ? values.sector : null,
          monthly_turnover: (values.monthly_turnover as number | null) ?? null,
          address: values.address ? values.address : null,
          referral_partner_id: values.referral_partner_id ? values.referral_partner_id : null,
          notes: values.notes ? values.notes : null,
        };
        try {
          if (isEdit) {
            await updateClient.mutateAsync({ id: id!, input });
            toast.success("Client updated");
            navigate(`/clients/${id}`);
          } else {
            const created = await createClient.mutateAsync(input);
            toast.success("Client added — you can add contacts and documents now");
            navigate(`/clients/${created.id}`);
          }
        } catch (e) {
          toast.error((e as Error).message || "Could not save client");
        }
      }}
    />
  );
}

function ClientForm({
  defaults,
  isEdit,
  partners,
  submitting,
  onSubmit,
  onCancel,
}: {
  defaults: FormValues;
  isEdit: boolean;
  partners: { id: string; name: string }[];
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
      <Link to="/clients" className="inline-flex items-center gap-1.5 text-sm text-brand-teal hover:underline">
        <ArrowLeft className="h-4 w-4" /> Back to clients
      </Link>

      <form
        onSubmit={handleSubmit(onSubmit)}
        className="space-y-5 rounded-xl border border-border bg-white p-6 shadow-sm"
      >
        <h2 className="text-lg font-semibold text-brand-navy">
          {isEdit ? "Edit client" : "Add client"}
        </h2>

        <div>
          <label className={labelCls} htmlFor="business_name">
            Business name
          </label>
          <input id="business_name" className={inputCls} {...register("business_name")} />
          {errors.business_name && <p className={errCls}>{errors.business_name.message}</p>}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelCls} htmlFor="cipc_number">
              CIPC number
            </label>
            <input id="cipc_number" className={inputCls} {...register("cipc_number")} />
          </div>
          <div>
            <label className={labelCls} htmlFor="sector">
              Sector
            </label>
            <input
              id="sector"
              className={inputCls}
              placeholder="e.g. Retail, Construction"
              {...register("sector")}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelCls} htmlFor="monthly_turnover">
              Monthly turnover (R)
            </label>
            <input
              id="monthly_turnover"
              type="number"
              min="0"
              step="1000"
              className={inputCls}
              {...register("monthly_turnover")}
            />
            {errors.monthly_turnover && <p className={errCls}>{errors.monthly_turnover.message}</p>}
          </div>
          <div>
            <label className={labelCls} htmlFor="referral_partner_id">
              Referred by
            </label>
            <select id="referral_partner_id" className={inputCls} {...register("referral_partner_id")}>
              <option value="">Self</option>
              {partners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className={labelCls} htmlFor="address">
            Address
          </label>
          <textarea id="address" rows={2} className={inputCls} {...register("address")} />
        </div>

        <div>
          <label className={labelCls} htmlFor="notes">
            Notes
          </label>
          <textarea id="notes" rows={3} className={inputCls} {...register("notes")} />
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={submitting}
            className="rounded-lg bg-brand-teal px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-teal/90 disabled:opacity-60"
          >
            {submitting ? "Saving…" : isEdit ? "Save changes" : "Add client"}
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
