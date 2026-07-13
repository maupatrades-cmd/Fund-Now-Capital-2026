// South African Rand formatting.
// The brand spec shows "R1,250,000" (comma thousands, no space). Note that the
// en-ZA locale actually groups with spaces ("R 1 250 000"), so we group with
// commas to match the brand example exactly.
const zarWhole = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const zarCents = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function toNumber(value: number | string | null | undefined): number {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function formatZAR(
  value: number | string | null | undefined,
  opts: { cents?: boolean } = {},
): string {
  const n = toNumber(value);
  return "R" + (opts.cents ? zarCents : zarWhole).format(n);
}

// Whole days between a past ISO timestamp and now.
export function daysSince(iso: string | null | undefined, now = new Date()): number {
  if (!iso) return 0;
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return 0;
  return Math.floor((now.getTime() - then) / 86_400_000);
}

// Compact relative time for the activity feed ("just now", "3d ago", "2w ago").
export function formatRelative(iso: string | null | undefined, now = new Date()): string {
  if (!iso) return "";
  const ms = now.getTime() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "";
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  return new Date(iso).toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// Start of the current month, used for month-to-date windows.
export function startOfMonth(now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), 1);
}
