import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { MailCheck, RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";

type LeadClientInvitationPanelProps = {
  leadId: string;
  businessName: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
};

export default function LeadClientInvitationPanel({
  leadId,
  businessName,
  contactName,
  contactEmail,
  contactPhone,
}: LeadClientInvitationPanelProps) {
  const [confirmed, setConfirmed] = useState(false);
  const invitation = useMutation({
    mutationFn: async () => {
      if (!contactEmail) throw new Error("Add the lead contact email before sending portal access.");
      const { data, error } = await supabase.functions.invoke("bootstrap-client-account", {
        body: {
          action: "quick_invite",
          lead_id: leadId,
          contact_email: contactEmail,
          contact_name: contactName ?? undefined,
          contact_phone: contactPhone ?? undefined,
          business_name: businessName,
          authorised_email_verified: true,
        },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error ?? "The secure client invitation could not be sent.");
      return data as { account_created: boolean };
    },
    onSuccess: (result) => {
      toast.success(result.account_created ? "Client portal created and invitation sent." : "Fresh client login link sent.");
      setConfirmed(false);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not invite this lead."),
  });
  const ready = Boolean(contactEmail && confirmed && !invitation.isPending);

  return (
    <section className="rounded-xl border border-brand-teal/20 bg-white p-5 shadow-sm" aria-labelledby="lead-client-invitation-title">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <MailCheck className="h-4 w-4 text-brand-teal" aria-hidden="true" />
            <h3 id="lead-client-invitation-title" className="text-sm font-semibold text-brand-navy">Client portal invitation</h3>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {contactEmail ? `${contactName || businessName} · ${contactEmail}` : "This lead needs a contact email before portal access can be sent."}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">The invitation is recorded against this lead while the client completes their application.</p>
        </div>
        <button
          type="button"
          disabled={!ready}
          onClick={() => invitation.mutate()}
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-brand-teal px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45"
        >
          {invitation.isPending ? <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" /> : <MailCheck className="h-4 w-4" aria-hidden="true" />}
          Send client portal link
        </button>
      </div>
      <label className="mt-4 flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
        <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-0.5 h-4 w-4 rounded border-slate-300" />
        <span><strong className="text-brand-navy">Authorised email check:</strong> I confirmed this lead contact may receive secure Fund Now Capital client portal access.</span>
      </label>
      <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"><ShieldCheck className="h-3.5 w-3.5 text-brand-teal" aria-hidden="true" />The link is one-time and the source lead remains auditable.</p>
    </section>
  );
}
