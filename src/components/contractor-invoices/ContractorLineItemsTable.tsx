import { useRef } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { formatZAR } from "@/lib/format";
import { toNum, type ContractorInvoiceLineItem } from "@/lib/contractorInvoices";
import { useRemoveContractorLineItem } from "@/hooks/useContractorInvoices";

/*
 * Contractor invoice line-item table. Shows the contractor's TAKE only + neutral
 * deal/client references — no funder name (contractor tier rows carry none) and
 * no FNC gross/tier math (S7C).
 *
 * `editable` shows a remove button per line (draft only). Removing is a DEFINER
 * RPC that recomputes the invoice total server-side.
 */
export function ContractorLineItemsTable({
  invoiceId,
  items,
  editable = false,
}: {
  invoiceId: string;
  items: ContractorInvoiceLineItem[];
  editable?: boolean;
}) {
  const remove = useRemoveContractorLineItem();
  const removingRef = useRef(false);

  const onRemove = async (lineItemId: string) => {
    if (removingRef.current) return; // ignore a fast double-click already in flight
    removingRef.current = true;
    try {
      await remove.mutateAsync({ lineItemId, invoiceId });
      toast.success("Line item removed");
    } catch (e) {
      toast.error((e as Error).message || "Could not remove the line item");
    } finally {
      removingRef.current = false;
    }
  };

  if (items.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border bg-slate-50 p-4 text-center text-sm text-muted-foreground">
        No line items on this invoice.
      </p>
    );
  }

  const total = items.reduce((sum, li) => sum + toNum(li.amount), 0);

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[480px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="py-2 pr-3 font-medium">Deal</th>
            <th className="py-2 pr-3 font-medium">Client</th>
            <th className="py-2 pr-3 text-right font-medium">Commission</th>
            {editable && <th className="py-2 pl-3" />}
          </tr>
        </thead>
        <tbody>
          {items.map((li) => (
            <tr key={li.line_item_id} className="border-b border-border/60">
              <td className="py-2.5 pr-3 font-medium text-brand-navy">{li.deal_reference ?? "—"}</td>
              <td className="py-2.5 pr-3 text-muted-foreground">{li.client_business_name ?? "—"}</td>
              <td className="py-2.5 pr-3 text-right font-medium text-brand-navy">
                {formatZAR(li.amount, { cents: true })}
              </td>
              {editable && (
                <td className="py-2.5 pl-3 text-right">
                  <button
                    type="button"
                    onClick={() => void onRemove(li.line_item_id)}
                    disabled={remove.isPending}
                    className="inline-flex items-center gap-1 rounded-md border border-red-200 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
                    aria-label={`Remove ${li.deal_reference ?? "line item"}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Remove
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td className="py-2.5 pr-3 text-right font-semibold text-brand-navy" colSpan={2}>
              Total
            </td>
            <td className="py-2.5 pr-3 text-right font-bold text-brand-navy">
              {formatZAR(total, { cents: true })}
            </td>
            {editable && <td />}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
