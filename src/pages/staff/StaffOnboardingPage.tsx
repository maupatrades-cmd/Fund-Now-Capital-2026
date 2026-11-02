import { useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { card, errorText, primaryButton, SAFE_TEXT_NOTE } from "@/components/staff/StaffShell";
import { useStaffRole } from "@/hooks/useStaffDesk";
import {
  useAgentOnboarding, useMarkOnboardingItem, useStaffIssueAgentCode,
  type AgentOnboardingRow, type OnboardingItem,
} from "@/hooks/useQualifiedRewardPayroll";

// Agent onboarding (owner decision 30 Oct 2026). HR ticks the four documents and records the iFacts date; the Sales
// Coordinator issues the Agent Code once everything is in; the Director can issue at any time, with a reason when the
// checklist is incomplete. Only ticks and dates live here: never type ID or bank numbers.
const ROLE_LABEL: Record<AgentOnboardingRow["role"], string> = { partner: "Partner / Team Leader", contractor: "Direct agent", lead_referrer: "Sub-agent" };
const DOCS: { item: Exclude<OnboardingItem, "ifacts_cleared">; label: string; at: keyof AgentOnboardingRow }[] = [
  { item: "signed_contract", label: "Signed contract", at: "signed_contract_at" },
  { item: "certified_id", label: "Certified ID", at: "certified_id_at" },
  { item: "bank_letter", label: "Bank letter", at: "bank_letter_at" },
  { item: "ifacts_consent", label: "iFacts consent", at: "ifacts_consent_at" },
];
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" });
const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-ZA", { timeZone: "Africa/Johannesburg", day: "numeric", month: "short" });

function AgentRow({ r, canMark, canIssue, isOwner }: { r: AgentOnboardingRow; canMark: boolean; canIssue: boolean; isOwner: boolean }) {
  const mark = useMarkOnboardingItem();
  const issue = useStaffIssueAgentCode();
  const [code, setCode] = useState("");
  const [clearedOn, setClearedOn] = useState(r.ifacts_cleared_on ?? today());
  const [reason, setReason] = useState("");
  const closed = Boolean(r.agent_code);
  const onError = (e: unknown) => toast.error(errorText(e));

  const toggle = (item: OnboardingItem, received: boolean) => {
    const note = received ? null : window.prompt("Why is this tick being taken back? (no ID or bank numbers)") ?? "";
    if (!received && !note?.trim()) return;
    mark.mutate({ profileId: r.profile_id, item, received, note }, { onSuccess: () => toast.success("Checklist updated"), onError });
  };
  const override = isOwner && !r.ready;

  return (
    <li className="space-y-3 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-semibold text-brand-navy">{r.full_name ?? "Unnamed"} <span className="text-sm font-normal text-muted-foreground">· {ROLE_LABEL[r.role]}</span></p>
        {closed
          ? <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">Agent Code {r.agent_code}</span>
          : <span className={`rounded-full px-3 py-1 text-xs font-semibold ${r.ready ? "bg-teal-50 text-brand-teal" : "bg-amber-50 text-amber-900"}`}>{r.ready ? "Ready for an Agent Code" : "Onboarding"}</span>}
      </div>
      <ul className="flex flex-wrap gap-2 text-xs">
        {DOCS.map((d) => {
          const at = r[d.at] as string | null;
          return (
            <li key={d.item}>
              <label className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2">
                <input type="checkbox" checked={Boolean(at)} disabled={!canMark || closed || mark.isPending}
                  onChange={(e) => toggle(d.item, e.target.checked)} aria-label={`${d.label} received`} />
                <span>{d.label}{at ? ` · ${shortDate(at)}` : ""}</span>
              </label>
            </li>
          );
        })}
        <li className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2">
          {r.ifacts_cleared_on ? <span>iFacts cleared {r.ifacts_cleared_on}</span> : canMark && !closed ? (
            <>
              <span>iFacts cleared on</span>
              <Input type="date" className="h-8 w-36" max={today()} value={clearedOn} onChange={(e) => setClearedOn(e.target.value)} aria-label="Date iFacts cleared" />
              <button type="button" className="font-semibold text-brand-teal underline disabled:opacity-50" disabled={mark.isPending || !clearedOn}
                onClick={() => mark.mutate({ profileId: r.profile_id, item: "ifacts_cleared", received: true, clearedOn }, { onSuccess: () => toast.success("iFacts date saved"), onError })}>Save</button>
            </>
          ) : <span className="text-muted-foreground">iFacts not cleared yet</span>}
          {r.ifacts_cleared_on && canMark && !closed ? (
            <button type="button" className="text-muted-foreground underline" disabled={mark.isPending} onClick={() => toggle("ifacts_cleared", false)}>undo</button>
          ) : null}
        </li>
      </ul>
      {!closed && (canIssue || isOwner) ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Input className="h-9 w-40" placeholder="Agent Code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} aria-label={`Agent Code for ${r.full_name ?? "this agent"}`} />
          {override && !r.ifacts_cleared_on ? (
            <Input type="date" className="h-9 w-40" max={today()} value={clearedOn} onChange={(e) => setClearedOn(e.target.value)} aria-label="Date iFacts cleared (override)" />
          ) : null}
          {override ? (
            <Input className="h-9 min-w-56 flex-1" placeholder="Reason for issuing before the checklist is complete" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Override reason" />
          ) : null}
          <button type="button" className={`${primaryButton} !h-9 !px-4`}
            disabled={issue.isPending || !/^[A-Z0-9][A-Z0-9-]{2,23}$/.test(code.trim()) || (!isOwner && !r.ready) || (override && reason.trim().length < 5)}
            onClick={() => issue.mutate({
              profileId: r.profile_id, agentCode: code.trim(),
              clearedOn: isOwner ? (r.ifacts_cleared_on ?? clearedOn) : null, overrideReason: override ? reason.trim() : null,
            }, { onSuccess: (c) => { toast.success(`Agent Code ${c} issued`); setCode(""); setReason(""); }, onError })}>
            {override ? "Issue (Director override)" : "Issue Agent Code"}
          </button>
          {!isOwner && !r.ready ? <span className="text-xs text-muted-foreground">Waiting for HR to tick all four documents and the iFacts date.</span> : null}
        </div>
      ) : null}
    </li>
  );
}

export default function StaffOnboardingPage() {
  const { data: role } = useStaffRole();
  const allowed = role === "owner" || role === "hr" || role === "administrator" || role === "coordinator";
  const q = useAgentOnboarding(allowed);
  const [filter, setFilter] = useState<"open" | "all">("open");
  if (!allowed) return <p className="text-sm text-muted-foreground">This screen is for the Director, HR, the Office Administrator and the Sales Coordinator.</p>;
  const rows = (q.data ?? []).filter((r) => filter === "all" || !r.agent_code);
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-brand-navy">Agent onboarding</h1>
        <p className="text-sm text-muted-foreground">
          HR ticks the four documents and the date iFacts cleared. The Sales Coordinator or the Office Administrator then issues the Agent Code. No R100 or commission is paid
          before the Agent Code, and an R100 is forfeited if the code is not issued within 30 days of the submission.
        </p>
        {role === "hr" || role === "owner" ? <p className="mt-1 text-xs text-muted-foreground">{SAFE_TEXT_NOTE}</p> : null}
      </div>
      <div className="flex gap-2 text-sm">
        {(["open", "all"] as const).map((f) => (
          <button key={f} type="button" onClick={() => setFilter(f)}
            className={`rounded-lg px-3 py-1.5 font-semibold ${filter === f ? "bg-brand-teal text-white" : "border border-border text-brand-navy"}`}>
            {f === "open" ? "Still onboarding" : "Everyone"}
          </button>
        ))}
      </div>
      {q.error ? <p role="alert" className="text-sm text-red-600">{errorText(q.error)}</p> : null}
      {q.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      <section className={card}>
        {q.data && rows.length === 0 ? <p className="text-sm text-muted-foreground">{filter === "open" ? "Everyone has an Agent Code." : "No agents yet."}</p> : null}
        <ul className="divide-y divide-border">
          {rows.map((r) => (
            <AgentRow key={r.profile_id} r={r} canMark={role === "hr" || role === "owner"} canIssue={role === "coordinator" || role === "administrator"} isOwner={role === "owner"} />
          ))}
        </ul>
      </section>
    </div>
  );
}
