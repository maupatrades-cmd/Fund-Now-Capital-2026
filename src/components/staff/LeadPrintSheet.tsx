import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Printer } from "lucide-react";
import { toast } from "sonner";
import { errorText } from "@/components/staff/StaffShell";
import { fetchIntakeSheet, type IntakeSheet } from "@/hooks/useStaffDesk";
import { formatZAR } from "@/lib/format";
import { useSession } from "@/lib/useSession";

// The printable lead form (owner, 19 Nov: "PDF of the lead form after being captured"). A clean A4 page printed (or saved
// as PDF) with the browser's own print dialog. It reuses the diary print stylesheet in index.css: when a page shows a
// .diary-print-sheet, printing shows only that sheet. The data comes from staff_intake_sheet (printable fields only).
const ghostButton = "inline-flex h-10 items-center justify-center rounded-lg border border-border bg-white px-3 text-sm font-semibold text-brand-navy hover:bg-slate-50 disabled:opacity-50";
const ROLE_LABEL: Record<string, string> = {
  owner: "Director", administrator: "Office Administrator", coordinator: "Sales Coordinator", switchboard: "Switchboard",
  hr: "HR", field_supervisor: "Field Supervisor", field_consultant: "Field consultant",
};
const CHANNEL_LABEL: Record<string, string> = {
  direct_agent: "Direct agent (independent)", team: "Team (through a Team Leader)", referral_partner: "Referral partner organisation",
  field: "Fund Now Capital field team", inhouse: "Fund Now Capital (in-house)",
};
const FLAG_LABEL: Record<string, string> = {
  recent_submission: "Possible duplicate: a recent submission for this business",
  duplicate_contact: "Possible duplicate: the contact details match another file",
  registration_conflict: "Registration number already exists",
};
const sast = (iso: string | Date) => new Intl.DateTimeFormat("en-ZA", {
  timeZone: "Africa/Johannesburg", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
}).format(typeof iso === "string" ? new Date(iso) : iso);

function forWhom(s: IntakeSheet): string {
  if (s.source_label) return s.source_label;
  const parts = [s.organisation_name, s.team_name, s.agent_name].filter(Boolean);
  return parts.length ? parts.join(" · ") : "—";
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <tr className="border-t border-slate-200 align-top">
      <th className="w-48 py-1.5 pr-3 text-left font-semibold text-slate-600">{label}</th>
      <td className="py-1.5 whitespace-pre-line">{value && String(value).trim() ? value : "—"}</td>
    </tr>
  );
}

export function LeadPrintSheet({ sheet, printedBy }: { sheet: IntakeSheet; printedBy: string }) {
  const amount = sheet.requested_amount == null ? null : formatZAR(Number(sheet.requested_amount));
  const purpose = Array.isArray(sheet.funding_purpose) ? sheet.funding_purpose.join(", ") : null;
  return createPortal(
    <div className="diary-print-sheet hidden print:block" aria-hidden="true">
      <header className="flex items-center justify-between border-b-2 border-[#2da8b8] pb-3">
        <img src="/fnc-logo.png" alt="Fund Now Capital" className="h-10 w-auto" />
        <div className="text-right">
          <h1 className="text-lg font-bold text-[#1a3a52]">Lead form — {sheet.business_name}</h1>
          <p className="text-[11px] text-slate-600">Reference {sheet.reference}</p>
        </div>
      </header>
      <table className="mt-4 w-full border-collapse text-[12px]">
        <tbody>
          <Row label="Captured" value={sast(sheet.registered_at)} />
          <Row label="Captured by" value={[sheet.captured_by_name, sheet.captured_by_role ? ROLE_LABEL[sheet.captured_by_role] ?? sheet.captured_by_role : null].filter(Boolean).join(" · ")} />
          <Row label="Business name" value={sheet.business_name} />
          <Row label="Registration number (CIPC)" value={sheet.cipc_number} />
          <Row label="Contact person" value={sheet.contact_name} />
          <Row label="Contact cell" value={sheet.contact_cell} />
          <Row label="Contact email" value={sheet.contact_email} />
          <Row label="Funding type" value={sheet.funding_type_label} />
          <Row label="Amount requested" value={amount} />
          <Row label="Purpose" value={purpose} />
          <Row label="Channel" value={CHANNEL_LABEL[sheet.channel] ?? sheet.channel} />
          <Row label="Who the sale is for" value={forWhom(sheet)} />
          <Row label="What the caller said" value={sheet.claimed_agent_reference} />
          <Row label="Review flags" value={sheet.review_flags.length ? sheet.review_flags.map((f) => FLAG_LABEL[f] ?? f).join("\n") : "None"} />
          <Row label="Documents still missing" value={sheet.missing_documents.length ? sheet.missing_documents.join("\n") : "None"} />
        </tbody>
      </table>
      <footer className="mt-8 border-t border-slate-300 pt-2 text-[10px] text-slate-500">
        Printed {sast(new Date())} by {printedBy} · Fund Now Capital · Many funders. More approvals.
      </footer>
    </div>,
    document.body,
  );
}

// "Print lead form (PDF)": fetches the sheet, renders it, then opens the print dialog (choose "Save as PDF" for a file).
export function PrintLeadFormButton({ leadId, label = "Print lead form (PDF)" }: { leadId: string; label?: string }) {
  const session = useSession();
  const printedBy = (session?.user?.user_metadata?.full_name as string | undefined) || session?.user?.email || "staff";
  const [sheet, setSheet] = useState<IntakeSheet | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!sheet) return;
    const t = window.setTimeout(() => window.print(), 100);
    const done = () => setSheet(null);
    window.addEventListener("afterprint", done);
    return () => { window.clearTimeout(t); window.removeEventListener("afterprint", done); };
  }, [sheet]);

  const open = async () => {
    setBusy(true);
    try {
      setSheet(await fetchIntakeSheet(leadId));
    } catch (err) {
      toast.error(`Could not prepare the lead form: ${errorText(err)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button type="button" className={`${ghostButton} gap-2`} onClick={() => void open()} disabled={busy}>
        <Printer className="h-4 w-4" aria-hidden="true" /> {busy ? "Preparing…" : label}
      </button>
      {sheet ? <LeadPrintSheet sheet={sheet} printedBy={printedBy} /> : null}
    </>
  );
}
