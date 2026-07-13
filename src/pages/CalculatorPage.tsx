import { useState } from "react";
import { Calculator } from "lucide-react";
import { CommissionBreakdownView } from "@/components/deals/CommissionBreakdownView";

export default function CalculatorPage() {
  const [grossInput, setGrossInput] = useState("");
  const [isPO, setIsPO] = useState(false);

  const gross = grossInput === "" ? null : Number(grossInput);

  return (
    <div className="max-w-lg space-y-4">
      <div className="flex items-center gap-2 text-brand-navy">
        <Calculator className="h-5 w-5 text-brand-teal" />
        <h2 className="text-lg font-semibold">Commission calculator</h2>
      </div>

      <div className="space-y-4 rounded-xl border border-border bg-white p-6 shadow-sm">
        <div>
          <label className="block text-sm font-medium text-brand-navy mb-1.5" htmlFor="gross">
            Gross commission (R)
          </label>
          <input
            id="gross"
            type="number"
            min="0"
            step="100"
            value={grossInput}
            onChange={(e) => setGrossInput(e.target.value)}
            placeholder="e.g. 100000"
            className="w-full rounded-lg border border-border bg-white px-3 py-2.5 text-sm text-brand-navy outline-none focus:border-brand-teal focus:ring-2 focus:ring-brand-teal/20"
          />
        </div>

        <label className="flex items-center gap-2 text-sm text-brand-navy">
          <input
            type="checkbox"
            className="h-4 w-4 accent-brand-teal"
            checked={isPO}
            onChange={(e) => setIsPO(e.target.checked)}
          />
          Purchase Order deal (flat 40% of pool)
        </label>

        <div className="rounded-lg bg-slate-50 p-4">
          <CommissionBreakdownView gross={gross} isPurchaseOrder={isPO} />
        </div>

        <p className="text-xs text-muted-foreground">
          Calculated by the server-side <code>calculate_commission</code> function — the same one
          used when a deal is saved.
        </p>
      </div>
    </div>
  );
}
