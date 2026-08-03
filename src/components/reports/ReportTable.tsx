import { useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Download } from "lucide-react";
import { downloadCsv, type CsvColumn } from "@/lib/reports";

export interface ReportColumn<T> {
  key: string;
  header: string;
  align?: "left" | "right";
  // Comparable value used for sorting this column.
  sortValue: (row: T) => number | string;
  // Cell renderer.
  render: (row: T) => ReactNode;
}

type SortDir = "asc" | "desc";

// Generic sortable report table with a client-side CSV export. Sorting is
// header-click (toggles asc/desc); the exported CSV honours the current sort
// order so the file matches what the owner sees. POPIA-safe: owner data only,
// real names (no anonymisation on the owner side).
export function ReportTable<T>({
  title,
  columns,
  rows,
  getRowKey,
  defaultSortKey,
  defaultSortDir = "desc",
  emptyMessage,
  csvFilename,
  csvColumns,
}: {
  title: string;
  columns: ReportColumn<T>[];
  rows: T[];
  getRowKey: (row: T) => string;
  defaultSortKey: string;
  defaultSortDir?: SortDir;
  emptyMessage: string;
  csvFilename: string;
  csvColumns: CsvColumn<T>[];
}) {
  const [sortKey, setSortKey] = useState(defaultSortKey);
  const [sortDir, setSortDir] = useState<SortDir>(defaultSortDir);

  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sortKey);
    if (!col) return rows;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = col.sortValue(a);
      const bv = col.sortValue(b);
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }, [rows, columns, sortKey, sortDir]);

  const toggleSort = (key: string) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-brand-navy">{title}</h2>
        <button
          type="button"
          onClick={() => downloadCsv(csvFilename, sorted, csvColumns)}
          disabled={sorted.length === 0}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-medium text-brand-navy shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Download className="h-3.5 w-3.5" /> Export CSV
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              {columns.map((c) => {
                const active = c.key === sortKey;
                const SortIcon = !active ? ArrowUpDown : sortDir === "asc" ? ArrowUp : ArrowDown;
                return (
                  <th
                    key={c.key}
                    className={"px-4 py-3 font-semibold " + (c.align === "right" ? "text-right" : "")}
                  >
                    <button
                      type="button"
                      onClick={() => toggleSort(c.key)}
                      className={
                        "inline-flex items-center gap-1 hover:text-brand-navy " +
                        (c.align === "right" ? "flex-row-reverse" : "") +
                        (active ? " text-brand-navy" : "")
                      }
                    >
                      {c.header}
                      <SortIcon className="h-3 w-3" />
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-8 text-center text-sm text-muted-foreground"
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              sorted.map((row) => (
                <tr key={getRowKey(row)} className="border-b border-border last:border-0 hover:bg-slate-50">
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={
                        "px-4 py-3 " +
                        (c.align === "right" ? "text-right tabular-nums text-brand-navy" : "text-muted-foreground")
                      }
                    >
                      {c.render(row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
