import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Download, FileBarChart, Loader2, Printer, Search } from "lucide-react";
import { toast } from "sonner";
import {
  useFileSearch, useFilesReport, useMarkFileRewardPaid, usePeopleSearch, useSetFileReward,
  type FileHit, type FilesReportRow, type StageFilter,
} from "@/hooks/useFilesReport";

// Files report (owner, 20 Nov 2026): per month, every file the Director moved to Submitted (or later) and every file
// whose R100 she chose, with the stage (In credit highlighted), who captured / handles it, the source, the R29 status
// and the R100 beneficiary. She chooses who gets the R100 for ANY deal, lead or client (an agent, staff or field
// person, or a typed name), marks agent / outside R100s paid, and prints or downloads the report.

const sastMonth = (offset: number) => {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Africa/Johannesburg" }));
  const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
};
const monthName = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-ZA", { month: "long", year: "numeric", timeZone: "UTC" });
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-ZA", { day: "numeric", month: "short", timeZone: "Africa/Johannesburg" }) : "—");
const rand = (n: number | string | null | undefined) =>
  new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR", maximumFractionDigits: 2 }).format(Number(n ?? 0)).replace("ZAR", "R");
const stageLabel = (s: string | null) => (s ? s.replaceAll("_", " ") : "no deal");
const r100Status = (r: FilesReportRow["r100"]) =>
  !r ? "—" : r.status === "paid" ? `Paid ${day(r.paid_on)} (${r.paid_reference})` : r.status === "on_payslip" ? "On payslip" : "To pay";
const r29Status = (r: FilesReportRow["r29"]) =>
  !r ? "—" : !r.counts_in_month ? `${r.handler} (other month)` : `${r.handler}: ${r.on_payslip ? "on payslip" : r.signed_off ? "signed off" : "counts"}`;
const input = "h-10 w-full rounded-lg border border-slate-200 px-3 text-sm";

function csv(rows: FilesReportRow[]) {
  const cell = (v: unknown) => `"${String(v ?? "").replaceAll('"', '""')}"`;
  const head = ["Business", "Deal", "Stage", "Submitted", "In credit", "Captured by", "Handler", "Source", "R29", "R100 to", "R100 amount", "R100 status"];
  const body = rows.map((r) => [r.business_name, r.deal_reference, stageLabel(r.stage), day(r.reached_submitted_at), day(r.reached_in_credit_at),
    r.captured_by, r.handler, r.source, r29Status(r.r29), r.r100?.beneficiary, r.r100?.amount, r100Status(r.r100)].map(cell).join(","));
  return [head.map(cell).join(","), ...body].join("\r\n");
}

// Choose who gets the R100 for any file.
function ChooseR100() {
  const [fileQ, setFileQ] = useState("");
  const [file, setFile] = useState<FileHit | null>(null);
  const [personQ, setPersonQ] = useState("");
  const [personId, setPersonId] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [reason, setReason] = useState("");
  const files = useFileSearch(fileQ);
  const people = usePeopleSearch(personQ);
  const save = useSetFileReward();
  const submit = () => {
    if (!file) return toast.error("Choose the client or file");
    if (!personId && typed.trim().length < 2) return toast.error("Choose a person or type the name of who gets the R100");
    save.mutate({ file, profileId: personId, name: personId ? null : typed.trim(), reason }, {
      onSuccess: () => { toast.success("R100 recipient saved"); setFile(null); setFileQ(""); setPersonId(null); setPersonQ(""); setTyped(""); setReason(""); },
      onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save"),
    });
  };
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm print:hidden">
      <h2 className="text-base font-bold text-brand-navy">Choose who gets the R100</h2>
      <p className="mt-1 text-xs text-slate-500">Any client, lead or deal. Pick a person on the CRM, or type a name for someone who is not.</p>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div>
          <label className="block text-xs font-semibold text-slate-700">Client or file
            <div className="relative mt-1"><Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" aria-hidden="true" />
              <input className={`${input} pl-9`} value={file ? file.label : fileQ} placeholder="Type a business name or deal number"
                onChange={(e) => { setFile(null); setFileQ(e.target.value); }} /></div>
          </label>
          {!file && files.data?.length ? (
            <ul className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-slate-200 text-sm">
              {files.data.map((f) => (
                <li key={`${f.kind}-${f.deal_id ?? f.lead_id ?? f.client_id}`}>
                  <button type="button" className="w-full px-3 py-2 text-left hover:bg-slate-50" onClick={() => setFile(f)}>
                    {f.label} <span className="text-xs text-slate-500">· {f.detail}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-700">Person on the CRM
            <input className={`${input} mt-1`} value={personQ} placeholder="Agent, field person or staff name"
              onChange={(e) => { setPersonId(null); setPersonQ(e.target.value); }} disabled={typed.trim().length > 0} />
          </label>
          {!personId && people.data?.length ? (
            <ul className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-slate-200 text-sm">
              {people.data.map((p) => (
                <li key={p.profile_id}>
                  <button type="button" className="w-full px-3 py-2 text-left hover:bg-slate-50" onClick={() => { setPersonId(p.profile_id); setPersonQ(p.name); }}>
                    {p.name} <span className="text-xs text-slate-500">· {p.role.replaceAll("_", " ")} ({p.kind === "agent" ? "agent" : "staff"})</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <label className="mt-2 block text-xs font-semibold text-slate-700">…or type a name (not on the CRM)
            <input className={`${input} mt-1`} value={typed} maxLength={120} disabled={!!personId}
              onChange={(e) => setTyped(e.target.value)} placeholder="Full name" />
          </label>
        </div>
      </div>
      <label className="mt-3 block text-xs font-semibold text-slate-700">Why (optional)
        <input className={`${input} mt-1`} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
      </label>
      <button type="button" onClick={submit} disabled={save.isPending}
        className="mt-3 inline-flex h-10 items-center gap-2 rounded-xl bg-brand-teal px-5 text-sm font-semibold text-white disabled:opacity-50">
        {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null} Save R100 recipient (R100.00)
      </button>
    </section>
  );
}

function MarkPaid({ row }: { row: FilesReportRow }) {
  const mark = useMarkFileRewardPaid();
  if (!row.r100 || row.r100.status !== "to_pay" || row.r100.kind === "staff") return null;
  return (
    <button type="button" className="text-xs font-semibold text-brand-teal underline print:hidden" disabled={mark.isPending}
      onClick={() => {
        const reference = window.prompt(`Payment reference for ${row.r100?.beneficiary}'s R100?`)?.trim();
        if (!reference) return;
        const paidOn = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" });
        mark.mutate({ id: row.r100!.id, paidOn, reference }, {
          onSuccess: () => toast.success("Marked paid"), onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save"),
        });
      }}>Mark paid</button>
  );
}

export default function FilesReportPage() {
  const [month, setMonth] = useState(sastMonth(0));
  const [stage, setStage] = useState<StageFilter>("all");
  const report = useFilesReport(month, stage);
  const rows = useMemo(() => report.data?.rows ?? [], [report.data]);
  const download = () => {
    const blob = new Blob([csv(rows)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `files-report-${month.slice(0, 7)}-${stage}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const printedAt = new Intl.DateTimeFormat("en-ZA", { timeZone: "Africa/Johannesburg", dateStyle: "medium", timeStyle: "short" }).format(new Date());

  return (
    <div className="space-y-5">
      <div className="rounded-2xl bg-brand-navy p-5 text-white print:hidden">
        <h1 className="flex items-center gap-2 text-2xl font-bold sm:text-3xl"><FileBarChart className="h-7 w-7" aria-hidden="true" /> Files report</h1>
        <p className="mt-1 text-sm text-white/70">Files submitted, In credit and later, with the R29 and R100 for each.</p>
      </div>

      <ChooseR100 />

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <select aria-label="Month" className="h-10 rounded-lg border border-slate-200 px-2 text-sm" value={month} onChange={(e) => setMonth(e.target.value)}>
            {[0, -1, -2, -3, -4, -5].map((o) => <option key={o} value={sastMonth(o)}>{monthName(sastMonth(o))}</option>)}
          </select>
          <select aria-label="Stage" className="h-10 rounded-lg border border-slate-200 px-2 text-sm" value={stage} onChange={(e) => setStage(e.target.value as StageFilter)}>
            <option value="all">All stages</option><option value="submitted">Submitted</option>
            <option value="in_credit">In credit</option><option value="later">After In credit</option>
          </select>
          <button type="button" onClick={() => window.print()} className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm font-semibold text-brand-navy"><Printer className="h-4 w-4" aria-hidden="true" /> Print / Save as PDF</button>
          <button type="button" onClick={download} disabled={!rows.length} className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm font-semibold text-brand-navy disabled:opacity-50"><Download className="h-4 w-4" aria-hidden="true" /> Download CSV</button>
        </div>
        {report.error ? <p role="alert" className="mt-3 text-sm text-red-600">{report.error instanceof Error ? report.error.message : "Could not load the report"}</p> : null}
        {report.isLoading ? <p className="mt-3 text-sm text-slate-500">Loading…</p> : null}
        {report.data ? (
          <>
            <p className="mt-3 text-sm">
              <strong>{monthName(report.data.month)}</strong> · R29: {report.data.r29_count} × {rand(report.data.r29_rate)} = <strong>{rand(report.data.r29_total)}</strong>
              {" "}· R100: {report.data.r100_count} = <strong>{rand(report.data.r100_total)}</strong>
            </p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[900px] border-collapse text-sm">
                <thead><tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                  <th className="py-2 pr-2">Business</th><th className="pr-2">Deal</th><th className="pr-2">Stage</th><th className="pr-2">Submitted</th>
                  <th className="pr-2">In credit</th><th className="pr-2">Captured / handler</th><th className="pr-2">Source</th><th className="pr-2">R29</th><th>R100</th>
                </tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={`${r.deal_id ?? r.lead_id ?? r.client_id}`} className={`border-b border-slate-100 align-top ${r.in_credit ? "bg-amber-50" : ""}`}>
                      <td className="py-2 pr-2 font-medium text-brand-navy">{r.business_name}</td>
                      <td className="pr-2">{r.deal_reference ?? "—"}</td>
                      <td className={`pr-2 capitalize ${r.in_credit ? "font-bold text-amber-700" : ""}`}>{stageLabel(r.stage)}</td>
                      <td className="pr-2">{day(r.reached_submitted_at)}</td>
                      <td className="pr-2">{day(r.reached_in_credit_at)}</td>
                      <td className="pr-2">{r.captured_by ?? "—"}<span className="block text-xs text-slate-500">{r.handler ? `handler ${r.handler}` : ""}</span></td>
                      <td className="pr-2">{r.source ?? "—"}</td>
                      <td className="pr-2">{r29Status(r.r29)}</td>
                      <td>{r.r100 ? <>{r.r100.beneficiary} · {rand(r.r100.amount)}<span className="block text-xs text-slate-500">{r100Status(r.r100)} · {r.r100.path}</span><MarkPaid row={r} /></> : "—"}</td>
                    </tr>
                  ))}
                  {rows.length === 0 ? <tr><td colSpan={9} className="py-4 text-center text-slate-500">No files for this month and stage.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </section>

      {report.data ? createPortal(
        <div className="diary-print-sheet hidden print:block" aria-hidden="true">
          <header className="flex items-center justify-between border-b-2 border-[#2da8b8] pb-3">
            <img src="/fnc-logo.png" alt="Fund Now Capital" className="h-10 w-auto" />
            <h1 className="text-right text-lg font-bold text-[#1a3a52]">Files report — {monthName(report.data.month)}{stage !== "all" ? ` (${stage.replace("_", " ")})` : ""}</h1>
          </header>
          <p className="mt-3 text-[11px]">R29: {report.data.r29_count} × {rand(report.data.r29_rate)} = {rand(report.data.r29_total)} · R100: {report.data.r100_count} = {rand(report.data.r100_total)}</p>
          <table className="mt-2 w-full border-collapse text-[10px]">
            <thead><tr className="border-b border-slate-400 text-left"><th>Business</th><th>Deal</th><th>Stage</th><th>Submitted</th><th>In credit</th><th>Captured / handler</th><th>Source</th><th>R29</th><th>R100</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={`p-${r.deal_id ?? r.lead_id ?? r.client_id}`} className="border-b border-slate-200 align-top">
                <td>{r.business_name}</td><td>{r.deal_reference ?? "—"}</td><td style={r.in_credit ? { fontWeight: 700 } : undefined}>{stageLabel(r.stage)}</td>
                <td>{day(r.reached_submitted_at)}</td><td>{day(r.reached_in_credit_at)}</td><td>{r.captured_by ?? "—"}{r.handler ? ` / ${r.handler}` : ""}</td>
                <td>{r.source ?? "—"}</td><td>{r29Status(r.r29)}</td><td>{r.r100 ? `${r.r100.beneficiary} ${rand(r.r100.amount)} · ${r100Status(r.r100)}` : "—"}</td>
              </tr>))}</tbody>
          </table>
          <footer className="mt-4 text-[10px] text-slate-500">Printed {printedAt}</footer>
        </div>, document.body) : null}
    </div>
  );
}
