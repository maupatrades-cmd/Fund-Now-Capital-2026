import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { LeadReferrerShell } from "@/components/lead-referrer/LeadReferrerShell";
import { supabase } from "@/lib/supabase";

type LeadForm = {
  businessName: string;
  contactName: string;
  email: string;
  phone: string;
  fundingAmount: string;
  fundingPurpose: string;
};

const initialForm: LeadForm = { businessName: "", contactName: "", email: "", phone: "", fundingAmount: "", fundingPurpose: "" };

export default function LeadReferrerSubmitLeadPage() {
  const [form, setForm] = useState(initialForm);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const submit = useMutation({
    mutationFn: async () => {
      const amount = Number(form.fundingAmount);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error("Enter a valid funding amount.");
      const { error } = await supabase.rpc("lead_referrer_submit_lead", {
        p_business_name: form.businessName.trim(),
        p_contact_name: form.contactName.trim(),
        p_email: form.email.trim(),
        p_phone: form.phone.trim(),
        p_funding_amount: amount,
        p_funding_purpose: [form.fundingPurpose.trim()],
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["lead-referrer", "leads"] });
      toast.success("Lead submitted to Fund Now Capital");
      navigate("/lead-referrer");
    },
  });

  const update = (key: keyof LeadForm, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    submit.mutate();
  };

  return (
    <LeadReferrerShell>
      <div className="max-w-3xl">
        <h1 className="text-2xl font-bold text-brand-navy">Submit a new lead</h1>
        <p className="mt-1 text-sm text-muted-foreground">Capture the client's contact details and funding need. Fund Now Capital will guide the document process.</p>
        <form onSubmit={handleSubmit} className="mt-6 grid gap-4 rounded-xl border border-border bg-white p-5 shadow-sm sm:grid-cols-2">
          <label className="space-y-1 text-sm font-semibold text-brand-navy sm:col-span-2">Business name<input required minLength={2} value={form.businessName} onChange={(event) => update("businessName", event.target.value)} className="block w-full rounded-lg border border-border px-3 py-2 font-normal" /></label>
          <label className="space-y-1 text-sm font-semibold text-brand-navy">Contact name<input required minLength={2} value={form.contactName} onChange={(event) => update("contactName", event.target.value)} className="block w-full rounded-lg border border-border px-3 py-2 font-normal" /></label>
          <label className="space-y-1 text-sm font-semibold text-brand-navy">Mobile number<input required inputMode="tel" value={form.phone} onChange={(event) => update("phone", event.target.value)} className="block w-full rounded-lg border border-border px-3 py-2 font-normal" /></label>
          <label className="space-y-1 text-sm font-semibold text-brand-navy">Email address<input required type="email" value={form.email} onChange={(event) => update("email", event.target.value)} className="block w-full rounded-lg border border-border px-3 py-2 font-normal" /></label>
          <label className="space-y-1 text-sm font-semibold text-brand-navy">Funding amount<input required min={1} step="0.01" type="number" value={form.fundingAmount} onChange={(event) => update("fundingAmount", event.target.value)} className="block w-full rounded-lg border border-border px-3 py-2 font-normal" /></label>
          <label className="space-y-1 text-sm font-semibold text-brand-navy sm:col-span-2">Funding purpose<textarea required minLength={3} value={form.fundingPurpose} onChange={(event) => update("fundingPurpose", event.target.value)} className="block min-h-24 w-full rounded-lg border border-border px-3 py-2 font-normal" /></label>
          <button disabled={submit.isPending} className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-teal px-5 py-3 text-sm font-bold text-white disabled:opacity-50 sm:col-span-2">
            {submit.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            Submit lead
          </button>
          {submit.isError ? <p className="text-sm text-red-700 sm:col-span-2" role="alert">{(submit.error as Error).message || "Could not submit the lead."}</p> : null}
        </form>
      </div>
    </LeadReferrerShell>
  );
}
