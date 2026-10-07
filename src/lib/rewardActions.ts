export function canRecordRewardAction(status: string, action: string): boolean {
  if (action === "released") return status === "held";
  if (action === "held" || action === "carried_forward") return ["scheduled", "held", "released"].includes(status);
  if (action === "reversed") return ["scheduled", "held", "released", "carried_forward", "paid"].includes(status);
  return false;
}
