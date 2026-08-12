import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, MailCheck, RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";

type PrimaryContact = { id: string; full_name: string; email: string | null };
type Bootstrap = { status: string; requested_at: string; welcome_sent_at: string | null; failure_code: string | null };

export default function ClientPortalAccessPanel({ clientId }: { clientId: string }) {
  const queryClient = useQueryClient();
  const [confirmed, setConfirmed] = useState(false);
  const contact = useQuery({
    queryKey: ["client-portal-primary-contact", clientId],
    queryFn: async (): Promise<PrimaryContact | null> => {
      const { data, error } = await supabase.from("client_contacts")
        .select("id,full_name,email").eq("client_id", clientId).eq("is_primary", true).maybeSingle();
      if (error) throw error;
      return data as PrimaryContact | null;
    },
  });
  const bootstrap = useQuery({
    queryKey: ["client-portal-bootstrap", clientId],
    queryFn: async (): Promise<Bootstrap | null> => {
      const { data, error } = await supabase.from("client_account_bootstraps")
        .select("status,requested_at,welcome_sent_at,failure_code")
        .eq("client_id", clientId).order("requested_at", { ascending: false }).limit(1).maybeSingle();
      if (error) throw error;
      return data as Bootstrap | null;
    },
  });
  const invite = useMutation({
    mutationFn: async () => {
      if (!contact.data?.id) throw new Error("Add a primary contact with an email address first.");
      const { data, error } = await supabase.functions.invoke("bootstrap-client-account", {
        body: { client_id: clientId, client_contact_id: contact.data.id, owner_verified: true },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error ?? "The welcome email could not be sent.");
      return data as { status: string; account_created: boolean };
    },
    onSuccess: async (result) => {
      toast.success(result.account_created ? "Client portal created and welcome email sent." : "Fresh secure login email sent.");
      setConfirmed(false);
      await queryClient.invalidateQueries({ queryKey: ["client-portal-bootstrap", clientId] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not invite the client."),
  });
  const ready = Boolean(contact.data?.email && confirmed && !invite.isPending);

  return (
    <section className="rounded-xl border border-border bg-white p-5 shadow-sm lg:col-span-2" aria-labelledby="portal-access-title">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-brand-teal" aria-hidden="true" />
            <h3 id="portal-access-title" className="text-sm font-semibold text-brand-navy">Client portal access</h3>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {contact.isLoading ? "Checking the primary contact…" : contact.data?.email ? `${contact.data.full_name} · ${contact.data.email}` : "Add a primary contact with a valid email before inviting this client."}
          </p>
          {bootstrap.data ? (
            <p className="mt-2 inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
              <MailCheck className="h-3.5 w-3.5" aria-hidden="true" />
              Latest status: {bootstrap.data.status.replaceAll("_", " ")}
            </p>
          ) : null}
        </div>
        <button type="button" disabled={!ready} onClick={() => invite.mutate()} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-brand-teal px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45">
          {invite.isPending ? <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" /> : <MailCheck className="h-4 w-4" aria-hidden="true" />}
          {bootstrap.data?.welcome_sent_at ? "Send fresh login link" : "Invite client"}
        </button>
      </div>
      <label className="mt-4 flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
        <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-0.5 h-4 w-4 rounded border-slate-300" />
        <span><strong className="text-brand-navy">Owner verification:</strong> I confirmed this is the client’s authorised primary email and may receive secure CRM access.</span>
      </label>
      <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"><ShieldCheck className="h-3.5 w-3.5 text-brand-teal" aria-hidden="true" />The email contains a one-time Supabase magic link; no password is shared.</p>
    </section>
  );
}
