import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, Clock3, FileSignature, LockKeyhole, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";
import ClientPortalShell from "@/components/client-portal/ClientPortalShell";
import { supabase } from "@/lib/supabase";

type Status = "preparing" | "ready_to_sign" | "client_signed" | "awaiting_fnc_countersign" | "complete" | "declined" | "expired" | "superseded";
type Row = { id: string; document_key: "client_mandate" | "authority_and_consent"; status: Status; expires_at: string | null };

const documents = [
  { key: "client_mandate" as const, title: "Client Mandate Letter", detail: "Appoints Fund Now Capital as your funding broker for this application." },
  { key: "authority_and_consent" as const, title: "Authority and Consent Form", detail: "Records your authority and consent for the approved funding process." },
] as const;

const statuses: Record<Status, { label: string; detail: string; style: string }> = {
  preparing: { label: "Being prepared", detail: "Fund Now Capital is preparing the owner-approved version.", style: "border-white/10 bg-white/5 text-white/65" },
  ready_to_sign: { label: "Ready to sign", detail: "The approved document is ready. Secure signing will open here when enabled.", style: "border-[#7fd4e8]/25 bg-[#7fd4e8]/10 text-[#9be7f7]" },
  client_signed: { label: "Signed by you", detail: "Your signature is recorded and the document is being finalised.", style: "border-[#6ec144]/25 bg-[#6ec144]/10 text-[#a2eb80]" },
  awaiting_fnc_countersign: { label: "Awaiting FNC countersignature", detail: "Your part is complete. Fund Now Capital must countersign.", style: "border-amber-300/25 bg-amber-300/10 text-amber-100" },
  complete: { label: "Complete", detail: "The executed document is complete and securely retained.", style: "border-[#6ec144]/25 bg-[#6ec144]/10 text-[#a2eb80]" },
  declined: { label: "Needs attention", detail: "Please contact the Fund Now Capital team.", style: "border-red-300/25 bg-red-300/10 text-red-100" },
  expired: { label: "Expired", detail: "A refreshed approved document must be prepared.", style: "border-amber-300/25 bg-amber-300/10 text-amber-100" },
  superseded: { label: "Replaced", detail: "A newer approved version replaced this document.", style: "border-white/10 bg-white/5 text-white/55" },
};

async function loadReadiness(): Promise<Row[]> {
  const { data, error } = await supabase.from("client_legal_document_readiness")
    .select("id,document_key,status,expires_at").neq("status", "superseded").order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Row[];
}

export default function ClientLegalDocumentsPage() {
  const query = useQuery({ queryKey: ["client-legal-readiness"], queryFn: loadReadiness });
  const byKey = new Map(query.data?.map((row) => [row.document_key, row]));
  const completed = documents.filter((document) => byKey.get(document.key)?.status === "complete").length;

  return (
    <ClientPortalShell>
      <div className="space-y-6">
        <Link to="/client" className="inline-flex min-h-11 items-center gap-2 px-2 text-sm font-bold text-white/65 hover:text-white"><ArrowLeft className="h-4 w-4" /> Back to portal</Link>
        <section className="client-glass rounded-[28px] p-5 sm:p-8">
          <p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-[#86d4cf]">Secure legal documents</p>
          <div className="mt-2 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div><h1 className="text-3xl font-extrabold">Signing readiness</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-white/50">See only the exact owner-approved documents prepared for you. Fees, wording and commercial terms remain Owner-controlled.</p></div>
            <p className="rounded-2xl border border-[#6ec144]/20 bg-[#6ec144]/10 px-5 py-3 text-sm font-extrabold text-[#a2eb80]">{completed} / {documents.length} complete</p>
          </div>
        </section>
        {query.isError ? <div role="alert" className="rounded-2xl border border-red-300/20 bg-red-300/10 p-5 text-sm text-red-100">Signing readiness could not be loaded. Please refresh or contact Fund Now Capital.</div> : null}
        <section className="grid gap-4 lg:grid-cols-2">
          {documents.map((document) => {
            const row = byKey.get(document.key);
            const meta = statuses[row?.status ?? "preparing"];
            return <article key={document.key} className="client-glass rounded-[24px] p-5 sm:p-6">
              <div className="flex gap-4"><span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[#7fd4e8]/12 text-[#9be7f7]">{row?.status === "complete" ? <CheckCircle2 /> : <FileSignature />}</span><div><div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-extrabold">{document.title}</h2><span className="rounded-full bg-white/7 px-2 py-1 text-[9px] font-bold uppercase text-white/45">Required</span></div><p className="mt-2 text-sm leading-6 text-white/45">{document.detail}</p></div></div>
              <div className={`mt-5 rounded-2xl border p-4 ${meta.style}`}><p className="flex items-center gap-2 text-sm font-extrabold"><Clock3 className="h-4 w-4" />{query.isLoading ? "Checking status…" : meta.label}</p><p className="mt-2 text-xs leading-5 opacity-75">{meta.detail}</p></div>
              {row?.expires_at ? <p className="mt-4 text-xs text-white/40">Valid until {new Intl.DateTimeFormat("en-ZA", { dateStyle: "medium" }).format(new Date(row.expires_at))}</p> : null}
            </article>;
          })}
        </section>
        <section className="grid gap-4 sm:grid-cols-2"><article className="client-glass rounded-2xl p-5"><ShieldCheck className="h-5 w-5 text-[#a2eb80]" /><h2 className="mt-4 font-extrabold">Exact approved versions</h2><p className="mt-2 text-xs leading-5 text-white/45">Readiness can only reference an active legal template and immutable generated copy.</p></article><article className="client-glass rounded-2xl p-5"><LockKeyhole className="h-5 w-5 text-[#9be7f7]" /><h2 className="mt-4 font-extrabold">Private by design</h2><p className="mt-2 text-xs leading-5 text-white/45">Signature tokens, internal notes and other clients' records are never exposed here.</p></article></section>
      </div>
    </ClientPortalShell>
  );
}
