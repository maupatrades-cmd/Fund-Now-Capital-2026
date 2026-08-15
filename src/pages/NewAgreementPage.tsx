import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AlertTriangle, ArrowLeft, Copy, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import {
  useCreateAndSendAgreement,
  useSignableProfiles,
} from "@/hooks/useAgreements";
import {
  useLegalTemplates,
  useLegalTemplateVersions,
} from "@/hooks/useLegalStudio";
import {
  documentTypeLabel,
  sha256Hex,
  signingUrl,
  type AgreementPartyInput,
  type SendResult,
} from "@/lib/agreements";

/*
 * Build 8.2 — send for signature.
 *
 * Four RPCs behind one form: create the instance, add the parties, freeze the
 * variables, send. Only PUBLISHED template versions are offered — the backend
 * would accept a draft version id, but issuing a binding document off unapproved
 * wording is exactly the mistake this registry exists to prevent.
 */

const inputClass =
  "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:border-brand-teal focus:ring-2 focus:ring-brand-teal/20";

const labelClass = "mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500";

type VariableRow = { key: string; value: string };

export default function NewAgreementPage() {
  const navigate = useNavigate();
  const { data: templates } = useLegalTemplates();
  const { data: versions, isLoading: versionsLoading } = useLegalTemplateVersions();
  const { data: profiles } = useSignableProfiles();
  const createAndSend = useCreateAndSendAgreement();

  const [versionId, setVersionId] = useState("");
  const [signerProfileId, setSignerProfileId] = useState("");
  const [signerName, setSignerName] = useState("");
  const [signerEmail, setSignerEmail] = useState("");
  const [representedParty, setRepresentedParty] = useState("");
  const [capacity, setCapacity] = useState("");
  const [fncSignatory, setFncSignatory] = useState("Thapelo Maupa");
  const [expiryDays, setExpiryDays] = useState(7);
  const [variables, setVariables] = useState<VariableRow[]>([]);
  const [result, setResult] = useState<SendResult | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  /*
   * Per-form-instance nonce. Combined with a hash of the form's contents below
   * to build the idempotency key, so two separate sends of an identical form
   * (e.g. the same NDA to the same person twice) still produce two agreements.
   */
  const [formNonce] = useState(() =>
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `agr-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );

  // Only published versions are dispatchable. Joined to their template for the
  // human title + document type.
  const publishable = useMemo(() => {
    const templateById = new Map((templates ?? []).map((t) => [t.id, t]));
    return (versions ?? [])
      .filter((v) => v.status === "published")
      .map((v) => ({
        version: v,
        template: templateById.get(v.template_id),
      }))
      .filter((row) => !!row.template);
  }, [templates, versions]);

  const selectedProfile = (profiles ?? []).find((p) => p.id === signerProfileId);

  const onPickProfile = (id: string) => {
    setSignerProfileId(id);
    const p = (profiles ?? []).find((x) => x.id === id);
    if (p) {
      setSignerName(p.full_name ?? "");
      setSignerEmail(p.email ?? "");
    }
  };

  const variableMap = useMemo(() => {
    const out: Record<string, string> = {};
    for (const row of variables) {
      const k = row.key.trim();
      if (k) out[k] = row.value;
    }
    return out;
  }, [variables]);

  const canSubmit =
    !!versionId && signerName.trim().length > 1 && fncSignatory.trim().length > 1;

  const handleSend = async () => {
    setFormError(null);
    const parties: AgreementPartyInput[] = [
      {
        party_role: "signer",
        legal_name: signerName.trim(),
        represented_party: representedParty.trim(),
        capacity: capacity.trim(),
        email: signerEmail.trim(),
        // Linking the platform user matters beyond convenience: the signer RPCs
        // are authenticated-only, so the person who opens the link signs in as
        // this user.
        profile_id: signerProfileId || null,
        is_fnc: false,
      },
      {
        party_role: "countersignatory",
        legal_name: fncSignatory.trim(),
        represented_party: "Fund Now Capital (Pty) Ltd",
        capacity: "",
        email: "",
        profile_id: null,
        is_fnc: true,
      },
    ];

    try {
      /*
       * Key = form nonce + a hash of everything that ends up ON the document.
       *
       * Retrying an unchanged form resumes the draft a failed attempt left
       * behind (the orchestration skips parties already inserted). Retrying an
       * EDITED form — a corrected signer name, a different template — produces a
       * different key and therefore a NEW draft, so the correction can never be
       * skipped as "already added" and quietly bind someone under the old name.
       */
      const contentHash = await sha256Hex(
        JSON.stringify([versionId, signerProfileId, parties, variableMap, expiryDays]),
      );
      const idempotencyKey = `${formNonce}:${(contentHash ?? "nohash").slice(0, 32)}`;

      const res = await createAndSend.mutateAsync({
        templateVersionId: versionId,
        subjectProfileId: signerProfileId || null,
        parties,
        variables: variableMap,
        expiryDays,
        idempotencyKey,
      });
      setResult(res);
      toast.success("Agreement sent for signature");
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Could not send the agreement.");
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Signing link copied");
    } catch {
      toast.error("Could not copy — select the link and copy it manually.");
    }
  };

  /* ----------------------------------------------------------------------- *
   * Sent — show the raw signing links ONCE.
   * ----------------------------------------------------------------------- */
  if (result) {
    const tokens = result.tokens ?? [];
    return (
      <div className="p-6">
        <h1 className="text-xl font-bold text-brand-navy">Agreement sent</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The document is now awaiting signature.
        </p>

        <div className="mt-5 rounded-lg border border-amber-300 bg-amber-50 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-amber-900">
            <AlertTriangle className="h-4 w-4" />
            Copy the signing link now — it is shown only once
          </p>
          <p className="mt-1 text-sm text-amber-800">
            Only a one-way hash of each link is stored, so it cannot be shown again. If
            you lose it, withdraw the agreement and send a new one. Automatic email
            delivery is a later build — for now, send this link to the signer yourself.
          </p>
        </div>

        {tokens.length === 0 ? (
          <p className="mt-4 text-sm text-slate-600">
            No new links were issued — this agreement had already been sent.
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            {tokens.map((t) => {
              const url = signingUrl(t.token);
              return (
                <div key={t.party_snapshot_id} className="rounded-lg border border-slate-200 p-4">
                  <p className="text-xs uppercase tracking-wide text-slate-400">
                    Signing link · expires{" "}
                    {new Date(t.expires_at).toLocaleDateString("en-ZA", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                    })}
                  </p>
                  <code className="mt-2 block break-all rounded bg-slate-50 p-3 text-xs text-slate-700">
                    {url}
                  </code>
                  <button
                    type="button"
                    onClick={() => void copy(url)}
                    className="mt-3 inline-flex items-center gap-2 rounded-md bg-brand-navy px-3 py-1.5 text-xs font-semibold text-white"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    Copy link
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={() => navigate(`/agreements/${result.agreementId}`)}
            className="rounded-lg bg-brand-navy px-4 py-2 text-sm font-semibold text-white"
          >
            Open the agreement
          </button>
          <Link
            to="/agreements"
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700"
          >
            Back to agreements
          </Link>
        </div>
      </div>
    );
  }

  /* ----------------------------------------------------------------------- *
   * The form.
   * ----------------------------------------------------------------------- */
  return (
    <div className="p-6">
      <Link
        to="/agreements"
        className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
      >
        <ArrowLeft className="h-4 w-4" />
        Agreements
      </Link>

      <h1 className="text-xl font-bold text-brand-navy">Send for signature</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Issue a published document to a signer. Everything is frozen at send — the
        wording, the parties and the values become the signed record.
      </p>

      <div className="mt-6 max-w-2xl space-y-6">
        <section>
          <label className={labelClass} htmlFor="template-version">
            Document
          </label>
          {versionsLoading ? (
            <p className="text-sm text-muted-foreground">Loading templates…</p>
          ) : publishable.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-600">
              No published template versions yet. Publish one in the{" "}
              <Link to="/settings/legal-studio" className="text-brand-teal underline">
                Document Studio
              </Link>{" "}
              first — only approved wording can be sent.
            </div>
          ) : (
            <select
              id="template-version"
              className={inputClass}
              value={versionId}
              onChange={(e) => setVersionId(e.target.value)}
            >
              <option value="">Select a published document…</option>
              {publishable.map(({ version, template }) => (
                <option key={version.id} value={version.id}>
                  {template!.title} · v{version.version} ·{" "}
                  {documentTypeLabel(template!.document_type)}
                </option>
              ))}
            </select>
          )}
        </section>

        <section className="rounded-lg border border-slate-200 p-4">
          <h2 className="mb-3 text-sm font-semibold text-brand-navy">Signer</h2>

          <div className="mb-3">
            <label className={labelClass} htmlFor="signer-profile">
              Platform user
            </label>
            <select
              id="signer-profile"
              className={inputClass}
              value={signerProfileId}
              onChange={(e) => onPickProfile(e.target.value)}
            >
              <option value="">Not a platform user (enter manually)</option>
              {(profiles ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name ?? p.email ?? p.id} · {p.role.replace(/_/g, " ")}
                </option>
              ))}
            </select>
            {!signerProfileId && (
              <p className="mt-1 text-xs text-amber-700">
                Signing requires an account — the signer RPCs are authenticated-only. An
                unlinked signer cannot open the link until they have a login.
              </p>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={labelClass} htmlFor="signer-name">
                Full legal name
              </label>
              <input
                id="signer-name"
                className={inputClass}
                value={signerName}
                onChange={(e) => setSignerName(e.target.value)}
                placeholder="As it should appear on the document"
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="signer-email">
                Email
              </label>
              <input
                id="signer-email"
                type="email"
                className={inputClass}
                value={signerEmail}
                onChange={(e) => setSignerEmail(e.target.value)}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="represented-party">
                Signing for (entity)
              </label>
              <input
                id="represented-party"
                className={inputClass}
                value={representedParty}
                onChange={(e) => setRepresentedParty(e.target.value)}
                placeholder="Optional — e.g. Bright Destiny (Pty) Ltd"
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="capacity">
                Capacity
              </label>
              <input
                id="capacity"
                className={inputClass}
                value={capacity}
                onChange={(e) => setCapacity(e.target.value)}
                placeholder="Optional — e.g. Director"
              />
            </div>
          </div>

          {selectedProfile && !selectedProfile.full_name && (
            <p className="mt-2 text-xs text-amber-700">
              This user has no full name on their profile — check the legal name above is
              correct before sending.
            </p>
          )}
        </section>

        <section className="rounded-lg border border-slate-200 p-4">
          <h2 className="mb-3 text-sm font-semibold text-brand-navy">
            Fund Now Capital countersignatory
          </h2>
          <input
            className={inputClass}
            value={fncSignatory}
            onChange={(e) => setFncSignatory(e.target.value)}
            aria-label="Fund Now Capital countersignatory"
          />
          <p className="mt-1 text-xs text-slate-500">
            Countersigning happens after the signer signs.
          </p>
        </section>

        <section className="rounded-lg border border-slate-200 p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-brand-navy">Document values</h2>
            <button
              type="button"
              onClick={() => setVariables((v) => [...v, { key: "", value: "" }])}
              className="text-xs font-semibold text-brand-teal hover:underline"
            >
              + Add value
            </button>
          </div>
          <p className="mb-3 text-xs text-slate-500">
            Optional. Frozen with the document and hashed into its fingerprint.
          </p>
          {variables.length === 0 && (
            <p className="text-xs text-slate-400">No values added.</p>
          )}
          <div className="space-y-2">
            {variables.map((row, idx) => (
              <div key={idx} className="flex gap-2">
                <input
                  className={inputClass}
                  placeholder="Name"
                  value={row.key}
                  aria-label={`Value name ${idx + 1}`}
                  onChange={(e) =>
                    setVariables((v) =>
                      v.map((r, i) => (i === idx ? { ...r, key: e.target.value } : r)),
                    )
                  }
                />
                <input
                  className={inputClass}
                  placeholder="Value"
                  value={row.value}
                  aria-label={`Value ${idx + 1}`}
                  onChange={(e) =>
                    setVariables((v) =>
                      v.map((r, i) => (i === idx ? { ...r, value: e.target.value } : r)),
                    )
                  }
                />
                <button
                  type="button"
                  onClick={() => setVariables((v) => v.filter((_, i) => i !== idx))}
                  className="shrink-0 px-2 text-xs text-slate-400 hover:text-red-600"
                  aria-label={`Remove value ${idx + 1}`}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </section>

        <section>
          <label className={labelClass} htmlFor="expiry-days">
            Signing window (days)
          </label>
          <input
            id="expiry-days"
            type="number"
            min={1}
            max={90}
            className={`${inputClass} max-w-[8rem]`}
            value={expiryDays}
            onChange={(e) => setExpiryDays(Math.max(1, Number(e.target.value) || 1))}
          />
        </section>

        {formError && <p className="text-sm text-red-600">{formError}</p>}

        <div className="flex items-center gap-3 border-t border-slate-200 pt-5">
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={!canSubmit || createAndSend.isPending}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-navy px-5 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {createAndSend.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            {createAndSend.isPending ? "Sending…" : "Send for signature"}
          </button>
          <Link to="/agreements" className="text-sm text-slate-500 hover:text-slate-700">
            Cancel
          </Link>
        </div>
      </div>
    </div>
  );
}
