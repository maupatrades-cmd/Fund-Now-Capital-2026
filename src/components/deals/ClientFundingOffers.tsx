import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Send, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { formatZAR } from "@/lib/format";
import { funderName, useDealSubmissions } from "@/hooks/useDealDetail";
import { useOwnerCreateFundingOffer, useOwnerFundingOffers, useOwnerPublishFundingOffer } from "@/hooks/useClientFundingOffers";

type Evidence = { id: string; filename: string; document_type: string };
const field = "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:border-brand-teal";

export function ClientFundingOffers({ dealId, clientId }: { dealId: string; clientId: string }) {
  const offers = useOwnerFundingOffers(dealId);
  const submissions = useDealSubmissions(dealId);
  const createOffer = useOwnerCreateFundingOffer();
  const publish = useOwnerPublishFundingOffer();
  const evidence = useQuery({
    queryKey: ["offer-evidence", dealId],
    queryFn: async (): Promise<Evidence[]> => {
      const { data, error } = await supabase.from("documents").select("id,filename,document_type")
        .eq("client_id", clientId).in("document_type", ["offer_letter", "term_sheet"])
        .eq("verification_status", "accepted").eq("is_current_version", true)
        .or(`deal_id.eq.${dealId},deal_id.is.null`);
      if (error) throw error;
      return (data ?? []) as Evidence[];
    },
  });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ submissionId: "", evidenceId: "", label: "", amount: "", term: "", frequency: "monthly", repayment: "", total: "", fees: "", conditions: "", validUntil: "" });
  const eligible = (submissions.data ?? []).filter((item) => item.status === "approved" || item.status === "quote_received");

  async function save(event: React.FormEvent) {
    event.preventDefault();
    try {
      await createOffer.mutateAsync({
        p_deal_id: dealId, p_funder_submission_id: form.submissionId, p_evidence_document_id: form.evidenceId,
        p_client_funder_label: form.label, p_offer_amount: Number(form.amount), p_term_months: form.term ? Number(form.term) : null,
        p_repayment_frequency: form.frequency || null, p_repayment_amount: form.repayment ? Number(form.repayment) : null,
        p_total_repayment: form.total ? Number(form.total) : null, p_fees_summary: form.fees || null,
        p_conditions_summary: form.conditions || null, p_valid_until: form.validUntil || null,
      });
      toast.success("Evidence-backed offer saved as a draft"); setOpen(false);
    } catch (error) { toast.error((error as Error).message || "Could not create offer"); }
  }

  return <section className="rounded-xl border border-border bg-white p-5 shadow-sm">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-sm font-semibold text-brand-navy">Client funding offers</h3><p className="mt-1 text-xs text-muted-foreground">Only terms copied from a verified offer letter or term sheet may be published. Commissions and internal notes are never included.</p></div><button type="button" onClick={() => setOpen((value) => !value)} className="rounded-lg border border-brand-teal px-3 py-2 text-sm font-semibold text-brand-navy">{open ? "Cancel" : "Create offer"}</button></div>
    {open ? <form onSubmit={save} className="mt-4 grid gap-3 rounded-xl bg-slate-50 p-4 sm:grid-cols-2">
      <label className="text-xs font-semibold text-brand-navy">Approved funder outcome<select required className={`${field} mt-1`} value={form.submissionId} onChange={(e)=>setForm({...form,submissionId:e.target.value})}><option value="">Choose approved submission</option>{eligible.map((item)=><option key={item.id} value={item.id}>{funderName(item)} · {item.quote_amount ? formatZAR(item.quote_amount) : item.status}</option>)}</select></label>
      <label className="text-xs font-semibold text-brand-navy">Verified evidence<select required className={`${field} mt-1`} value={form.evidenceId} onChange={(e)=>setForm({...form,evidenceId:e.target.value})}><option value="">Choose offer letter or term sheet</option>{(evidence.data ?? []).map((item)=><option key={item.id} value={item.id}>{item.filename}</option>)}</select></label>
      <Input label="Client-facing funder name" required value={form.label} onChange={(value)=>setForm({...form,label:value})}/><Input label="Offer amount (R)" required type="number" value={form.amount} onChange={(value)=>setForm({...form,amount:value})}/>
      <Input label="Term (months)" type="number" value={form.term} onChange={(value)=>setForm({...form,term:value})}/><label className="text-xs font-semibold text-brand-navy">Repayment frequency<select className={`${field} mt-1`} value={form.frequency} onChange={(e)=>setForm({...form,frequency:e.target.value})}><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="fortnightly">Fortnightly</option><option value="monthly">Monthly</option><option value="on_completion">On completion</option><option value="other">Other</option></select></label>
      <Input label="Repayment amount (R)" type="number" value={form.repayment} onChange={(value)=>setForm({...form,repayment:value})}/><Input label="Total repayment (R)" type="number" value={form.total} onChange={(value)=>setForm({...form,total:value})}/>
      <Input label="Valid until" type="date" value={form.validUntil} onChange={(value)=>setForm({...form,validUntil:value})}/><Input label="Fees shown in evidence" value={form.fees} onChange={(value)=>setForm({...form,fees:value})}/>
      <label className="text-xs font-semibold text-brand-navy sm:col-span-2">Conditions shown in evidence<textarea className={`${field} mt-1`} rows={3} value={form.conditions} onChange={(e)=>setForm({...form,conditions:e.target.value})}/></label>
      <button disabled={createOffer.isPending || !form.submissionId || !form.evidenceId} className="rounded-lg bg-brand-teal px-4 py-2 text-sm font-bold text-white disabled:opacity-50 sm:col-span-2">Save evidence-backed draft</button>
    </form> : null}
    <div className="mt-4 space-y-2">{offers.isLoading ? <p className="text-sm text-muted-foreground">Loading offers…</p> : null}{(offers.data ?? []).map((offer)=><div key={offer.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"><div><p className="font-semibold text-brand-navy">{offer.client_funder_label} · {formatZAR(offer.offer_amount)}</p><p className="text-xs capitalize text-muted-foreground">{offer.state}{offer.valid_until ? ` · valid until ${offer.valid_until}` : ""}</p></div>{offer.state === "draft" ? <button type="button" disabled={publish.isPending} onClick={() => publish.mutate({offerId:offer.id,dealId},{onSuccess:()=>toast.success("Offer published to the client portal"),onError:(error)=>toast.error(error.message)})} className="inline-flex items-center gap-2 rounded-lg bg-brand-navy px-3 py-2 text-xs font-bold text-white"><Send className="h-4 w-4"/>Publish</button> : <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700"><ShieldCheck className="h-4 w-4"/>Published</span>}</div>)}{!offers.isLoading && (offers.data ?? []).length===0 ? <p className="text-sm text-muted-foreground">No client-safe offers yet.</p> : null}</div>
  </section>;
}

function Input({label,value,onChange,type="text",required=false}:{label:string;value:string;onChange:(value:string)=>void;type?:string;required?:boolean}) { return <label className="text-xs font-semibold text-brand-navy">{label}<input required={required} type={type} min={type==="number"?0:undefined} step={type==="number"?"0.01":undefined} className={`${field} mt-1`} value={value} onChange={(event)=>onChange(event.target.value)}/></label>; }
