import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { X } from "lucide-react";
import { toast } from "sonner";
import { useClientOptions, useCreateDeal } from "@/hooks/useDeals";

const schema = z.object({
  clientId: z.string().min(1, "Choose a client"),
  amount: z.preprocess(
    (v) => (v === "" || v == null ? null : Number(v)),
    z.number().finite("Enter a valid amount").nonnegative("Must be zero or more").nullable(),
  ),
  isPO: z.boolean(),
});
type FormValues = z.input<typeof schema>;

const cls =
  "w-full rounded-lg border border-border bg-white px-3 py-2.5 text-sm text-brand-navy outline-none focus:border-brand-teal focus:ring-2 focus:ring-brand-teal/20";
const errCls = "mt-1 text-xs text-red-600";

export function NewDealDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (dealId: string) => void;
}) {
  const { data: clients } = useClientOptions();
  const create = useCreateDeal();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { clientId: "", amount: "", isPO: false },
  });

  const onSubmit = async (values: FormValues) => {
    const client = clients?.find((c) => c.id === values.clientId);
    try {
      const deal = await create.mutateAsync({
        clientId: values.clientId as string,
        referralPartnerId: client?.referral_partner_id ?? null,
        isPurchaseOrder: values.isPO as boolean,
        amountRequested: (values.amount as number | null) ?? null,
      });
      toast.success("Deal created as New Lead");
      onCreated(deal.id);
    } catch (e) {
      toast.error((e as Error).message || "Could not create deal");
    }
  };

  return (
    <div
      className="fixed inset-0 z-40 grid place-items-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-deal-title"
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <form
        onSubmit={handleSubmit(onSubmit)}
        className="relative z-10 w-full max-w-md space-y-4 rounded-xl border border-border bg-white p-6 shadow-xl"
      >
        <div className="flex items-center justify-between">
          <h2 id="new-deal-title" className="text-lg font-semibold text-brand-navy">
            New deal
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-muted-foreground hover:text-brand-navy">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div>
          <label className="block text-sm font-medium text-brand-navy mb-1.5" htmlFor="deal-client">
            Client
          </label>
          <select id="deal-client" autoFocus className={cls} {...register("clientId")}>
            <option value="">Select a client…</option>
            {(clients ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.business_name}
              </option>
            ))}
          </select>
          {errors.clientId && <p className={errCls}>{errors.clientId.message}</p>}
          {clients && clients.length === 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              No clients yet — add one from the Clients screen first.
            </p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-brand-navy mb-1.5" htmlFor="deal-amount">
            Amount requested (R)
          </label>
          <input id="deal-amount" type="number" min="0" step="1000" className={cls} {...register("amount")} />
          {errors.amount && <p className={errCls}>{errors.amount.message}</p>}
        </div>

        <label className="flex items-center gap-2 text-sm text-brand-navy">
          <input type="checkbox" className="h-4 w-4 accent-brand-teal" {...register("isPO")} />
          Purchase Order deal
        </label>

        <div className="flex items-center gap-3 pt-1">
          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded-lg bg-brand-teal px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-teal/90 disabled:opacity-60"
          >
            {isSubmitting ? "Creating…" : "Create deal"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-5 py-2.5 text-sm font-medium text-brand-navy hover:bg-slate-50"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
