import { Badge } from "@/components/ui/badge";
import type { CommissionState } from "@/lib/commissionPicker";

// Visual for the commission lifecycle. `null` = no picker configured yet.
const STATE_STYLE: Record<CommissionState | "none", { label: string; cls: string }> = {
  none: { label: "No commission set", cls: "bg-slate-100 text-slate-600 ring-slate-200" },
  potential: { label: "POTENTIAL", cls: "bg-amber-100 text-amber-800 ring-amber-200" },
  pending: { label: "PENDING", cls: "bg-sky-100 text-sky-800 ring-sky-200" },
  locked: { label: "LOCKED", cls: "bg-brand-green/15 text-brand-green ring-brand-green/30" },
};

export function CommissionStateBadge({ state }: { state: CommissionState | null }) {
  const s = STATE_STYLE[state ?? "none"];
  return <Badge className={"ring-1 ring-inset " + s.cls}>{s.label}</Badge>;
}
