import { toast } from "sonner";
import { card, errorText, selectClass } from "@/components/staff/StaffShell";
import {
  useConfirmDocumentRules, useOwnerDocumentRules, useSetDocumentRule, type DocumentRuleRow,
} from "@/hooks/useDocumentRules";

const PRODUCT_LABEL: Record<string, string> = {
  purchase_order_finance: "PO finance",
  invoice_discounting: "Invoice discounting",
  working_capital: "Working capital",
  equipment_finance: "Equipment finance (asset finance)",
  asset_backed_finance: "Asset-backed finance (asset finance)",
};

const label = (t: string) => t.replace(/_/g, " ");

// Owner-only. Draft lists come from the blueprint and are NOT enforced until confirmed here.
export default function DocumentRulesPage() {
  const rules = useOwnerDocumentRules();
  const confirm = useConfirmDocumentRules();
  const setRule = useSetDocumentRule();

  const byProduct = new Map<string, DocumentRuleRow[]>();
  for (const r of rules.data ?? []) byProduct.set(r.product_code, [...(byProduct.get(r.product_code) ?? []), r]);

  const onConfirm = async (code: string) => {
    if (!window.confirm(`Confirm the ${PRODUCT_LABEL[code] ?? code} list? Files of this type will then be unable to reach Complete until every required document is received.`)) return;
    try { const n = await confirm.mutateAsync(code); toast.success(`${n} rules confirmed.`); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not confirm."); }
  };

  const onChange = async (r: DocumentRuleRow, requirement: DocumentRuleRow["requirement"]) => {
    try { await setRule.mutateAsync({ productCode: r.product_code, documentType: r.document_type, requirement }); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not save."); }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4">
      <div>
        <h1 className="text-2xl font-bold text-brand-navy">Required documents</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          One list per product. A file cannot reach Complete until every required item is received.
          Lists marked <strong>draft</strong> were loaded from the blueprint and are not enforced until you confirm them.
        </p>
      </div>
      {rules.isError ? <p role="alert" className="text-sm text-red-700">{errorText(rules.error)}</p> : null}
      {[...byProduct.entries()].map(([code, rows]) => {
        const draft = rows.some((r) => r.is_draft);
        return (
          <section key={code} className={card}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-brand-navy">
                {PRODUCT_LABEL[code] ?? code}{" "}
                <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-semibold ${draft ? "bg-amber-100 text-amber-900" : "bg-green-100 text-green-900"}`}>
                  {draft ? "Draft, not enforced" : "Confirmed"}
                </span>
              </h2>
              {draft ? (
                <button type="button" disabled={confirm.isPending} onClick={() => void onConfirm(code)}
                  className="rounded-lg bg-brand-teal px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">
                  Confirm this list
                </button>
              ) : null}
            </div>
            <ul className="divide-y divide-border">
              {rows.map((r) => (
                <li key={r.document_type} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="capitalize">{label(r.document_type)}</span>
                  <select className={`${selectClass} w-40`} aria-label={`${label(r.document_type)} requirement`}
                    value={r.requirement} onChange={(e) => void onChange(r, e.target.value as DocumentRuleRow["requirement"])}>
                    <option value="required">Required</option>
                    <option value="optional">Optional</option>
                    <option value="waived">Waived</option>
                  </select>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {rules.data && rules.data.length === 0 ? <p className="text-sm text-muted-foreground">No lists loaded.</p> : null}
    </div>
  );
}
