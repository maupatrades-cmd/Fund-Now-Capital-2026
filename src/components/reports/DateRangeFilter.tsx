import { PRESETS, presetRange, type DateRange, type PresetKey } from "@/lib/reports";

const inputCls =
  "rounded-lg border border-border bg-white px-3 py-1.5 text-sm outline-none focus:border-brand-teal focus:ring-2 focus:ring-brand-teal/20";

// Date-range control for the Reports header: quick presets + a custom
// from/to pair. The page owns both the preset key and the resolved range; this
// component just drives them. Picking a preset resolves the range immediately;
// editing a date input flips the preset to "custom".
export function DateRangeFilter({
  preset,
  range,
  onPreset,
  onRange,
}: {
  preset: PresetKey;
  range: DateRange;
  onPreset: (key: PresetKey) => void;
  onRange: (range: DateRange) => void;
}) {
  const pick = (key: PresetKey) => {
    onPreset(key);
    if (key !== "custom") onRange(presetRange(key));
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => pick(p.key)}
            className={
              "rounded-full border px-3 py-1 text-xs font-medium transition " +
              (preset === p.key
                ? "border-brand-teal bg-brand-teal/10 text-brand-teal"
                : "border-border text-muted-foreground hover:bg-slate-50")
            }
          >
            {p.label}
          </button>
        ))}
      </div>

      {preset === "custom" && (
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            From
            <input
              type="date"
              className={inputCls}
              value={range.from}
              max={range.to || undefined}
              onChange={(e) => onRange({ ...range, from: e.target.value })}
            />
          </label>
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            To
            <input
              type="date"
              className={inputCls}
              value={range.to}
              min={range.from || undefined}
              onChange={(e) => onRange({ ...range, to: e.target.value })}
            />
          </label>
        </div>
      )}
    </div>
  );
}
