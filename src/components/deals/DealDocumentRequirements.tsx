import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ClipboardCheck, Clock3, ExternalLink, Plus, Save, Trash2, TriangleAlert } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { useClientDocuments } from "@/hooks/useClientDocuments";
import { useFunders } from "@/hooks/useFunders";
import { DOCUMENT_CATEGORIES, docTypeLabel, typesInCategory, type DocumentType } from "@/lib/documents";
import { supabase } from "@/lib/supabase";

type FundingProduct = {
  code: string;
  display_name: string;
};

type RuleContext = {
  product_code: string;
  funder_id: string | null;
};

type ChecklistItem = {
  document_type: DocumentType;
  requirement: "required" | "optional";
  client_safe_reason: string | null;
};

type OwnerOverride = ChecklistItem & {
  id: string;
};

type ClientProductChoice = {
  product_code: string;
  status: string;
};

const inputClass =
  "min-h-10 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:border-brand-teal focus:ring-2 focus:ring-brand-teal/20";

function verificationLabel(status: "unverified" | "accepted" | "rejected" | undefined) {
  if (status === "accepted") return { label: "Approved", icon: CheckCircle2, className: "text-emerald-700" };
  if (status === "rejected") return { label: "Needs replacement", icon: TriangleAlert, className: "text-red-700" };
  if (status === "unverified") return { label: "Awaiting review", icon: Clock3, className: "text-sky-700" };
  return { label: "Outstanding", icon: Clock3, className: "text-amber-700" };
}

export function DealDocumentRequirements({ dealId, clientId }: { dealId: string; clientId: string }) {
  const queryClient = useQueryClient();
  const funders = useFunders();
  const documents = useClientDocuments(clientId);
  const [productCode, setProductCode] = useState("");
  const [funderId, setFunderId] = useState("");
  const [documentType, setDocumentType] = useState<DocumentType>("bank_statement");
  const [requirement, setRequirement] = useState<"required" | "optional">("required");
  const [reason, setReason] = useState("");

  const products = useQuery({
    queryKey: ["funding-product-catalog"],
    queryFn: async (): Promise<FundingProduct[]> => {
      const { data, error } = await supabase
        .from("funding_product_catalog")
        .select("code,display_name")
        .eq("is_active", true)
        .order("display_name");
      if (error) throw error;
      return (data ?? []) as FundingProduct[];
    },
  });

  const context = useQuery({
    queryKey: ["deal-document-rule-context", dealId],
    queryFn: async (): Promise<RuleContext | null> => {
      const { data, error } = await supabase
        .from("deal_document_rule_contexts")
        .select("product_code,funder_id")
        .eq("deal_id", dealId)
        .maybeSingle();
      if (error) throw error;
      return data as RuleContext | null;
    },
  });

  const clientChoice = useQuery({
    queryKey: ["client-product-choice", clientId],
    queryFn: async (): Promise<ClientProductChoice | null> => {
      const { data, error } = await supabase
        .from("client_form_responses")
        .select("product_code,status")
        .eq("client_id", clientId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as ClientProductChoice | null;
    },
  });

  const checklist = useQuery({
    queryKey: ["deal-document-checklist", dealId],
    enabled: Boolean(context.data),
    queryFn: async (): Promise<ChecklistItem[]> => {
      const { data, error } = await supabase.rpc("client_document_checklist", { p_deal_id: dealId });
      if (error) throw error;
      return (data ?? []) as ChecklistItem[];
    },
  });

  const overrides = useQuery({
    queryKey: ["deal-document-overrides", dealId],
    queryFn: async (): Promise<OwnerOverride[]> => {
      const { data, error } = await supabase
        .from("document_requirement_rules")
        .select("id,document_type,requirement,client_safe_reason")
        .eq("rule_scope", "owner_override")
        .eq("deal_id", dealId)
        .eq("is_active", true)
        .order("document_type");
      if (error) throw error;
      return (data ?? []) as OwnerOverride[];
    },
  });

  const contextProductCode = context.data?.product_code;
  const contextFunderId = context.data?.funder_id;
  const clientProductCode = clientChoice.data?.product_code;

  useEffect(() => {
    if (contextProductCode) {
      setProductCode(contextProductCode);
      setFunderId(contextFunderId ?? "");
      return;
    }
    if (!productCode && clientProductCode) setProductCode(clientProductCode);
  }, [clientProductCode, contextFunderId, contextProductCode, productCode]);

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["deal-document-rule-context", dealId] }),
      queryClient.invalidateQueries({ queryKey: ["deal-document-checklist", dealId] }),
      queryClient.invalidateQueries({ queryKey: ["deal-document-overrides", dealId] }),
      queryClient.invalidateQueries({ queryKey: ["client-document-workspace"] }),
    ]);
  };

  const saveContext = useMutation({
    mutationFn: async () => {
      if (!productCode) throw new Error("Select the funding product first.");
      if (
        context.data?.product_code &&
        context.data.product_code !== productCode &&
        (overrides.data?.length ?? 0) > 0
      ) {
        throw new Error("Remove the deal's Owner overrides before changing its funding product.");
      }
      const { data, error } = await supabase
        .from("deal_document_rule_contexts")
        .upsert(
          { deal_id: dealId, product_code: productCode, funder_id: funderId || null },
          { onConflict: "deal_id" },
        )
        .select("deal_id")
        .single();
      if (error) throw error;
      if (data.deal_id !== dealId) throw new Error("The checklist context was not saved.");
    },
    onSuccess: async () => {
      await refresh();
      toast.success("Client document checklist updated.");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Checklist setup failed."),
  });

  const saveOverride = useMutation({
    mutationFn: async () => {
      if (!context.data) throw new Error("Save the funding route before adding documents.");
      const existing = overrides.data?.find((item) => item.document_type === documentType);
      const payload = {
        product_code: context.data.product_code,
        requirement,
        client_safe_reason: reason.trim() || null,
      };
      if (existing) {
        const { data, error } = await supabase
          .from("document_requirement_rules")
          .update(payload)
          .eq("id", existing.id)
          .select("id");
        if (error) throw error;
        if (data?.length !== 1) throw new Error("The document requirement was not updated.");
        return;
      }
      const { data, error } = await supabase
        .from("document_requirement_rules")
        .insert({
          ...payload,
          rule_scope: "owner_override",
          deal_id: dealId,
          funder_id: null,
          document_type: documentType,
        })
        .select("id");
      if (error) throw error;
      if (data?.length !== 1) throw new Error("The document requirement was not added.");
    },
    onSuccess: async () => {
      setReason("");
      await refresh();
      toast.success("Required document added to the client checklist.");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Requirement save failed."),
  });

  const removeOverride = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase
        .from("document_requirement_rules")
        .delete()
        .eq("id", id)
        .eq("deal_id", dealId)
        .select("id");
      if (error) throw error;
      if (data?.length !== 1) throw new Error("The document requirement was not removed.");
    },
    onSuccess: async () => {
      await refresh();
      toast.success("Owner override removed.");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Requirement removal failed."),
  });

  const currentDealDocuments = useMemo(
    () => (documents.data ?? []).filter((document) => document.deal_id === dealId && document.is_current_version),
    [dealId, documents.data],
  );
  const documentByType = new Map(currentDealDocuments.map((document) => [document.document_type, document]));
  const overrideByType = new Map((overrides.data ?? []).map((override) => [override.document_type, override]));
  const productName = products.data?.find((product) => product.code === clientChoice.data?.product_code)?.display_name;
  const hasUnsavedContext = productCode !== (context.data?.product_code ?? "") || funderId !== (context.data?.funder_id ?? "");

  return (
    <section className="rounded-xl border border-border bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5 text-brand-teal" aria-hidden="true" />
            <h3 className="text-sm font-semibold text-brand-navy">Client document requirements</h3>
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Confirm the route, then add only requirements supported by the product, funder paperwork, or an Owner decision.
          </p>
        </div>
        <Link to={`/clients/${clientId}`} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-teal hover:underline">
          Review uploads <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </div>

      {clientChoice.data ? (
        <div className="mt-4 rounded-lg border border-sky-200 bg-sky-50 p-3 text-xs text-sky-900">
          Client selected <strong>{productName ?? clientChoice.data.product_code.replaceAll("_", " ")}</strong>
          {clientChoice.data.status === "submitted" ? " in their submitted application." : " in their saved application draft."}
        </div>
      ) : null}

      {products.error || funders.error || context.error || clientChoice.error ? (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
          Some checklist setup data could not be loaded. Refresh before making changes.
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
        <label className="text-xs font-medium text-muted-foreground">
          Funding product
          <select className={`${inputClass} mt-1`} value={productCode} onChange={(event) => setProductCode(event.target.value)}>
            <option value="">Select product</option>
            {(products.data ?? []).map((product) => <option key={product.code} value={product.code}>{product.display_name}</option>)}
          </select>
        </label>
        <label className="text-xs font-medium text-muted-foreground">
          Funder context (optional)
          <select className={`${inputClass} mt-1`} value={funderId} onChange={(event) => setFunderId(event.target.value)}>
            <option value="">No funder selected yet</option>
            {(funders.data ?? []).filter((funder) => funder.is_active).map((funder) => <option key={funder.id} value={funder.id}>{funder.name}</option>)}
          </select>
        </label>
        <button type="button" disabled={!productCode || saveContext.isPending || !hasUnsavedContext} onClick={() => saveContext.mutate()}
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-brand-teal px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          <Save className="h-4 w-4" aria-hidden="true" /> {saveContext.isPending ? "Saving…" : "Save route"}
        </button>
      </div>

      {context.data ? (
        <div className="mt-5 rounded-xl border border-dashed border-border bg-slate-50 p-4">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-brand-navy">Add or change an Owner requirement</h4>
          <div className="mt-3 grid gap-3 lg:grid-cols-[1.2fr_0.7fr_1.5fr_auto] lg:items-end">
            <label className="text-xs font-medium text-muted-foreground">Document
              <select className={`${inputClass} mt-1`} value={documentType} onChange={(event) => setDocumentType(event.target.value as DocumentType)}>
                {DOCUMENT_CATEGORIES.map((category) => <optgroup key={category.value} label={category.label}>
                  {typesInCategory(category.value).map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
                </optgroup>)}
              </select>
            </label>
            <label className="text-xs font-medium text-muted-foreground">Requirement
              <select className={`${inputClass} mt-1`} value={requirement} onChange={(event) => setRequirement(event.target.value as "required" | "optional")}>
                <option value="required">Required</option>
                <option value="optional">Optional</option>
              </select>
            </label>
            <label className="text-xs font-medium text-muted-foreground">Client-safe reason
              <input className={`${inputClass} mt-1`} value={reason} maxLength={240} onChange={(event) => setReason(event.target.value)} placeholder="Why the client needs to provide this" />
            </label>
            <button type="button" disabled={saveOverride.isPending} onClick={() => saveOverride.mutate()}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-brand-teal px-4 py-2 text-sm font-semibold text-brand-navy disabled:opacity-50">
              <Plus className="h-4 w-4" aria-hidden="true" /> Add
            </button>
          </div>
        </div>
      ) : null}

      <div className="mt-5 space-y-2">
        {(checklist.data ?? []).map((item) => {
          const document = documentByType.get(item.document_type);
          const status = verificationLabel(document?.verification_status);
          const StatusIcon = status.icon;
          const ownerOverride = overrideByType.get(item.document_type);
          return (
            <div key={item.document_type} className="flex flex-col gap-3 rounded-lg border border-border px-4 py-3 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-brand-navy">{docTypeLabel(item.document_type)}</span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-slate-600">{item.requirement}</span>
                  {ownerOverride ? <span className="rounded-full bg-brand-teal/10 px-2 py-0.5 text-[10px] font-semibold text-brand-teal">Owner override</span> : null}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{item.client_safe_reason || "Required for the confirmed funding route."}</p>
              </div>
              <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${status.className}`}><StatusIcon className="h-4 w-4" aria-hidden="true" />{status.label}</span>
              {ownerOverride ? <button type="button" aria-label={`Remove ${docTypeLabel(item.document_type)} override`} disabled={removeOverride.isPending}
                onClick={() => removeOverride.mutate(ownerOverride.id)} className="inline-flex min-h-9 items-center justify-center rounded-lg border border-red-200 px-2 text-red-700 hover:bg-red-50 disabled:opacity-50">
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </button> : null}
            </div>
          );
        })}
        {context.data && !checklist.isLoading && (checklist.data?.length ?? 0) === 0 ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            No approved paperwork rules are configured for this route yet. Add the exact requirements from the product or funder paperwork above; the system will not invent a checklist.
          </div>
        ) : null}
        {!context.data && !context.isLoading ? <p className="rounded-lg bg-slate-50 p-4 text-sm text-muted-foreground">Save the funding route to publish a client-safe checklist.</p> : null}
      </div>
    </section>
  );
}
