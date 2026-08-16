import { useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { TermsMarkdown } from "@/components/terms/TermsMarkdown";
import { useAgreementSigning } from "@/hooks/useAgreementSigning";
import {
  SignaturePad,
  type SignaturePadHandle,
} from "@/components/legal/SignaturePad";
import {
  documentTypeLabel,
  downloadReviewCopy,
  isValidSigningToken,
  REQUIRED_CONSENTS,
  SIGNATURE_ACCEPTED_TYPES,
  SIGNATURE_MAX_BYTES,
  signingUnavailableReason,
  type ConsentKind,
  type SignatureMethod,
  type SigningParty,
} from "@/lib/agreements";

const METHOD_TABS: ReadonlyArray<{ method: SignatureMethod; label: string }> = [
  { method: "typed", label: "Type" },
  { method: "drawn", label: "Draw" },
  { method: "uploaded", label: "Upload" },
];

/*
 * Build 8.1 — the signing surface.
 *
 * One route serves every role signer (partner / contractor / lead-referrer);
 * the token in the URL identifies the party, so this page needs no role gate of
 * its own — it only needs a session, because the signer RPCs are granted to
 * `authenticated` only.
 *
 * Deliberate constraints:
 *  - An acknowledgement is recorded the moment it is ticked, and cannot be
 *    un-ticked: `consent_records` is append-only, so the first recorded value is
 *    permanent evidence. We therefore only ever send accepted=true — sending a
 *    false would write an immutable refusal and lock the signer out forever.
 *  - The Sign control stays disabled until the signer has scrolled the whole
 *    document. `reviewed_document` is an attestation; the UI should make it true.
 */

function PartyLine({ party, you }: { party: SigningParty; you?: boolean }) {
  return (
    <div className="text-sm">
      <span className="font-medium text-slate-900">{party.legal_name}</span>
      {you && (
        <span className="ml-2 rounded bg-brand-teal/10 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-brand-teal">
          You
        </span>
      )}
      <div className="text-xs text-slate-500">
        {party.is_fnc ? "Fund Now Capital (countersignatory)" : party.party_role.replace(/_/g, " ")}
        {party.capacity ? ` · ${party.capacity}` : ""}
        {party.represented_party ? ` · for ${party.represented_party}` : ""}
      </div>
    </div>
  );
}

function StatusCard({ tone, title, body }: { tone: "ok" | "warn" | "info"; title: string; body: string }) {
  const toneClass =
    tone === "ok"
      ? "border-brand-green/40 bg-brand-green/5"
      : tone === "warn"
        ? "border-amber-300 bg-amber-50"
        : "border-slate-200 bg-slate-50";
  return (
    <div className={`rounded-lg border p-4 ${toneClass}`}>
      <h2 className="text-sm font-semibold text-brand-navy">{title}</h2>
      <p className="mt-1 text-sm text-slate-600">{body}</p>
    </div>
  );
}

export default function SignAgreementPage() {
  const { token = "" } = useParams<{ token: string }>();
  const tokenValid = isValidSigningToken(token);

  const { pkg, isLoading, error, recordConsent, sign, decline } =
    useAgreementSigning(tokenValid ? token : "");

  const [adoptedName, setAdoptedName] = useState("");
  const [method, setMethod] = useState<SignatureMethod>("typed");
  const [hasInk, setHasInk] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const padRef = useRef<SignaturePadHandle | null>(null);
  const [scrolledToEnd, setScrolledToEnd] = useState(false);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [declineReason, setDeclineReason] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const docRef = useRef<HTMLDivElement | null>(null);

  // Memoised on the server-supplied object so the derived flag below has a
  // stable dependency (a fresh `{}` each render would defeat the memo).
  const recordedConsents = useMemo(() => pkg?.consents ?? {}, [pkg?.consents]);
  const allConsentsRecorded = useMemo(
    () => REQUIRED_CONSENTS.every((c) => recordedConsents[c.kind] === true),
    [recordedConsents],
  );

  const onDocScroll = () => {
    const el = docRef.current;
    if (!el) return;
    // 24px slack so a sub-pixel/zoom rounding gap can't strand the signer.
    if (el.scrollHeight - el.scrollTop - el.clientHeight <= 24) setScrolledToEnd(true);
  };

  const handleConsent = async (kind: ConsentKind) => {
    setActionError(null);
    try {
      await recordConsent.mutateAsync({ kind, accepted: true });
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Could not record that acknowledgement.");
    }
  };

  const handleSign = async () => {
    setActionError(null);
    try {
      let image: Blob | null = null;
      if (method === "drawn") {
        image = (await padRef.current?.toBlob()) ?? null;
        if (!image) throw new Error("Draw your signature before signing.");
      } else if (method === "uploaded") {
        image = uploadFile;
        if (!image) throw new Error("Choose a signature image before signing.");
      }
      await sign.mutateAsync({
        method,
        adoptedText: adoptedName.trim(),
        agreementId: pkg!.agreement.id,
        image,
      });
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Could not record your signature.");
    }
  };

  const handleDecline = async () => {
    setActionError(null);
    try {
      await decline.mutateAsync({ reason: declineReason.trim() });
      setDeclineOpen(false);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Could not record your decline.");
    }
  };

  if (!tokenValid) {
    return (
      <Shell>
        <StatusCard
          tone="warn"
          title="This signing link is not valid"
          body="The link looks incomplete. Please open the most recent link Fund Now Capital sent you, or ask for a new one."
        />
      </Shell>
    );
  }

  if (isLoading) {
    return (
      <Shell>
        <p className="text-sm text-slate-500">Loading your document…</p>
      </Shell>
    );
  }

  if (error || !pkg) {
    return (
      <Shell>
        <StatusCard
          tone="warn"
          title="This document could not be opened"
          body={error?.message ?? "The signing link could not be resolved."}
        />
      </Shell>
    );
  }

  const { agreement, party, other_parties, document } = pkg;
  const unavailable = signingUnavailableReason(agreement.state);
  const nameMismatch =
    adoptedName.trim().length > 0 &&
    adoptedName.trim().toLowerCase().replace(/\s+/g, " ") !==
      party.legal_name.trim().toLowerCase().replace(/\s+/g, " ");

  // Each method has its own "there is actually something to submit" test —
  // typed needs the name alone, drawn needs ink, uploaded needs a file.
  const methodReady =
    method === "typed" ? true : method === "drawn" ? hasInk : uploadFile !== null;

  const canSubmit =
    pkg.can_sign &&
    allConsentsRecorded &&
    scrolledToEnd &&
    adoptedName.trim().length > 1 &&
    methodReady &&
    !sign.isPending;

  return (
    <Shell>
      <header className="border-b border-slate-200 pb-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-brand-teal">
          {documentTypeLabel(agreement.document_type)}
        </p>
        <h1 className="mt-1 text-xl font-bold text-brand-navy">{agreement.title}</h1>
        <p className="mt-1 text-xs text-slate-500">
          {agreement.reference} · version {document.version}
          {agreement.expires_at
            ? ` · link expires ${new Date(agreement.expires_at).toLocaleDateString("en-ZA", {
                day: "2-digit",
                month: "short",
                year: "numeric",
              })}`
            : ""}
        </p>
      </header>

      <section className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-slate-200 p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Signing party</p>
          <PartyLine party={party} you />
        </div>
        {other_parties.length > 0 && (
          <div className="rounded-lg border border-slate-200 p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Other parties</p>
            <div className="space-y-2">
              {other_parties.map((p) => (
                <PartyLine key={p.id} party={p} />
              ))}
            </div>
          </div>
        )}
      </section>

      {pkg.already_signed && (
        <div className="mt-4">
          <StatusCard
            tone="ok"
            title="You have signed this document"
            body="Your signature is recorded. Fund Now Capital will countersign and send you the executed copy."
          />
        </div>
      )}

      {!pkg.already_signed && unavailable && (
        <div className="mt-4">
          <StatusCard tone="info" title="Signing is closed" body={unavailable} />
        </div>
      )}

      {/* The execution copy. Rendered as the renderer draws it — raw markdown,
          no substitution — so the screen and the executed PDF cannot diverge. */}
      <section className="mt-5">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-brand-navy">The document</h2>
          {document.content_markdown && (
            <button
              type="button"
              onClick={() => downloadReviewCopy(agreement.reference, agreement.title, document.content_markdown!)}
              className="text-xs font-semibold text-brand-teal underline underline-offset-2"
            >
              Download a copy to keep
            </button>
          )}
        </div>
        {document.content_markdown ? (
          <div
            ref={docRef}
            onScroll={onDocScroll}
            className="max-h-[26rem] overflow-y-auto rounded-lg border border-slate-200 bg-white p-5"
          >
            <TermsMarkdown markdown={document.content_markdown} />
          </div>
        ) : (
          <StatusCard
            tone="warn"
            title="The execution copy is not available on screen"
            body={
              document.has_source_file
                ? `This version is held as an uploaded file${document.source_filename ? ` (${document.source_filename})` : ""} rather than on-screen text. Please contact Fund Now Capital — you should not sign a document you cannot read here.`
                : "This version has no execution copy recorded. Please contact Fund Now Capital."
            }
          />
        )}
        {document.content_markdown && !scrolledToEnd && (
          <p className="mt-2 text-xs text-amber-700">Scroll to the end of the document to continue.</p>
        )}
        {document.content_sha256 && (
          <p className="mt-2 break-all text-[11px] text-slate-400">
            Document fingerprint (SHA-256): {document.content_sha256}
          </p>
        )}
      </section>

      {pkg.can_sign && (
        <>
          <section className="mt-6">
            <h2 className="mb-1 text-sm font-semibold text-brand-navy">Before you sign</h2>
            <p className="mb-3 text-xs text-slate-500">
              Each acknowledgement is recorded permanently when you tick it. Nothing is pre-ticked.
            </p>
            <div className="space-y-3">
              {REQUIRED_CONSENTS.map((c) => {
                const recorded = recordedConsents[c.kind] === true;
                return (
                  <label
                    key={c.kind}
                    className={`flex items-start gap-3 rounded-lg border p-3 ${
                      recorded ? "border-brand-green/40 bg-brand-green/5" : "border-slate-200"
                    } ${!scrolledToEnd && !recorded ? "opacity-60" : ""}`}
                  >
                    <Checkbox
                      className="mt-0.5"
                      checked={recorded}
                      disabled={recorded || !scrolledToEnd || recordConsent.isPending}
                      onCheckedChange={(v) => {
                        if (v === true && !recorded) void handleConsent(c.kind);
                      }}
                      aria-label={c.label}
                    />
                    <span className="text-sm leading-relaxed text-slate-700">{c.label}</span>
                  </label>
                );
              })}
            </div>
          </section>

          <section className="mt-6">
            <h2 className="mb-1 text-sm font-semibold text-brand-navy">Sign</h2>
            <p className="mb-3 text-xs text-slate-500">
              Your full legal name is recorded whichever way you sign — a drawn mark on
              its own is weak evidence of who made it.
            </p>
            <Input
              value={adoptedName}
              onChange={(e) => setAdoptedName(e.target.value)}
              placeholder={party.legal_name}
              disabled={!allConsentsRecorded}
              aria-label="Your full legal name"
            />

            <div
              className="mt-4 flex gap-1 rounded-lg bg-slate-100 p-1"
              role="tablist"
              aria-label="Signature method"
            >
              {METHOD_TABS.map((tab) => (
                <button
                  key={tab.method}
                  type="button"
                  role="tab"
                  aria-selected={method === tab.method}
                  disabled={!allConsentsRecorded}
                  onClick={() => {
                    // Switching tabs unmounts the pad, so its strokes are gone.
                    // Clear the parent's ink flag too, or coming back to an empty
                    // pad would leave Sign enabled over a blank canvas.
                    setHasInk(false);
                    setActionError(null);
                    setMethod(tab.method);
                  }}
                  className={`flex-1 rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${
                    method === tab.method
                      ? "bg-white text-brand-navy shadow-sm"
                      : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="mt-3">
              {method === "typed" && adoptedName.trim().length > 1 && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                  <p className="text-[11px] uppercase tracking-wide text-slate-400">
                    Your signature
                  </p>
                  <p
                    className="mt-1 text-2xl text-brand-navy"
                    style={{ fontFamily: "'Segoe Script', 'Brush Script MT', cursive" }}
                  >
                    {adoptedName.trim()}
                  </p>
                </div>
              )}

              {method === "drawn" && (
                <SignaturePad
                  ref={padRef}
                  disabled={!allConsentsRecorded}
                  onInkChange={setHasInk}
                />
              )}

              {method === "uploaded" && (
                <div className="rounded-lg border-2 border-dashed border-slate-300 p-4">
                  <input
                    type="file"
                    accept={SIGNATURE_ACCEPTED_TYPES.join(",")}
                    disabled={!allConsentsRecorded}
                    aria-label="Upload a signature image"
                    onChange={(e) => {
                      const file = e.target.files?.[0] ?? null;
                      setActionError(null);
                      // `accept` above is only a hint — the picker can still hand
                      // back anything, so validate type and size for real here.
                      if (file && !SIGNATURE_ACCEPTED_TYPES.includes(file.type)) {
                        setActionError("Choose a PNG or JPEG image.");
                        setUploadFile(null);
                        return;
                      }
                      if (file && file.size > SIGNATURE_MAX_BYTES) {
                        setActionError("That image is too large (2MB maximum).");
                        setUploadFile(null);
                        return;
                      }
                      setUploadFile(file);
                    }}
                    className="w-full text-sm"
                  />
                  <p className="mt-2 text-xs text-slate-500">
                    A photo or scan of your signature. PNG or JPEG, up to 2MB.
                  </p>
                  {uploadFile && (
                    <p className="mt-2 text-xs text-brand-green">
                      Ready: {uploadFile.name}
                    </p>
                  )}
                </div>
              )}
            </div>

            {nameMismatch && (
              <p className="mt-2 text-xs text-amber-700">
                This does not match the name on the document ({party.legal_name}). Sign in the name you
                are named under, unless you are signing in another capacity.
              </p>
            )}

            {actionError && <p className="mt-3 text-sm text-red-600">{actionError}</p>}

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void handleSign()}
                disabled={!canSubmit}
                className="rounded-md bg-brand-navy px-5 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                {sign.isPending ? "Signing…" : "Sign this document"}
              </button>
              <button
                type="button"
                onClick={() => setDeclineOpen((v) => !v)}
                className="text-sm text-slate-500 underline underline-offset-2 hover:text-slate-700"
              >
                I do not want to sign
              </button>
            </div>

            {declineOpen && (
              <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4">
                <p className="text-sm font-semibold text-brand-navy">Decline this document</p>
                <p className="mt-1 text-xs text-slate-600">
                  This is final — the document is closed and Fund Now Capital is notified. Tell them why so
                  they can correct and re-send it if needed.
                </p>
                <Input
                  className="mt-3"
                  value={declineReason}
                  onChange={(e) => setDeclineReason(e.target.value)}
                  placeholder="Reason for declining"
                  aria-label="Reason for declining"
                />
                <div className="mt-3 flex gap-3">
                  <button
                    type="button"
                    onClick={() => void handleDecline()}
                    disabled={declineReason.trim().length < 3 || decline.isPending}
                    className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {decline.isPending ? "Recording…" : "Confirm decline"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeclineOpen(false)}
                    className="text-sm text-slate-500 underline underline-offset-2"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </section>
        </>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50 py-8">
      <div className="mx-auto w-full max-w-3xl rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        {children}
      </div>
    </div>
  );
}
