import { useRef, useState, type FormEvent } from "react";
import type { ManualPayoutEntry } from "@/hooks/useManualPayouts";
import { useSession } from "@/lib/useSession";
import { useRecordManualPayment } from "@/hooks/useManualCommissionPayment";

export function ManualPaymentForm({ entry, amount, onClose }: { entry: ManualPayoutEntry; amount: string; onClose: () => void }) {
  const openedUid = useRef(useSession()?.user.id).current;
  const mutation = useRecordManualPayment(openedUid);
  const inFlight = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [mustReview, setMustReview] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (inFlight.current || mustReview) return;
    const values = new FormData(event.currentTarget);
    const file = values.get("proof");
    if (!(file instanceof File)) return;
    inFlight.current = true;
    setError(null);
    try {
      await mutation.mutateAsync({ entryId: entry.id, amount, currency: entry.currency, reference: String(values.get("reference") ?? ""), file });
      onClose();
    } catch (caught) {
      setError((caught as Error).message || "Could not confirm this payment record.");
      // Never encourage an immediate retry of an ambiguous financial write.
      setMustReview(true);
    } finally { inFlight.current = false; }
  };
  return <form onSubmit={submit} className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-4" aria-labelledby="manual-payment-title">
    <h3 id="manual-payment-title" className="font-semibold">Record a completed manual payment</h3>
    <p className="text-sm">{entry.profile?.full_name || entry.organisation?.name || entry.beneficiary_name || "Payee"}: <strong>{entry.currency} {amount}</strong></p>
    <p className="text-sm">This records a transfer you have already made. It does not send money or settle a partner or contractor invoice.</p>
    <label className="block text-sm">Bank payment reference<input className="mt-1 block w-full rounded border p-2" name="reference" minLength={3} maxLength={200} required disabled={mutation.isPending || mustReview} /></label>
    <label className="block text-sm">Proof of payment (PDF, PNG or JPEG, up to 10 MB)<input className="mt-1 block w-full" type="file" name="proof" accept="application/pdf,image/png,image/jpeg" required disabled={mutation.isPending || mustReview} /></label>
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="confirm" required disabled={mutation.isPending || mustReview} />I checked the payee and confirm the completed transfer matches this amount and currency. The payment record and proof cannot be replaced.</label>
    {error ? <p role="alert" className="text-sm text-red-700">{error} Close this form, refresh and check the recorded payment before trying again.</p> : null}
    <div className="flex gap-3"><button type="submit" className="rounded bg-brand-navy px-3 py-2 text-sm text-white disabled:opacity-50" disabled={mutation.isPending || mustReview}>Record payment and proof</button>
      <button type="button" className="text-sm underline" disabled={mutation.isPending} onClick={onClose}>Close</button></div>
  </form>;
}
