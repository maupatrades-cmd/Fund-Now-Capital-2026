import { useEffect, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { CheckCircle2, Download, FileSignature, Loader2, LockKeyhole, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import {
  declineSigningRequest,
  downloadAgreementCopy,
  openSigningPacket,
  recordSigningConsent,
  REQUIRED_SIGNING_CONSENTS,
  submitTypedSignature,
  type SigningConsent,
  type SigningPacket,
} from "@/lib/agreementSigning";

const consentCopy: Record<SigningConsent, string> = {
  signer_identity: "I confirm that the legal name and signing capacity shown above are accurate.",
  reviewed_document: "I have read and understood the complete document presented above.",
  intent_to_bind: "I intend my typed signature to bind me to this exact document version.",
  electronic_delivery: "I consent to electronic signing and delivery of the final executed copy.",
};

const terminalStates = new Set(["executed", "declined", "expired", "withdrawn", "superseded", "delivery_failed", "identity_failed"]);

export default function AgreementSigningPage() {
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const [packet, setPacket] = useState<SigningPacket | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [checked, setChecked] = useState<SigningConsent[]>([]);
  const [typedName, setTypedName] = useState("");
  const [declineReason, setDeclineReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    openSigningPacket(token)
      .then((next) => {
        if (!active) return;
        setPacket(next);
        setChecked(next.accepted_consents ?? []);
        setTypedName(next.party_legal_name ?? "");
      })
      .catch((cause: unknown) => active && setError(cause instanceof Error ? cause.message : "Agreement could not be loaded"))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [token]);

  const allChecked = REQUIRED_SIGNING_CONSENTS.every((item) => checked.includes(item));
  const nameMatches = packet ? typedName.trim().localeCompare(packet.party_legal_name.trim(), undefined, { sensitivity: "base" }) === 0 : false;
  const terminal = packet ? terminalStates.has(packet.state) : false;
  const signed = Boolean(packet?.consumed_at) || Boolean(packet && ["countersign_pending", "executed"].includes(packet.state));
  const canSign = Boolean(packet?.content_available && !signed && !terminal && allChecked && nameMatches);

  const toggleConsent = (consent: SigningConsent) => setChecked((current) =>
    current.includes(consent) ? current.filter((item) => item !== consent) : [...current, consent],
  );

  const sign = async () => {
    if (!packet || !canSign) return;
    setSubmitting(true);
    try {
      for (const consent of REQUIRED_SIGNING_CONSENTS) await recordSigningConsent(token, consent);
      const result = await submitTypedSignature(token, typedName);
      setPacket({ ...packet, state: result.state, consumed_at: new Date().toISOString(), accepted_consents: [...REQUIRED_SIGNING_CONSENTS] });
      toast.success("Your signature was recorded securely");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Signature could not be submitted");
    } finally { setSubmitting(false); }
  };

  const decline = async () => {
    if (!packet || declineReason.trim().length < 3) return;
    setSubmitting(true);
    try {
      await declineSigningRequest(token, declineReason);
      setPacket({ ...packet, state: "declined" });
      toast.success("Your decision was recorded");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Agreement could not be declined");
    } finally { setSubmitting(false); }
  };

  if (loading) return <Frame><div className="flex items-center justify-center gap-3 py-24 text-slate-600"><Loader2 className="h-5 w-5 animate-spin" />Opening your secure agreement…</div></Frame>;
  if (error || !packet) return <Frame><div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-800"><h1 className="font-bold">This agreement cannot be opened</h1><p className="mt-2">{error ?? "The signing link is unavailable."}</p></div></Frame>;

  return <Frame><div className="space-y-6">
    <header className="rounded-[28px] bg-[#1a3a52] p-6 text-white shadow-xl sm:p-8">
      <p className="text-xs font-extrabold uppercase tracking-[0.22em] text-[#86d4cf]">Secure electronic signing</p>
      <h1 className="mt-3 text-2xl font-extrabold sm:text-3xl">{packet.title}</h1>
      <div className="mt-5 flex flex-wrap gap-2 text-xs text-white/70"><Chip>{packet.reference}</Chip><Chip>Version {packet.template_version}</Chip>{packet.content_sha256 ? <Chip>SHA-256 {packet.content_sha256.slice(0, 12)}…</Chip> : null}</div>
    </header>

    {signed ? <Notice icon={<CheckCircle2 />} title="Your signature is recorded">Current status: {packet.state.replace(/_/g, " ")}. Fund Now Capital will complete any required countersignature and final-copy delivery.</Notice> : null}

    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-xs font-bold uppercase tracking-wider text-slate-500">Signing as</p><h2 className="mt-1 text-lg font-bold text-[#1a3a52]">{packet.party_legal_name}</h2><p className="text-sm text-slate-500">{[packet.party_capacity, packet.represented_party].filter(Boolean).join(" · ") || "Individual capacity"}</p></div><button type="button" disabled={!packet.content_available} onClick={() => downloadAgreementCopy(packet)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#2da8b8] px-4 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"><Download className="h-4 w-4" />Download exact review copy</button></div>
    </section>

    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-center gap-3"><FileSignature className="h-5 w-5 text-[#2da8b8]" /><h2 className="text-lg font-bold text-[#1a3a52]">Document</h2></div>
      {packet.content_markdown ? <pre className="mt-5 max-h-[34rem] overflow-auto whitespace-pre-wrap rounded-xl bg-slate-50 p-5 font-sans text-sm leading-7 text-slate-700">{packet.content_markdown}</pre> : <div role="alert" className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">The exact approved document copy is not available yet. Signing is disabled until Fund Now Capital attaches the verified content.</div>}
    </section>

    {!signed && !terminal ? <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-bold text-[#1a3a52]">Acknowledgements</h2><p className="mt-2 text-sm text-slate-500">Nothing is pre-selected. Review the document, then confirm each statement yourself.</p>
      <div className="mt-5 space-y-3">{REQUIRED_SIGNING_CONSENTS.map((consent) => <label key={consent} className="flex cursor-pointer gap-3 rounded-xl border border-slate-200 p-4 text-sm text-slate-700"><input type="checkbox" checked={checked.includes(consent)} onChange={() => toggleConsent(consent)} className="mt-0.5 h-4 w-4 accent-[#2da8b8]" /><span>{consentCopy[consent]}</span></label>)}</div>
      <label className="mt-6 block text-sm font-bold text-slate-700" htmlFor="typed-signature">Type your full legal name exactly as shown above</label><input id="typed-signature" value={typedName} onChange={(event) => setTypedName(event.target.value)} autoComplete="name" className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 px-4 text-sm outline-none focus:border-[#2da8b8]" />
      {!nameMatches ? <p className="mt-2 text-xs text-red-700">The typed name must match the recorded signing name.</p> : null}
      <button type="button" disabled={!canSign || submitting} onClick={sign} className="mt-5 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#5dba5d] px-5 font-extrabold text-white disabled:cursor-not-allowed disabled:opacity-40">{submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : <FileSignature className="h-5 w-5" />}Sign this exact version</button>
    </section> : null}

    {!signed && !terminal ? <section className="rounded-2xl border border-slate-200 bg-white p-6"><h2 className="font-bold text-slate-800">Do not agree?</h2><label htmlFor="decline-reason" className="mt-2 block text-sm text-slate-500">Declining is recorded permanently. Explain your reason so Fund Now Capital can assist.</label><textarea id="decline-reason" value={declineReason} onChange={(event) => setDeclineReason(event.target.value)} rows={3} className="mt-4 w-full rounded-xl border border-slate-300 p-3 text-sm" /><button type="button" disabled={declineReason.trim().length < 3 || submitting} onClick={decline} className="mt-3 min-h-11 rounded-xl border border-red-300 px-4 text-sm font-bold text-red-700 disabled:opacity-40">Decline agreement</button></section> : null}

    <footer className="grid gap-3 sm:grid-cols-2"><Privacy icon={<ShieldCheck className="text-[#5dba5d]" />}>The document version and consent evidence are immutable after signing.</Privacy><Privacy icon={<LockKeyhole className="text-[#2da8b8]" />}>This page exposes only your own token-scoped agreement.</Privacy></footer>
    <button type="button" onClick={() => navigate("/")} className="text-sm font-bold text-[#1a3a52] underline">Return to Fund Now Capital</button>
  </div></Frame>;
}

function Frame({ children }: { children: ReactNode }) { return <main className="min-h-screen bg-slate-100 px-4 py-8 sm:px-6"><div className="mx-auto max-w-3xl">{children}</div></main>; }
function Chip({ children }: { children: ReactNode }) { return <span className="rounded-full bg-white/10 px-3 py-1.5">{children}</span>; }
function Notice({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) { return <section className="rounded-2xl border border-green-200 bg-green-50 p-6 text-green-900"><span className="block h-7 w-7">{icon}</span><h2 className="mt-3 text-lg font-bold">{title}</h2><p className="mt-2 text-sm">{children}</p></section>; }
function Privacy({ icon, children }: { icon: ReactNode; children: ReactNode }) { return <div className="flex gap-3 rounded-xl bg-white p-4 text-sm text-slate-600"><span className="h-5 w-5 shrink-0">{icon}</span><span>{children}</span></div>; }
