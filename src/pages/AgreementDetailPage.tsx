import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAgreement, useWithdrawAgreement } from "@/hooks/useAgreements";
import { StatePill } from "@/pages/AgreementsPage";
import {
  documentTypeLabel,
  REQUIRED_CONSENTS,
  type AgreementPartyRow,
  type ConsentRow,
  type SignatureRequestRow,
} from "@/lib/agreements";

/*
 * Build 8.2 — agreement detail.
 *
 * Shows the append-only evidence ledger as it actually is, rather than a
 * prettified summary: the signing events, the per-party acknowledgements, and
 * the document fingerprints. This page IS the audit view.
 */

const TERMINAL = [
  "executed",
  "expired",
  "declined",
  "withdrawn",
  "superseded",
  "delivery_failed",
  "identity_failed",
];

function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-ZA", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const EVENT_LABEL: Record<string, string> = {
  created: "Created",
  approved_for_send: "Approved to send",
  sent: "Sent for signature",
  viewed: "Opened by the signer",
  in_progress: "Signing started",
  progress_saved: "Progress saved",
  consent_recorded: "Acknowledgement recorded",
  signer_signed: "Signed by the signer",
  countersign_pending: "Awaiting countersignature",
  countersigned: "Countersigned by FNC",
  executed: "Fully executed",
  expired: "Expired",
  declined: "Declined",
  withdrawn: "Withdrawn",
  superseded: "Superseded",
  delivery_failed: "Delivery failed",
  identity_failed: "Identity check failed",
  downloaded: "Downloaded",
  accessed: "Accessed",
};

function PartyCard({
  party,
  request,
  consents,
}: {
  party: AgreementPartyRow;
  request: SignatureRequestRow | undefined;
  consents: ConsentRow[];
}) {
  const accepted = new Set(
    consents.filter((c) => c.accepted).map((c) => c.consent_kind),
  );
  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="font-medium text-slate-900">{party.legal_name}</p>
          <p className="text-xs text-slate-500">
            {party.is_fnc
              ? "Fund Now Capital (countersignatory)"
              : party.party_role.replace(/_/g, " ")}
            {party.capacity ? ` · ${party.capacity}` : ""}
            {party.represented_party ? ` · for ${party.represented_party}` : ""}
          </p>
        </div>
        {party.email && <p className="text-xs text-slate-400">{party.email}</p>}
      </div>

      {request && (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
          <div>
            <dt className="text-slate-400">Link expires</dt>
            <dd className="text-slate-700">{formatWhen(request.expires_at)}</dd>
          </div>
          <div>
            <dt className="text-slate-400">Last opened</dt>
            <dd className="text-slate-700">{formatWhen(request.last_opened_at)}</dd>
          </div>
          <div>
            <dt className="text-slate-400">Signed</dt>
            <dd className="text-slate-700">{formatWhen(request.consumed_at)}</dd>
          </div>
        </dl>
      )}

      {!party.is_fnc && (
        <div className="mt-3">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Acknowledgements ({accepted.size}/{REQUIRED_CONSENTS.length})
          </p>
          <ul className="space-y-0.5">
            {REQUIRED_CONSENTS.map((c) => (
              <li key={c.kind} className="text-xs text-slate-600">
                <span
                  className={
                    accepted.has(c.kind) ? "text-brand-green" : "text-slate-300"
                  }
                >
                  ●
                </span>{" "}
                {c.kind.replace(/_/g, " ")}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function AgreementDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, error } = useAgreement(id);
  const withdraw = useWithdrawAgreement();
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [reason, setReason] = useState("");

  const consentsByParty = useMemo(() => {
    const map = new Map<string, ConsentRow[]>();
    for (const c of data?.consents ?? []) {
      const list = map.get(c.party_snapshot_id) ?? [];
      list.push(c);
      map.set(c.party_snapshot_id, list);
    }
    return map;
  }, [data?.consents]);

  const requestByParty = useMemo(() => {
    const map = new Map<string, SignatureRequestRow>();
    for (const r of data?.requests ?? []) map.set(r.party_snapshot_id, r);
    return map;
  }, [data?.requests]);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading agreement…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6">
        <p className="text-sm text-red-600">
          {(error as Error)?.message ?? "Agreement not found."}
        </p>
      </div>
    );
  }

  const { instance, parties, events } = data;
  const isTerminal = TERMINAL.includes(instance.state);

  const handleWithdraw = async () => {
    try {
      await withdraw.mutateAsync({ agreementId: instance.id, reason: reason.trim() });
      toast.success("Agreement withdrawn");
      setWithdrawOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not withdraw the agreement.");
    }
  };

  return (
    <div className="p-6">
      <Link
        to="/agreements"
        className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
      >
        <ArrowLeft className="h-4 w-4" />
        Agreements
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-teal">
            {documentTypeLabel(instance.document_type)}
          </p>
          <h1 className="mt-1 text-xl font-bold text-brand-navy">
            {instance.title_snapshot}
          </h1>
          <p className="mt-1 text-xs text-slate-500">{instance.reference}</p>
        </div>
        <StatePill state={instance.state} />
      </div>

      {instance.state === "countersign_pending" && (
        <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-900">Waiting on your countersignature</p>
          <p className="mt-1 text-sm text-amber-800">
            The signer has signed. Countersigning produces the executed PDF and its
            fingerprint, which the document renderer generates — that step is not wired
            into this screen yet, so the agreement stays here until it is.
          </p>
        </div>
      )}

      {instance.decline_reason && (
        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <p className="text-sm font-semibold text-brand-navy">Declined</p>
          <p className="mt-1 text-sm text-slate-600">{instance.decline_reason}</p>
        </div>
      )}
      {instance.withdraw_reason && (
        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <p className="text-sm font-semibold text-brand-navy">Withdrawn</p>
          <p className="mt-1 text-sm text-slate-600">{instance.withdraw_reason}</p>
        </div>
      )}

      <section className="mt-6">
        <h2 className="mb-3 text-sm font-semibold text-brand-navy">Parties</h2>
        <div className="grid gap-3 lg:grid-cols-2">
          {parties.map((p) => (
            <PartyCard
              key={p.id}
              party={p}
              request={requestByParty.get(p.id)}
              consents={consentsByParty.get(p.id) ?? []}
            />
          ))}
        </div>
      </section>

      <section className="mt-6">
        <h2 className="mb-3 text-sm font-semibold text-brand-navy">Evidence trail</h2>
        <div className="rounded-lg border border-slate-200 bg-white">
          {events.length === 0 ? (
            <p className="p-4 text-sm text-slate-500">No events recorded yet.</p>
          ) : (
            <ol className="divide-y divide-slate-100">
              {events.map((e) => (
                <li key={e.id} className="flex items-baseline justify-between gap-4 px-4 py-3">
                  <div>
                    <p className="text-sm text-slate-800">
                      {EVENT_LABEL[e.event_type] ?? e.event_type.replace(/_/g, " ")}
                    </p>
                    {e.event_type === "consent_recorded" && e.detail?.consent_kind ? (
                      <p className="text-xs text-slate-500">
                        {String(e.detail.consent_kind).replace(/_/g, " ")}
                      </p>
                    ) : null}
                    {e.signature_method && (
                      <p className="text-xs text-slate-500">
                        method: {e.signature_method.replace(/_/g, " ")}
                      </p>
                    )}
                  </div>
                  <p className="shrink-0 text-xs text-slate-400">{formatWhen(e.occurred_at)}</p>
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>

      <section className="mt-6">
        <h2 className="mb-3 text-sm font-semibold text-brand-navy">Fingerprints</h2>
        <dl className="space-y-2 rounded-lg border border-slate-200 p-4 text-xs">
          <div>
            <dt className="text-slate-400">Unsigned snapshot (SHA-256)</dt>
            <dd className="break-all text-slate-700">{instance.unsigned_sha256 ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-slate-400">Executed document (SHA-256)</dt>
            <dd className="break-all text-slate-700">{instance.executed_sha256 ?? "—"}</dd>
          </div>
        </dl>
      </section>

      {!isTerminal && (
        <section className="mt-6 border-t border-slate-200 pt-5">
          {!withdrawOpen ? (
            <button
              type="button"
              onClick={() => setWithdrawOpen(true)}
              className="text-sm text-red-600 underline underline-offset-2"
            >
              Withdraw this agreement
            </button>
          ) : (
            <div className="max-w-lg rounded-lg border border-red-200 bg-red-50 p-4">
              <p className="text-sm font-semibold text-brand-navy">Withdraw the agreement</p>
              <p className="mt-1 text-xs text-slate-600">
                This is final. Any live signing link is revoked immediately and the signer
                can no longer open the document.
              </p>
              <input
                className="mt-3 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Reason for withdrawing"
                aria-label="Reason for withdrawing"
              />
              <div className="mt-3 flex gap-3">
                <button
                  type="button"
                  onClick={() => void handleWithdraw()}
                  disabled={reason.trim().length < 3 || withdraw.isPending}
                  className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
                >
                  {withdraw.isPending ? "Withdrawing…" : "Confirm withdraw"}
                </button>
                <button
                  type="button"
                  onClick={() => setWithdrawOpen(false)}
                  className="text-sm text-slate-500 underline underline-offset-2"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
