export type ApplicationChoice = { id: string; product_code: string; status: string };
export function resolveApplicationChoice(rows: ApplicationChoice[], responseId: string | null, product: string | null, startNew: boolean) {
  const active = rows.filter(row => row.status !== "superseded");
  if (responseId) return { response: active.find(row => row.id === responseId), needsChoice: !active.some(row => row.id === responseId) };
  const candidates = product ? active.filter(row => row.product_code === product) : active;
  if (candidates.length === 1) return { response: candidates[0], needsChoice: false };
  return { response: undefined, needsChoice: candidates.length > 1 || (active.length > 0 && !startNew) };
}
export function applicationDealBlocked(dealId: string | null, rows: { dealId: string; isComplete: boolean }[] | undefined, loading: boolean, failed: boolean) {
  return Boolean(dealId && (loading || failed || !rows?.some(row => row.dealId === dealId && !row.isComplete)));
}
