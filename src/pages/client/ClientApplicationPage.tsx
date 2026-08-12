import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check, ClipboardList, Save, ShieldCheck } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import ClientPortalShell from "@/components/client-portal/ClientPortalShell";
import { useClientPortalIdentity } from "@/hooks/useClientPortalIdentity";
import { supabase } from "@/lib/supabase";

type Product = { code: string; display_name: string; max_requested_amount: number | null; is_asset_backed: boolean };
type Answer = { section: "business" | "person" | "product"; answer_key: string; answer_value: unknown };
type Draft = { id: string; requested_amount: number | null; status: string; answers: Answer[] };
type FormValues = Record<string, string>;

const sections = ["Business", "Contact", "Funding", "Review"] as const;
const initialValues: FormValues = {
  registered_name: "", registration_number: "", industry: "", years_trading: "",
  contact_name: "", contact_mobile: "", contact_email: "", identity_number: "",
  requested_amount: "", funding_purpose: "", monthly_turnover: "", asset_security: "", notes: "",
};

const fieldsBySection: Record<"business" | "person" | "product", string[]> = {
  business: ["registered_name", "registration_number", "industry", "years_trading"],
  person: ["contact_name", "contact_mobile", "contact_email", "identity_number"],
  product: ["funding_purpose", "monthly_turnover", "asset_security", "notes"],
};

const inputClass = "mt-2 min-h-12 w-full rounded-2xl border border-white/10 bg-white/[0.055] px-4 text-sm text-white outline-none transition placeholder:text-white/25 focus:border-[#6ec144]/70 focus:ring-4 focus:ring-[#6ec144]/10";

function Field({ label, name, value, onChange, type = "text", placeholder, required = false }: {
  label: string; name: string; value: string; onChange: (name: string, value: string) => void;
  type?: string; placeholder?: string; required?: boolean;
}) {
  return (
    <label className="block text-sm font-semibold text-white/75">
      {label}{required ? <span className="ml-1 text-[#9ee67d]">*</span> : null}
      <input className={inputClass} name={name} value={value} type={type} placeholder={placeholder}
        required={required} onChange={(event) => onChange(name, event.target.value)} />
    </label>
  );
}

function formatMoney(value: string) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0
    ? new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR", maximumFractionDigits: 0 }).format(amount)
    : "Not supplied";
}

export default function ClientApplicationPage() {
  const identity = useClientPortalIdentity();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [step, setStep] = useState(0);
  const [values, setValues] = useState<FormValues>(initialValues);
  const requestedProduct = searchParams.get("product") ?? "working_capital";

  const products = useQuery({
    queryKey: ["client-funding-products"],
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<Product[]> => {
      const { data, error } = await supabase.from("funding_product_catalog")
        .select("code,display_name,max_requested_amount,is_asset_backed").eq("is_active", true).order("display_name");
      if (error) throw error;
      return (data ?? []) as Product[];
    },
  });
  const selectedProduct = products.data?.some((product) => product.code === requestedProduct)
    ? requestedProduct : products.data?.[0]?.code ?? requestedProduct;

  const draft = useQuery({
    queryKey: ["client-application-draft", identity.data?.clientId, selectedProduct],
    enabled: Boolean(identity.data?.clientId && selectedProduct),
    queryFn: async (): Promise<Draft | null> => {
      const { data: response, error } = await supabase.from("client_form_responses")
        .select("id,requested_amount,status").eq("client_id", identity.data!.clientId)
        .eq("product_code", selectedProduct).order("updated_at", { ascending: false }).limit(1).maybeSingle();
      if (error) throw error;
      if (!response) return null;
      const { data: answers, error: answerError } = await supabase.from("client_form_answers")
        .select("section,answer_key,answer_value").eq("response_id", response.id);
      if (answerError) throw answerError;
      return { ...response, answers: (answers ?? []) as Answer[] } as Draft;
    },
  });

  useEffect(() => {
    if (!identity.data || draft.isLoading) return;
    const next: FormValues = {
      ...initialValues,
      registered_name: identity.data.businessName ?? "",
      registration_number: identity.data.registrationNumber ?? "",
      industry: identity.data.industry ?? "",
      contact_name: identity.data.contactName ?? "",
      contact_email: identity.data.contactEmail ?? "",
      requested_amount: draft.data?.requested_amount?.toString() ?? "",
    };
    for (const answer of draft.data?.answers ?? []) {
      if (typeof answer.answer_value === "string" || typeof answer.answer_value === "number") {
        next[answer.answer_key] = String(answer.answer_value);
      }
    }
    setValues(next);
  }, [draft.data, draft.isLoading, identity.data]);

  const persist = async (submit: boolean) => {
    if (!identity.data?.clientId) throw new Error("Your client account is not linked yet.");
    const requestedAmount = Number(values.requested_amount);
    if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) throw new Error("Enter a valid funding amount.");
    const product = products.data?.find((item) => item.code === selectedProduct);
    if (product?.max_requested_amount && requestedAmount > product.max_requested_amount) {
      throw new Error(`This product is capped at ${formatMoney(String(product.max_requested_amount))}.`);
    }
    if (submit && ["registered_name", "contact_name", "contact_email", "funding_purpose"].some((key) => !values[key].trim())) {
      throw new Error("Complete every required field before submitting.");
    }
    if (draft.data?.status === "submitted") throw new Error("This application is already submitted and locked for review.");

    let responseId = draft.data?.id;
    if (responseId) {
      const { error } = await supabase.from("client_form_responses").update({ requested_amount: requestedAmount }).eq("id", responseId);
      if (error) throw error;
    } else {
      const { data, error } = await supabase.from("client_form_responses").insert({
        client_id: identity.data.clientId, product_code: selectedProduct, requested_amount: requestedAmount, status: "draft",
      }).select("id").single();
      if (error) throw error;
      responseId = data.id as string;
    }

    const answerRows = (Object.entries(fieldsBySection) as [Answer["section"], string[]][])
      .flatMap(([section, keys]) => keys.filter((key) => values[key].trim()).map((key) => ({
        response_id: responseId, section, subject_key: "primary", answer_key: key,
        answer_value: values[key].trim(), source: "client",
      })));
    if (answerRows.length) {
      const { error } = await supabase.from("client_form_answers").upsert(answerRows, {
        onConflict: "response_id,section,subject_key,answer_key",
      });
      if (error) throw error;
    }
    if (submit) {
      const { error } = await supabase.from("client_form_responses").update({ status: "submitted" }).eq("id", responseId);
      if (error) throw error;
    }
    return { submitted: submit };
  };

  const save = useMutation({
    mutationFn: (submit: boolean) => persist(submit),
    onSuccess: async ({ submitted }) => {
      toast.success(submitted ? "Application submitted securely." : "Draft saved.");
      await queryClient.invalidateQueries({ queryKey: ["client-application-draft", identity.data?.clientId, selectedProduct] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "The application could not be saved."),
  });

  const updateValue = (name: string, value: string) => setValues((current) => ({ ...current, [name]: value }));
  const product = products.data?.find((item) => item.code === selectedProduct);
  const submitted = draft.data?.status === "submitted";

  return (
    <ClientPortalShell>
      <div className="mx-auto max-w-5xl">
        <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-[0.22em] text-[#86d4cf]">Secure funding application</p>
            <h1 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">Tell us what your business needs</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-white/50">Save at any point. Your answers stay private and build the paperwork checklist for your selected funding route.</p>
          </div>
          <button type="button" disabled={save.isPending || submitted} onClick={() => save.mutate(false)}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-white/12 bg-white/5 px-4 text-sm font-bold text-white/75 disabled:opacity-45">
            <Save className="h-4 w-4" aria-hidden="true" /> Save draft
          </button>
        </header>

        <ol className="mb-6 grid grid-cols-4 gap-2" aria-label="Application progress">
          {sections.map((section, index) => (
            <li key={section} className={`rounded-2xl border p-3 ${index <= step ? "border-[#6ec144]/35 bg-[#6ec144]/10" : "border-white/8 bg-white/[0.025]"}`}>
              <span className={`grid h-6 w-6 place-items-center rounded-full text-[10px] font-extrabold ${index < step ? "bg-[#6ec144] text-[#06131d]" : "bg-white/8 text-white/60"}`}>
                {index < step ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : index + 1}
              </span>
              <span className="mt-2 hidden text-xs font-bold text-white/65 sm:block">{section}</span>
            </li>
          ))}
        </ol>

        <section className="client-glass rounded-[28px] p-5 sm:p-8" aria-live="polite">
          {identity.isLoading || draft.isLoading || products.isLoading ? <p className="py-16 text-center text-sm text-white/45">Loading your secure application...</p> : null}
          {identity.error || draft.error || products.error ? <p className="rounded-2xl border border-red-300/20 bg-red-400/10 p-4 text-sm text-red-100">We could not load the application. Please refresh or contact Fund Now Capital support.</p> : null}
          {!identity.isLoading && !draft.isLoading && !products.isLoading && !identity.error && !draft.error && !products.error ? (
            <fieldset disabled={submitted || save.isPending} className="disabled:opacity-70">
              {step === 0 ? <div>
                <h2 className="text-2xl font-extrabold">Business details</h2>
                <p className="mt-2 text-sm text-white/45">Confirm the registered information we already have, then fill any gaps.</p>
                <div className="mt-6 grid gap-5 sm:grid-cols-2">
                  <Field label="Registered business name" name="registered_name" value={values.registered_name} onChange={updateValue} required />
                  <Field label="Registration number" name="registration_number" value={values.registration_number} onChange={updateValue} placeholder="e.g. 2024/123456/07" />
                  <Field label="Industry" name="industry" value={values.industry} onChange={updateValue} />
                  <Field label="Years trading" name="years_trading" value={values.years_trading} onChange={updateValue} type="number" />
                </div>
              </div> : null}
              {step === 1 ? <div>
                <h2 className="text-2xl font-extrabold">Primary contact</h2>
                <p className="mt-2 text-sm text-white/45">The authorised person we may contact about this application.</p>
                <div className="mt-6 grid gap-5 sm:grid-cols-2">
                  <Field label="Full name" name="contact_name" value={values.contact_name} onChange={updateValue} required />
                  <Field label="Mobile number" name="contact_mobile" value={values.contact_mobile} onChange={updateValue} type="tel" placeholder="071 234 5678" />
                  <Field label="Email address" name="contact_email" value={values.contact_email} onChange={updateValue} type="email" required />
                  <Field label="ID or passport number" name="identity_number" value={values.identity_number} onChange={updateValue} />
                </div>
              </div> : null}
              {step === 2 ? <div>
                <h2 className="text-2xl font-extrabold">Funding requirement</h2>
                <p className="mt-2 text-sm text-white/45">Your choice controls the questions and document checklist shown next.</p>
                <div className="mt-6 grid gap-5 sm:grid-cols-2">
                  <label className="block text-sm font-semibold text-white/75">Funding type
                    <select className={inputClass} value={selectedProduct} onChange={(event) => setSearchParams({ product: event.target.value })}>
                      {products.data?.map((item) => <option key={item.code} value={item.code} className="bg-[#0a1d2a]">{item.display_name}</option>)}
                    </select>
                  </label>
                  <Field label="Amount requested" name="requested_amount" value={values.requested_amount} onChange={updateValue} type="number" required />
                  <Field label="Monthly turnover" name="monthly_turnover" value={values.monthly_turnover} onChange={updateValue} type="number" />
                  <Field label="Purpose of funding" name="funding_purpose" value={values.funding_purpose} onChange={updateValue} required />
                  <div className="sm:col-span-2"><Field label={product?.is_asset_backed ? "Asset or security offered" : "Available security (if any)"} name="asset_security" value={values.asset_security} onChange={updateValue} /></div>
                  <div className="sm:col-span-2"><Field label="Anything else we should know" name="notes" value={values.notes} onChange={updateValue} /></div>
                </div>
                {product?.max_requested_amount ? <p className="mt-4 text-xs text-[#86d4cf]">Maximum request for {product.display_name}: {formatMoney(String(product.max_requested_amount))}.</p> : null}
              </div> : null}
              {step === 3 ? <div>
                <h2 className="text-2xl font-extrabold">Review and submit</h2>
                <p className="mt-2 text-sm text-white/45">Check the summary. Once submitted, the application is locked for Owner review.</p>
                <dl className="mt-6 grid gap-3 sm:grid-cols-2">
                  {[["Business", values.registered_name], ["Contact", values.contact_name], ["Email", values.contact_email], ["Funding type", product?.display_name ?? selectedProduct], ["Amount", formatMoney(values.requested_amount)], ["Purpose", values.funding_purpose]].map(([label, value]) => (
                    <div key={label} className="rounded-2xl border border-white/8 bg-white/[0.035] p-4"><dt className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/35">{label}</dt><dd className="mt-2 text-sm font-semibold text-white/80">{value || "Not supplied"}</dd></div>
                  ))}
                </dl>
                <div className="mt-6 flex items-start gap-3 rounded-2xl border border-[#6ec144]/20 bg-[#6ec144]/8 p-4 text-xs leading-5 text-white/60"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#9ee67d]" aria-hidden="true" />By submitting, you confirm the information is accurate and may be processed for your funding application under the consent recorded in your Fund Now Capital relationship.</div>
              </div> : null}
            </fieldset>
          ) : null}

          {submitted ? <div className="mt-6 rounded-2xl border border-emerald-300/25 bg-emerald-400/10 p-4 text-sm font-semibold text-emerald-100">Application submitted. Fund Now Capital can now review it and activate your document checklist.</div> : null}
          <div className="mt-8 flex items-center justify-between border-t border-white/8 pt-5">
            <button type="button" disabled={step === 0} onClick={() => setStep((current) => Math.max(0, current - 1))} className="inline-flex min-h-11 items-center gap-2 rounded-2xl px-4 text-sm font-bold text-white/55 disabled:opacity-25"><ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back</button>
            {step < 3 ? <button type="button" onClick={() => setStep((current) => Math.min(3, current + 1))} className="inline-flex min-h-11 items-center gap-2 rounded-2xl bg-white/10 px-5 text-sm font-extrabold text-white">Continue <ArrowRight className="h-4 w-4" aria-hidden="true" /></button>
              : <button type="button" disabled={submitted || save.isPending} onClick={() => save.mutate(true)} className="inline-flex min-h-11 items-center gap-2 rounded-2xl bg-gradient-to-r from-[#6ec144] to-[#2ca8a8] px-5 text-sm font-extrabold text-[#06131d] disabled:opacity-45"><ClipboardList className="h-4 w-4" aria-hidden="true" /> Submit application</button>}
          </div>
        </section>
      </div>
    </ClientPortalShell>
  );
}
