import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Calculator } from "lucide-react";
import { CommissionSplitChart } from "@/components/deals/CommissionSplitChart";

const schema = z.object({
  gross: z.preprocess(
    (v) => (v === "" || v == null ? null : Number(v)),
    z.number().finite("Enter a valid amount").nonnegative("Must be zero or more").nullable(),
  ),
  isPO: z.boolean(),
});
type FormValues = z.input<typeof schema>;

export default function CalculatorPage() {
  const {
    register,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: "onChange",
    defaultValues: { gross: "", isPO: false },
  });

  const grossRaw = watch("gross");
  const isPO = Boolean(watch("isPO"));
  const gross =
    grossRaw === "" || grossRaw == null || !Number.isFinite(Number(grossRaw))
      ? null
      : Number(grossRaw);
  const filled = gross != null && gross > 0;

  return (
    <div className="max-w-xl space-y-4">
      <div className="flex items-center gap-2 text-brand-navy">
        <Calculator className="h-5 w-5 text-brand-teal" />
        <h2 className="text-lg font-semibold">Commission calculator</h2>
      </div>

      <div className="space-y-6 rounded-2xl border border-border bg-white p-6 shadow-sm">
        <div>
          <label className="block text-sm font-medium text-brand-navy mb-1.5" htmlFor="gross">
            Gross commission (R)
          </label>
          <input
            id="gross"
            type="number"
            min="0"
            step="100"
            inputMode="numeric"
            placeholder="e.g. 100000"
            // Large value + subtle green glow when focused / filled (brand green).
            className={
              "w-full rounded-[14px] border bg-white px-4 py-3 text-2xl font-semibold text-brand-navy outline-none transition " +
              "placeholder:text-lg placeholder:font-normal placeholder:text-muted-foreground " +
              "focus:border-brand-green focus:ring-4 focus:ring-brand-green/25 " +
              (filled ? "border-brand-green/60 ring-2 ring-brand-green/15" : "border-border")
            }
            {...register("gross")}
          />
          {errors.gross && <p className="mt-1 text-xs text-red-600">{errors.gross.message}</p>}
        </div>

        {/* Toggle switch (same behavior as the old checkbox). */}
        <label className="flex cursor-pointer items-center gap-3 text-sm text-brand-navy">
          <input type="checkbox" className="peer sr-only" {...register("isPO")} />
          <span
            aria-hidden="true"
            className={
              "relative h-6 w-11 shrink-0 rounded-full bg-slate-300 transition-colors " +
              "peer-checked:bg-brand-teal peer-focus-visible:ring-2 peer-focus-visible:ring-brand-teal/40 " +
              "after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full " +
              "after:bg-white after:shadow after:transition-transform peer-checked:after:translate-x-5"
            }
          />
          Purchase Order deal (flat 40% of pool)
        </label>

        <div className="rounded-xl bg-white p-1">
          <CommissionSplitChart gross={gross} isPurchaseOrder={isPO} />
        </div>

        <p className="text-xs text-muted-foreground">
          Calculated by the server-side <code>calculate_commission</code> function — the same one
          used when a deal is saved.
        </p>
      </div>
    </div>
  );
}
