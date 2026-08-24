import { useState } from "react";
import { BadgeCheck, CalendarClock, FileCheck2, Landmark, Scale } from "lucide-react";
import { toast } from "sonner";
import { formatZAR } from "@/lib/format";
import { useClientDecideFundingOffer, useClientFundingOfferWorkspace, type ClientFundingOffer } from "@/hooks/useClientFundingOffers";

const frequency: Record<string,string> = { daily:"Daily",weekly:"Weekly",fortnightly:"Fortnightly",monthly:"Monthly",on_completion:"On completion",other:"See terms" };

export default function ClientOffersPage() {
  const offers = useClientFundingOfferWorkspace();
  const decide = useClientDecideFundingOffer();
  const [declining, setDeclining] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  async function record(offer: ClientFundingOffer, decision: "accepted"|"declined") {
    if (decision === "accepted" && !window.confirm("Accept this funding offer? Your decision will be recorded permanently and Fund Now Capital will begin the next verification and contracting steps.")) return;
    try { await decide.mutateAsync({offerId:offer.id,decision,reason:decision==="declined"?reason:undefined}); toast.success(decision==="accepted"?"Offer accepted — the Fund Now Capital team has been notified":"Decision recorded"); setDeclining(null); setReason(""); }
    catch(error){ toast.error((error as Error).message || "Your decision could not be recorded"); }
  }
  return <div className="mx-auto max-w-6xl space-y-7 pb-12">
    <header className="client-glass rounded-[30px] p-6 sm:p-9"><p className="text-[11px] font-bold uppercase tracking-[0.22em] text-[#9ee67d]">Funding decisions</p><h1 className="mt-3 text-3xl font-extrabold sm:text-4xl">Compare your verified offers</h1><p className="mt-3 max-w-3xl text-sm leading-6 text-white/55">Only offers published by Fund Now Capital from an approved funder outcome and verified source document appear here. Review the original evidence before deciding.</p></header>
    {offers.isLoading ? <div className="client-glass rounded-3xl p-10 text-center text-sm text-white/50">Loading your published outcomes…</div> : null}
    {offers.error ? <div className="rounded-2xl border border-red-300/20 bg-red-400/10 p-5 text-sm text-red-100">We could not load your offers. Please refresh or contact Fund Now Capital.</div> : null}
    {!offers.isLoading && !offers.error && (offers.data ?? []).length===0 ? <section className="client-glass rounded-[28px] p-8"><Landmark className="h-8 w-8 text-[#9be7f7]"/><h2 className="mt-5 text-2xl font-extrabold">No published offers yet</h2><p className="mt-2 text-sm text-white/50">Your team is still reviewing suitable funding outcomes. Nothing requires your decision right now.</p></section> : null}
    <div className="grid gap-5 lg:grid-cols-2">{(offers.data ?? []).map((offer)=><article key={offer.id} className="client-glass rounded-[28px] p-6 sm:p-7">
      <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-[#9be7f7]">{offer.deal_reference ?? "Funding application"}</p><h2 className="mt-2 text-xl font-extrabold">{offer.funder_label}</h2></div>{offer.decision ? <span className={`rounded-full px-3 py-1 text-xs font-bold ${offer.decision==="accepted"?"bg-emerald-400/15 text-emerald-100":"bg-amber-300/15 text-amber-100"}`}>{offer.decision==="accepted"?"Accepted":"Declined"}</span> : null}</div>
      <p className="mt-6 text-4xl font-black tracking-tight text-white">{formatZAR(offer.offer_amount)}</p>
      <dl className="mt-6 grid grid-cols-2 gap-3 text-sm"><Fact label="Term" value={offer.term_months?`${offer.term_months} months`:"See evidence"}/><Fact label="Repayment" value={offer.repayment_amount!=null?`${formatZAR(offer.repayment_amount)} ${frequency[offer.repayment_frequency ?? ""] ?? ""}`:"See evidence"}/><Fact label="Total repayment" value={offer.total_repayment!=null?formatZAR(offer.total_repayment):"See evidence"}/><Fact label="Valid until" value={offer.valid_until ?? "Not specified"}/></dl>
      {offer.fees_summary ? <Summary icon={Scale} label="Fees" value={offer.fees_summary}/> : null}{offer.conditions_summary ? <Summary icon={FileCheck2} label="Conditions" value={offer.conditions_summary}/> : null}
      <p className="mt-5 flex items-center gap-2 text-xs text-white/40"><CalendarClock className="h-4 w-4"/>Published {new Date(offer.published_at).toLocaleDateString("en-ZA")}</p>
      {!offer.decision ? <div className="mt-6 space-y-3"><div className="flex gap-3"><button disabled={decide.isPending} onClick={()=>void record(offer,"accepted")} className="flex-1 rounded-xl bg-[#2ca8a8] px-4 py-3 text-sm font-extrabold text-white disabled:opacity-50">Accept offer</button><button disabled={decide.isPending} onClick={()=>setDeclining(declining===offer.id?null:offer.id)} className="rounded-xl border border-white/15 px-4 py-3 text-sm font-bold text-white/70">Decline</button></div>{declining===offer.id?<div><textarea value={reason} onChange={(event)=>setReason(event.target.value)} rows={3} maxLength={500} placeholder="Tell us why, so we can help with the next step" className="w-full rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-white outline-none"/><button disabled={reason.trim().length<3||decide.isPending} onClick={()=>void record(offer,"declined")} className="mt-2 rounded-xl bg-amber-500 px-4 py-2 text-sm font-bold text-slate-950 disabled:opacity-40">Confirm decline</button></div>:null}</div> : <p className="mt-6 flex items-center gap-2 rounded-xl bg-white/5 p-3 text-sm text-white/60"><BadgeCheck className="h-5 w-5 text-[#9ee67d]"/>Decision recorded {offer.decided_at?new Date(offer.decided_at).toLocaleString("en-ZA"):""}</p>}
    </article>)}</div>
  </div>;
}

function Fact({label,value}:{label:string;value:string}) { return <div className="rounded-xl bg-white/5 p-3"><dt className="text-[10px] font-bold uppercase tracking-wider text-white/35">{label}</dt><dd className="mt-1 font-semibold text-white/85">{value}</dd></div>; }
function Summary({icon:Icon,label,value}:{icon:typeof Scale;label:string;value:string}) { return <div className="mt-3 flex gap-3 rounded-xl border border-white/10 p-4"><Icon className="mt-0.5 h-5 w-5 shrink-0 text-[#9be7f7]"/><div><p className="text-xs font-bold uppercase tracking-wider text-white/40">{label}</p><p className="mt-1 text-sm leading-6 text-white/70">{value}</p></div></div>; }
