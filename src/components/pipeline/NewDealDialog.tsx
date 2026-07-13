import { useState } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";
import { useClientOptions, useCreateDeal } from "@/hooks/useDeals";

const cls =
  "w-full rounded-lg border border-border bg-white px-3 py-2.5 text-sm text-brand-navy outline-none focus:border-brand-teal focus:ring-2 focus:ring-brand-teal/20";

export function NewDealDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (dealId: string) => void;
}) {
  const { data: clients } = useClientOptions();
  const create = useCreateDeal();
  const [clientId, setClientId] = useState("");
  const [amount, setAmount] = useState("");
  const [isPO, setIsPO] = useState(false);

  const submit = async () => {
    if (!clientId) {
      toast.error("Choose a client");
      return;
    }
    const client = clients?.find((c) => c.id === clientId);
    try {
      const deal = await create.mutateAsync({
        clientId,
        referralPartnerId: client?.referral_partner_id ?? null,
        isPurchaseOrder: isPO,
        amountRequested: amount === "" ? null : Number(amount),
      });
      toast.success("Deal created as New Lead");
      onCreated(deal.id);
    } catch (e) {
      toast.error((e as Error).message || "Could not create deal");
    }
  };

  return (
    <div className="fixed inset-0 z-40 grid place-items-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div className="relative z-10 w-full max-w-md space-y-4 rounded-xl border border-border bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-brand-navy">New deal</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-muted-foreground hover:text-brand-navy">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div>
          <label className="block text-sm font-medium text-brand-navy mb-1.5" htmlFor="deal-client">
            Client
          </label>
          <select id="deal-client" className={cls} value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">Select a client…</option>
            {(clients ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.business_name}
              </option>
            ))}
          </select>
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
          <input
            id="deal-amount"
            type="number"
            min="0"
            step="1000"
            className={cls}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>

        <label className="flex items-center gap-2 text-sm text-brand-navy">
          <input type="checkbox" className="h-4 w-4 accent-brand-teal" checked={isPO} onChange={(e) => setIsPO(e.target.checked)} />
          Purchase Order deal
        </label>

        <div className="flex items-center gap-3 pt-1">
          <button
            type="button"
            onClick={submit}
            disabled={create.isPending}
            className="rounded-lg bg-brand-teal px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-teal/90 disabled:opacity-60"
          >
            {create.isPending ? "Creating…" : "Create deal"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-5 py-2.5 text-sm font-medium text-brand-navy hover:bg-slate-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
