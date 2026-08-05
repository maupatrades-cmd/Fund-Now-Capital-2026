import { useRef } from "react";
import { Download } from "lucide-react";
import { downloadCsv, type CsvColumn } from "@/lib/statements";

// A rapid double-click fires two separate click events. Because downloadCsv is
// synchronous, releasing the guard in a `finally` would clear it before the
// second event is dispatched — so it must be released on a LATER task, after the
// double-click window has closed. 300ms comfortably spans a normal double-click
// without noticeably delaying a deliberate second export.
const GUARD_RELEASE_MS = 300;

/*
 * CSV export button with an in-flight guard (Fix #4 pattern). The guard is held
 * across the double-click window (see GUARD_RELEASE_MS) so a rapid double-click
 * produces a single download, keeping the surface consistent with every other
 * action button in the app. Disabled when there's nothing to export.
 */
export function ExportCsvButton<T>({
  filename,
  rows,
  columns,
  label = "Export CSV",
}: {
  filename: string;
  rows: T[];
  columns: CsvColumn<T>[];
  label?: string;
}) {
  const busy = useRef(false);

  function handleExport() {
    if (busy.current || rows.length === 0) return;
    busy.current = true;
    try {
      downloadCsv(filename, rows, columns);
    } finally {
      // Release on a later task so a second rapid click within the double-click
      // window is ignored (downloadCsv is synchronous — releasing here directly
      // would defeat the guard).
      window.setTimeout(() => {
        busy.current = false;
      }, GUARD_RELEASE_MS);
    }
  }

  return (
    <button
      type="button"
      onClick={handleExport}
      disabled={rows.length === 0}
      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-sm font-medium text-brand-navy hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
    >
      <Download className="h-4 w-4" />
      {label}
    </button>
  );
}
