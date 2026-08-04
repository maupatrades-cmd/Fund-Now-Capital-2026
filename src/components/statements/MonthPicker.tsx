import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  addMonth,
  isFutureMonth,
  MONTH_NAMES,
  yearOptions,
  type YearMonth,
} from "@/lib/statements";

/*
 * Month-only picker for the statements surface (no custom date ranges — a
 * statement is always one calendar month). Prev / Next arrows plus a Month + Year
 * <select> pair; "Next" is disabled once it would step into the future.
 */
export function MonthPicker({
  value,
  onChange,
}: {
  value: YearMonth;
  onChange: (next: YearMonth) => void;
}) {
  const years = yearOptions();
  const nextDisabled = isFutureMonth(addMonth(value, 1));

  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        aria-label="Previous month"
        onClick={() => onChange(addMonth(value, -1))}
        className="rounded-lg border border-border p-2 text-brand-navy hover:bg-slate-50"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>

      <select
        aria-label="Month"
        value={value.month}
        onChange={(e) => onChange({ ...value, month: Number(e.target.value) })}
        className="rounded-lg border border-border bg-white px-2.5 py-2 text-sm font-medium text-brand-navy"
      >
        {MONTH_NAMES.map((name, i) => (
          <option key={name} value={i + 1}>
            {name}
          </option>
        ))}
      </select>

      <select
        aria-label="Year"
        value={value.year}
        onChange={(e) => onChange({ ...value, year: Number(e.target.value) })}
        className="rounded-lg border border-border bg-white px-2.5 py-2 text-sm font-medium text-brand-navy"
      >
        {/* Guard against a value.year that predates the option list (e.g. an old
            bookmarked month) so the current selection is always selectable. */}
        {(years.includes(value.year) ? years : [value.year, ...years]).map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>

      <button
        type="button"
        aria-label="Next month"
        disabled={nextDisabled}
        onClick={() => onChange(addMonth(value, 1))}
        className="rounded-lg border border-border p-2 text-brand-navy hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}
