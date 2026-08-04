import { useRef } from "react";
import { Download } from "lucide-react";
import { downloadCsv, type CsvColumn } from "@/lib/statements";

/*
 * CSV export button with an in-flight guard (Fix #4 pattern). The synchronous
 * Blob build + click can't really race, but the useRef guard keeps the surface
 * consistent with every other action button in the app and prevents a double
 * download from a rapid double-click. Disabled when there's nothing to export.
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
      busy.current = false;
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
