import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MailCheck, RefreshCw, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';

type Candidate = {
  client_id: string;
  business_name: string;
  contact_id: string | null;
  contact_name: string | null;
  contact_email: string | null;
  latest_status: string | null;
  welcome_sent_at: string | null;
};

export default function ClientInvitationsPage() {
  const queryClient = useQueryClient();
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
  const candidates = useQuery({
    queryKey: ['role-client-invitations'],
    queryFn: async (): Promise<Candidate[]> => {
      const { data, error } = await supabase.functions.invoke('bootstrap-client-account', { method: 'GET' });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error ?? 'Could not load client invitations.');
      return (data.clients ?? []) as Candidate[];
    },
  });
  const invite = useMutation({
    mutationFn: async (candidate: Candidate) => {
      if (!candidate.contact_id) throw new Error('This client needs a primary contact with an email address.');
      const { data, error } = await supabase.functions.invoke('bootstrap-client-account', {
        body: { client_id: candidate.client_id, client_contact_id: candidate.contact_id, authorised_email_verified: true },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error ?? 'The secure login email could not be sent.');
    },
    onSuccess: async () => {
      toast.success('Secure client login link sent.');
      setConfirmed({});
      await queryClient.invalidateQueries({ queryKey: ['role-client-invitations'] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Could not invite client.'),
  });

  return (
    <section className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold text-brand-navy">Client invitations</h1>
        <p className="mt-1 text-sm text-muted-foreground">Send a one-time secure portal link only to clients attributed to you.</p>
      </header>
      {candidates.isLoading ? <p className="rounded-xl border bg-white p-6 text-sm text-muted-foreground">Loading authorised clients…</p> : null}
      {candidates.isError ? <p role="alert" className="rounded-xl bg-red-50 p-5 text-sm text-red-700">Could not load client invitations.</p> : null}
      {!candidates.isLoading && !candidates.isError && candidates.data?.length === 0 ? (
        <p className="rounded-xl border bg-white p-6 text-sm text-muted-foreground">No qualified clients are currently available to invite.</p>
      ) : null}
      <div className="grid gap-4">
        {(candidates.data ?? []).map((client) => {
          const ready = Boolean(client.contact_email && confirmed[client.client_id] && !invite.isPending);
          return (
            <article key={client.client_id} className="rounded-xl border border-border bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="font-bold text-brand-navy">{client.business_name}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">{client.contact_name ?? 'Primary contact missing'}{client.contact_email ? ` · ${client.contact_email}` : ''}</p>
                  {client.latest_status ? <p className="mt-2 text-xs font-semibold capitalize text-emerald-700">Latest status: {client.latest_status.replaceAll('_', ' ')}</p> : null}
                </div>
                <button type="button" disabled={!ready} onClick={() => invite.mutate(client)} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-brand-teal px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45">
                  {invite.isPending && invite.variables?.client_id === client.client_id ? <RefreshCw className="h-4 w-4 animate-spin" /> : <MailCheck className="h-4 w-4" />}
                  {client.welcome_sent_at ? 'Send fresh login link' : 'Invite client'}
                </button>
              </div>
              <label className="mt-4 flex items-start gap-3 rounded-lg border bg-slate-50 p-3 text-xs text-slate-600">
                <input type="checkbox" checked={Boolean(confirmed[client.client_id])} onChange={(event) => setConfirmed((current) => ({ ...current, [client.client_id]: event.target.checked }))} className="mt-0.5 h-4 w-4" />
                <span><strong className="text-brand-navy">Authorised email check:</strong> I confirmed this is the client’s authorised primary email and may receive secure CRM access.</span>
              </label>
            </article>
          );
        })}
      </div>
      <p className="flex items-center gap-2 text-xs text-muted-foreground"><ShieldCheck className="h-4 w-4 text-brand-teal" />Links are one-time, audited and restricted by lead attribution.</p>
    </section>
  );
}
