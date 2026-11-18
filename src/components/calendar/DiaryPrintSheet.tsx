import { createPortal } from "react-dom";
import { formatCalendarDay, formatCalendarTime } from "@/lib/ownerCalendar";

// A clean A4 agenda of the shown day or week, printed (or saved as PDF) with the browser's own print dialog.
// Only this sheet is printed: the print stylesheet in index.css hides everything else (sidebar, top bar, buttons,
// forms). The caller decides what goes in, so a Personal event reaches the staff sheet only as "Busy".
export type DiaryPrintItem = {
  id: string;
  startsAt: string;
  endsAt: string;
  type: string;
  title: string;
  link?: string | null;
  place?: string | null;
  notes?: string | null;
};

export function DiaryPrintSheet({ heading, items, printedBy }: { heading: string; items: DiaryPrintItem[]; printedBy: string }) {
  const sorted = [...items].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const byDay = new Map<string, DiaryPrintItem[]>();
  for (const item of sorted) {
    const day = formatCalendarDay(item.startsAt, true);
    byDay.set(day, [...(byDay.get(day) ?? []), item]);
  }
  const printedAt = new Intl.DateTimeFormat("en-ZA", {
    timeZone: "Africa/Johannesburg", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(new Date());

  // Rendered straight into <body> so it prints from the top of the page whatever layout the page sits in.
  return createPortal(
    <div className="diary-print-sheet hidden print:block" aria-hidden="true">
      <header className="flex items-center justify-between border-b-2 border-[#2da8b8] pb-3">
        <img src="/fnc-logo.png" alt="Fund Now Capital" className="h-10 w-auto" />
        <h1 className="text-right text-lg font-bold text-[#1a3a52]">Director&apos;s diary — {heading}</h1>
      </header>
      {sorted.length === 0 ? <p className="mt-6 text-sm">No events.</p> : null}
      {[...byDay.entries()].map(([day, dayItems]) => (
        <section key={day} className="mt-5 break-inside-avoid">
          <h2 className="border-b border-slate-300 pb-1 text-sm font-bold text-[#1a3a52]">{day}</h2>
          <table className="mt-1 w-full border-collapse text-[11px]">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="w-24 py-1 pr-2 font-semibold">Time</th>
                <th className="w-24 py-1 pr-2 font-semibold">Type</th>
                <th className="py-1 pr-2 font-semibold">Event</th>
                <th className="w-40 py-1 font-semibold">Client / lead · place</th>
              </tr>
            </thead>
            <tbody>
              {dayItems.map((item) => (
                <tr key={item.id} className="border-t border-slate-200 align-top">
                  <td className="py-1.5 pr-2 font-semibold">{formatCalendarTime(item.startsAt)}–{formatCalendarTime(item.endsAt)}</td>
                  <td className="py-1.5 pr-2">{item.type}</td>
                  <td className="py-1.5 pr-2">
                    <span className="font-semibold">{item.title}</span>
                    {item.notes ? <span className="mt-0.5 block whitespace-pre-line text-slate-600">{item.notes}</span> : null}
                  </td>
                  <td className="py-1.5">{[item.link, item.place].filter(Boolean).join(" · ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
      <footer className="mt-8 border-t border-slate-300 pt-2 text-[10px] text-slate-500">
        Printed {printedAt} by {printedBy} · Fund Now Capital · Confidential
      </footer>
    </div>,
    document.body,
  );
}
