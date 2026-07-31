import { Badge } from "@/components/ui/badge";
import { EARNING_STATE_META, type EarningState } from "@/lib/partnerEarnings";

// Consistent earning-state chip used in the Partner Earnings table + drill-down.
export function EarningStateChip({ state }: { state: EarningState }) {
  const meta = EARNING_STATE_META[state];
  return <Badge className={"ring-1 ring-inset " + (meta?.badge ?? "")}>{meta?.label ?? state}</Badge>;
}
