import { useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Field, card, errorText, primaryButton, selectClass } from "@/components/staff/StaffShell";
import { DOCUMENT_TYPES, docTypeLabel } from "@/lib/documents";
import { useDocumentChecklist, useIntakeQueue, useRecordReceipt } from "@/hooks/useStaffDesk";

const VIA = [
  ["email", "Email"], ["secure_upload", "Secure upload"], ["whatsapp_business", "WhatsApp Business"],
  ["in_person", "In person"], ["other", "Other"],
] as const;

// Records that a document ARRIVED (type, channel, time). The file itself is not
// visible here: staff have no read path to stored documents by design.
export default function StaffDocumentTrackerPage() {
  const queue = useIntakeQueue(null, false);
  const [leadId, setLeadId] = useState<string | null>(null);
  const checklist = useDocumentChecklist(leadId);
  const record = useRecordReceipt(leadId);
  const [docType, setDocType] = useState("bank_statement");
  const [via, setVia] = useState("email");
  const [label, setLabel] = useState("");
  const selected = queue.data?.find((r) => r.lead_id === leadId);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await record.mutateAsync({ documentType: docType, via, label });
      toast.success("Receipt recorded");
      setLabel("");
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  return (
    <>
      <div>
        <h1 className="text-2xl font-bold text-brand-navy">Document tracker</h1>
        <p className="text-sm text-muted-foreground">Tick off documents as they arrive. A submission becomes ready for the Coordinator when every required document is in.</p>
      </div>

      <section className={card}>
        <Field label="Submission">
          <select className={selectClass} value={leadId ?? ""} onChange={(e) => setLeadId(e.target.value || null)}>
            <option value="">Choose a submission...</option>
            {(queue.data ?? []).map((r) => (
              <option key={r.lead_id} value={r.lead_id}>
                {r.business_name} · {r.funding_type_label} · {r.workflow_status.replace("_", " ")}
              </option>
            ))}
          </select>
        </Field>
        {queue.error ? <p role="alert" className="mt-2 text-sm text-red-600">{errorText(queue.error)}</p> : null}
      </section>

      {leadId ? (
        <>
          <section className={card}>
            <h2 className="mb-1 text-base font-bold text-brand-navy">{selected?.business_name}</h2>
            {selected?.has_review_flag ? (
              <p className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">The Owner is reviewing something on this file. Carry on recording documents as normal.</p>
            ) : null}
            {checklist.isLoading ? <p className="text-sm text-muted-foreground">Loading...</p> : null}
            {checklist.error ? <p role="alert" className="text-sm text-red-600">{errorText(checklist.error)}</p> : null}
            {checklist.data && checklist.data.length === 0 ? (
              <p className="text-sm text-muted-foreground">No required-document rules are configured for this funding type yet. Ask the Owner; the file cannot be marked Complete until they are.</p>
            ) : null}
            <ul className="divide-y divide-border">
              {(checklist.data ?? []).map((r) => (
                <li key={r.document_type} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span>
                    <span className={r.received ? "text-green-700" : "text-brand-navy"}>{r.received ? "✓" : "○"} {docTypeLabel(r.document_type)}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{r.requirement}</span>
                    {r.flagged_suspicious ? <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-800">flagged</span> : null}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {r.received ? `${r.received_count} received` : "missing"}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <form onSubmit={submit} className={`${card} grid gap-4 md:grid-cols-3`}>
            <Field label="Document">
              <select className={selectClass} value={docType} onChange={(e) => setDocType(e.target.value)}>
                {DOCUMENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </Field>
            <Field label="Received via">
              <select className={selectClass} value={via} onChange={(e) => setVia(e.target.value)}>
                {VIA.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </Field>
            <Field label="Note (optional)"><Input maxLength={120} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. March statement" /></Field>
            <div className="md:col-span-3"><button type="submit" disabled={record.isPending} className={primaryButton}>Record receipt</button></div>
          </form>
        </>
      ) : null}
    </>
  );
}
