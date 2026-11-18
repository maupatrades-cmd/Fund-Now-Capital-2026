import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Loader2, NotebookPen, Printer, Search } from "lucide-react";
import { toast } from "sonner";
import { useSession } from "@/lib/useSession";
import {
  addDays, dailyLogKeys, fetchDailyLog, fetchDailyLogActivity, formatLongDay, formatSastTime, sastToday,
  useDailyLog, useDailyLogActivity, useDailyLogList, useSaveDailyLog,
  type DailyLogActivity, type DailyLogDraft, type DailyLogEntry,
} from "@/hooks/useDailyLog";

// Private journal for the Director (/daily-log, inside <OwnerGate>) and for every enabled staff member
// (/staff/daily-log, 20261118161000). Each person reads and writes only their own log; the RPCs refuse anyone else.
// One entry per SAST day: three boxes, autosaved ~2 s after typing stops, beside what the CRM recorded that day.
// Printing renders a clean A4 sheet (text, not inputs) through window.print(); no PDF library.

const MAX = 8000;
const EMPTY: DailyLogDraft = { whatHappened: "", whatIDid: "", notes: "" };
const FIELDS: { key: keyof DailyLogDraft; label: string; placeholder: string }[] = [
  { key: "whatHappened", label: "What happened today", placeholder: "Meetings, calls, news, how the day went…" },
  { key: "whatIDid", label: "What I did", placeholder: "Work done, decisions made, people contacted…" },
  { key: "notes", label: "Notes for tomorrow", placeholder: "Follow-ups, reminders, priorities…" },
];

type SaveState = { kind: "idle" } | { kind: "saving" } | { kind: "saved"; at: string } | { kind: "error"; message: string };

function toDraft(e: DailyLogEntry | undefined): DailyLogDraft {
  return { whatHappened: e?.what_happened ?? "", whatIDid: e?.what_i_did ?? "", notes: e?.notes_for_tomorrow ?? "" };
}
const sameDraft = (a: DailyLogDraft, b: DailyLogDraft) => a.whatHappened === b.whatHappened && a.whatIDid === b.whatIDid && a.notes === b.notes;
const preview = (e: DailyLogEntry) => [e.what_happened, e.what_i_did, e.notes_for_tomorrow].filter(Boolean).join(" · ").slice(0, 140);

type PrintDay = { day: string; entry: DailyLogEntry; activity: DailyLogActivity[] };

export default function DailyLogPage({ staff = false }: { staff?: boolean }) {
  const session = useSession();
  const meta = session?.user?.user_metadata as { full_name?: string } | undefined;
  const writerName = meta?.full_name?.trim() || session?.user?.email || "";
  // The printed sheet names whose log it is: the Director's, or the staff member's own.
  const printLabel = staff ? `Private · Daily log of ${writerName}`.trim() : "Private · Director's daily log";
  const today = sastToday();
  const qc = useQueryClient();
  const [day, setDay] = useState(today);
  const entry = useDailyLog(day);
  const activity = useDailyLogActivity(day);
  const historyFrom = addDays(today, -89);
  const history = useDailyLogList(historyFrom, today);
  const save = useSaveDailyLog();

  const [draft, setDraft] = useState<DailyLogDraft>(EMPTY);
  const [baseline, setBaseline] = useState<DailyLogDraft>(EMPTY);
  const [loadedDay, setLoadedDay] = useState<string | null>(null);
  const [status, setStatus] = useState<SaveState>({ kind: "idle" });
  const [search, setSearch] = useState("");
  const [printDays, setPrintDays] = useState<PrintDay[] | null>(null);
  const [preparingPrint, setPreparingPrint] = useState(false);

  // Load the server copy only when a new day opens, never on a background refetch, so typing is never overwritten.
  useEffect(() => {
    if (entry.data && entry.data.log_date === day && loadedDay !== day) {
      const d = toDraft(entry.data);
      setDraft(d); setBaseline(d); setLoadedDay(day);
      setStatus(entry.data.saved_at ? { kind: "saved", at: entry.data.saved_at } : { kind: "idle" });
    }
  }, [entry.data, day, loadedDay]);

  const ready = loadedDay === day;
  const dirty = ready && !sameDraft(draft, baseline);
  const tooLong = FIELDS.some((f) => draft[f.key].length > MAX);

  const latest = useRef({ day, draft, dirty, tooLong });
  latest.current = { day, draft, dirty, tooLong };

  // doSave must keep the SAME identity across renders: the leave-the-page effect below depends on it, and a new
  // identity re-runs that effect's cleanup, which saves again (18 Nov: a save loop of 40+ saves a second). useMutation
  // returns a new object every render, but its mutateAsync is stable, so read it through a ref. One save at a time:
  // a request that arrives while one is in flight is remembered and sent once the first finishes.
  const mutateRef = useRef(save.mutateAsync);
  mutateRef.current = save.mutateAsync;
  const inFlight = useRef(false);
  const queued = useRef<{ d: string; value: DailyLogDraft } | null>(null);
  const doSave = useCallback(async (d: string, value: DailyLogDraft): Promise<boolean> => {
    if (inFlight.current) { queued.current = { d, value }; return true; }
    inFlight.current = true;
    setStatus({ kind: "saving" });
    try {
      const { savedAt } = await mutateRef.current({ day: d, draft: value });
      if (latest.current.day === d) { setBaseline(value); setStatus({ kind: "saved", at: savedAt }); }
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not save";
      if (latest.current.day === d) setStatus({ kind: "error", message });
      toast.error(`Daily log not saved: ${message}`);
      queued.current = null;
      return false;
    } finally {
      inFlight.current = false;
      const next = queued.current;
      queued.current = null;
      if (next && !sameDraft(next.value, value)) void doSaveRef.current(next.d, next.value);
    }
  }, []);
  const doSaveRef = useRef(doSave);
  doSaveRef.current = doSave;

  // Autosave ~2 s after typing stops.
  useEffect(() => {
    if (!dirty || tooLong) return;
    const t = window.setTimeout(() => { void doSave(day, draft); }, 2000);
    return () => window.clearTimeout(t);
  }, [draft, dirty, tooLong, day, doSave]);

  // Warn before closing the tab with unsaved text; save what is there when leaving the page inside the app.
  // Runs once (mount/unmount only): the cleanup must never run after an ordinary save.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (latest.current.dirty) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
      const l = latest.current;
      if (l.dirty && !l.tooLong) void doSaveRef.current(l.day, l.draft);
    };
  }, []);

  async function goTo(next: string) {
    if (next > today || next === day) return;
    if (dirty && !tooLong) {
      const ok = await doSave(day, draft);
      if (!ok) return;
    }
    setDay(next);
  }

  // Print one day or the 7 days ending on the selected day (each day its own page).
  async function print(days: string[]) {
    if (dirty && !tooLong) await doSave(day, draft);
    setPreparingPrint(true);
    try {
      const sheets = await Promise.all(days.map(async (d) => ({
        day: d,
        entry: await qc.fetchQuery({ queryKey: dailyLogKeys.day(d), queryFn: () => fetchDailyLog(d) }),
        activity: await qc.fetchQuery({ queryKey: dailyLogKeys.activity(d), queryFn: () => fetchDailyLogActivity(d) }),
      })));
      setPrintDays(sheets);
    } catch (err) {
      toast.error(`Could not prepare the print: ${err instanceof Error ? err.message : "unknown error"}`);
    } finally {
      setPreparingPrint(false);
    }
  }
  useEffect(() => {
    if (!printDays) return;
    const done = () => setPrintDays(null);
    window.addEventListener("afterprint", done, { once: true });
    const t = window.setTimeout(() => window.print(), 50);
    return () => { window.clearTimeout(t); window.removeEventListener("afterprint", done); };
  }, [printDays]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const rows = history.data ?? [];
    if (!term) return rows;
    return rows.filter((e) => [e.what_happened, e.what_i_did, e.notes_for_tomorrow].some((t) => t?.toLowerCase().includes(term)));
  }, [history.data, search]);

  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(day, i - 6));

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-12">
      <header className="rounded-3xl bg-brand-navy px-5 py-6 text-white shadow-sm sm:px-7">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand-teal">Private · only you can see this</p>
        <h1 className="mt-2 flex items-center gap-2 text-2xl font-bold sm:text-3xl"><NotebookPen className="h-7 w-7" aria-hidden="true" /> {staff ? "My daily log" : "Daily log"}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-white/70">Write down what happened and what you did each day. It saves by itself as you type.</p>
      </header>

      <section className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        <button type="button" onClick={() => void goTo(addDays(day, -1))} aria-label="Previous day" className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-xl border border-slate-200 text-brand-navy hover:bg-slate-50"><ChevronLeft className="h-4 w-4" /></button>
        <input type="date" aria-label="Day" max={today} value={day} onChange={(e) => { if (e.target.value) void goTo(e.target.value); }} className="h-10 rounded-xl border border-slate-200 px-3 text-sm" />
        <button type="button" onClick={() => void goTo(addDays(day, 1))} disabled={day >= today} aria-label="Next day" className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-xl border border-slate-200 text-brand-navy hover:bg-slate-50 disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
        {day !== today ? <button type="button" onClick={() => void goTo(today)} className="h-10 rounded-xl border border-slate-200 px-3 text-sm font-semibold text-brand-navy hover:bg-slate-50">Today</button> : null}
        <h2 className="ml-1 text-sm font-bold text-brand-navy sm:text-base">{formatLongDay(day)}</h2>
        <div className="ml-auto flex flex-wrap gap-2">
          <button type="button" disabled={preparingPrint || !ready} onClick={() => void print([day])} className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 px-3 text-sm font-semibold text-brand-navy hover:bg-slate-50 disabled:opacity-50">
            {preparingPrint ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Printer className="h-4 w-4" aria-hidden="true" />} Print / Save as PDF
          </button>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5" aria-label="Today's entry">
          {entry.isError ? <p className="text-sm text-red-600">Could not load this day. Refresh the page.</p> : null}
          {!ready && !entry.isError ? <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p> : null}
          {ready ? FIELDS.map((f) => (
            <label key={f.key} className="block">
              <span className="text-sm font-semibold text-brand-navy">{f.label}</span>
              <textarea
                value={draft[f.key]}
                onChange={(e) => { const v = e.target.value; setDraft((d) => ({ ...d, [f.key]: v })); }}
                placeholder={f.placeholder}
                rows={6}
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm leading-6 focus:border-brand-teal focus:outline-none focus:ring-2 focus:ring-brand-teal/30"
              />
              <span className={`text-xs ${draft[f.key].length > MAX ? "text-red-600" : "text-slate-400"}`}>{draft[f.key].length} / {MAX}</span>
            </label>
          )) : null}
          {ready ? (
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" disabled={!dirty || tooLong || status.kind === "saving"} onClick={() => void doSave(day, draft)} className="h-10 rounded-xl bg-brand-teal px-5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">Save</button>
              <SaveStatus status={status} dirty={dirty} tooLong={tooLong} onRetry={() => void doSave(day, draft)} />
            </div>
          ) : null}
        </section>

        <aside className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" aria-label="From the CRM today">
          <h2 className="text-sm font-bold text-brand-navy">From the CRM {day === today ? "today" : "that day"}</h2>
          <p className="text-xs text-slate-500">What the system recorded for you on this day.</p>
          {activity.isLoading ? <p className="text-xs text-slate-500">Loading…</p> : null}
          {activity.isError ? <p className="text-xs text-red-600">Could not load the CRM activity.</p> : null}
          {activity.data && activity.data.length === 0 ? <p className="text-xs text-slate-500">Nothing recorded.</p> : null}
          <ul className="max-h-[520px] space-y-2 overflow-y-auto">
            {(activity.data ?? []).map((a, i) => (
              <li key={`${a.occurred_at}-${i}`} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs">
                <span className="font-semibold text-brand-navy">{formatSastTime(a.occurred_at)}</span>
                <span className="ml-2 text-slate-500">{a.entity_type.replaceAll("_", " ")}</span>
                <p className="mt-0.5 text-slate-700">{a.description ?? a.event_type}</p>
              </li>
            ))}
          </ul>
        </aside>
      </div>

      <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5" aria-label="History">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-bold text-brand-navy">History</h2>
          <span className="text-xs text-slate-500">last 90 days</span>
          <label className="relative ml-auto">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search your notes" aria-label="Search your notes" className="h-10 w-56 rounded-xl border border-slate-200 pl-9 pr-3 text-sm" />
          </label>
          <button type="button" disabled={preparingPrint} onClick={() => void print(weekDays)} className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 px-3 text-sm font-semibold text-brand-navy hover:bg-slate-50 disabled:opacity-50">
            <Printer className="h-4 w-4" aria-hidden="true" /> Print this week
          </button>
        </div>
        <p className="text-xs text-slate-500">"Print this week" prints the 7 days ending {formatLongDay(day)}, each day on its own page.</p>
        {history.isLoading ? <p className="text-sm text-slate-500">Loading…</p> : null}
        {history.data && filtered.length === 0 ? <p className="text-sm text-slate-500">{search ? "No day matches your search." : "No entries yet."}</p> : null}
        <ul className="divide-y divide-slate-100">
          {filtered.map((e) => (
            <li key={e.log_date}>
              <button type="button" onClick={() => void goTo(e.log_date)} className={`w-full px-2 py-3 text-left hover:bg-slate-50 ${e.log_date === day ? "bg-brand-teal/5" : ""}`}>
                <p className="text-sm font-semibold text-brand-navy">{formatLongDay(e.log_date)}</p>
                <p className="mt-0.5 line-clamp-2 text-xs text-slate-600">{preview(e) || "(empty)"}</p>
              </button>
            </li>
          ))}
        </ul>
      </section>

      {printDays ? createPortal(<PrintSheet days={printDays} label={printLabel} />, document.body) : null}
    </div>
  );
}

function SaveStatus({ status, dirty, tooLong, onRetry }: { status: SaveState; dirty: boolean; tooLong: boolean; onRetry: () => void }) {
  if (tooLong) return <span className="text-xs font-semibold text-red-600">A box is over {MAX} characters; shorten it to save.</span>;
  if (status.kind === "saving") return <span className="inline-flex items-center gap-1 text-xs text-slate-500"><Loader2 className="h-3 w-3 animate-spin" /> Saving…</span>;
  if (status.kind === "error") return <span className="text-xs text-red-600">Not saved — <button type="button" onClick={onRetry} className="font-semibold underline">retry</button></span>;
  if (dirty) return <span className="text-xs text-amber-700">Unsaved changes</span>;
  if (status.kind === "saved") return <span className="text-xs text-emerald-700">Saved {formatSastTime(status.at)}</span>;
  return null;
}

// The printable sheet. While it exists, a print stylesheet hides the whole app (#root) and shows only this.
function PrintSheet({ days, label }: { days: PrintDay[]; label: string }) {
  const printedAt = new Date().toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg", dateStyle: "long", timeStyle: "short" });
  return (
    <div className="daily-log-print">
      <style>{`
        .daily-log-print { display: none; }
        @media print {
          @page { size: A4; margin: 16mm 15mm; }
          body > #root { display: none !important; }
          .daily-log-print { display: block; color: #1f2937; font-family: Inter, Arial, Helvetica, sans-serif; }
          .daily-log-print .dl-day { break-after: page; page-break-after: always; }
          .daily-log-print .dl-day:last-child { break-after: auto; page-break-after: auto; }
        }
      `}</style>
      {days.map(({ day, entry, activity }) => (
        <section key={day} className="dl-day">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", borderBottom: "3px solid #2da8b8", paddingBottom: 8, marginBottom: 16 }}>
            <img src="/fnc-logo.png" alt="Fund Now Capital" style={{ height: 40 }} />
            <span style={{ fontSize: 10, color: "#64748b" }}>{label}</span>
          </div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: "#1a3a52", margin: "0 0 16px" }}>Daily log — {formatLongDay(day)}</h1>
          {[
            ["What happened today", entry.what_happened],
            ["What I did", entry.what_i_did],
            ["Notes for tomorrow", entry.notes_for_tomorrow],
          ].map(([label, text]) => (
            <div key={label as string} style={{ marginBottom: 14, breakInside: "avoid" }}>
              <h2 style={{ fontSize: 13, fontWeight: 700, color: "#1a3a52", margin: "0 0 4px" }}>{label}</h2>
              <p style={{ fontSize: 12, lineHeight: 1.6, whiteSpace: "pre-wrap", margin: 0, color: text ? "#1f2937" : "#94a3b8" }}>{text || "Nothing written."}</p>
            </div>
          ))}
          <h2 style={{ fontSize: 13, fontWeight: 700, color: "#1a3a52", margin: "18px 0 6px" }}>From the CRM that day</h2>
          {activity.length === 0 ? <p style={{ fontSize: 11, color: "#94a3b8", margin: 0 }}>Nothing recorded.</p> : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10.5 }}>
              <tbody>
                {activity.map((a, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #e2e8f0" }}>
                    <td style={{ padding: "3px 6px 3px 0", whiteSpace: "nowrap", verticalAlign: "top", fontWeight: 600 }}>{formatSastTime(a.occurred_at)}</td>
                    <td style={{ padding: "3px 6px", whiteSpace: "nowrap", verticalAlign: "top", color: "#64748b" }}>{a.entity_type.replaceAll("_", " ")}</td>
                    <td style={{ padding: "3px 0", verticalAlign: "top" }}>{a.description ?? a.event_type}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p style={{ marginTop: 24, fontSize: 9, color: "#94a3b8" }}>Printed {printedAt} · Fund Now Capital · Many funders. More approvals.</p>
        </section>
      ))}
    </div>
  );
}
