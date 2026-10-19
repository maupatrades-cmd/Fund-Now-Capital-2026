import { useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Field, SAFE_TEXT_NOTE, card, errorText, primaryButton, textareaClass } from "@/components/staff/StaffShell";
import { NoticesInbox } from "@/components/comms/NoticesInbox";
import { canDecideTimeRequests, useStaffRole } from "@/hooks/useStaffDesk";
import { useNoticeBoard, usePostNotice, type NoticeAudience } from "@/hooks/useComms";

// Notices (owner spec §8): the Administrator or the Founder posts a notice to staff, sub-agents and/or Team
// Leaders. "Needs attention" asks every recipient to acknowledge it; the board shows who still has to.
const fmt = (iso: string) => new Date(iso).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg", dateStyle: "medium", timeStyle: "short" });
const GROUPS: [NoticeAudience, string][] = [["staff", "Staff"], ["sub_agents", "Sub-agents"], ["team_leaders", "Team Leaders"]];

function PostNotice() {
  const post = usePostNotice();
  const [f, setF] = useState({ title: "", body: "", attention: false, audience: ["staff"] as NoticeAudience[] });
  const toggle = (a: NoticeAudience) => setF({ ...f, audience: f.audience.includes(a) ? f.audience.filter((x) => x !== a) : [...f.audience, a] });
  return (
    <form className={`${card} space-y-3`} onSubmit={(e) => {
      e.preventDefault();
      post.mutate({ title: f.title, body: f.body, needsAttention: f.attention, audience: f.audience }, {
        onSuccess: () => { toast.success("Notice posted"); setF({ title: "", body: "", attention: false, audience: ["staff"] }); },
        onError: (x) => toast.error(errorText(x)),
      });
    }}>
      <h2 className="text-base font-bold text-brand-navy">Post a notice</h2>
      <Field label="Title"><Input maxLength={160} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
      <Field label="Notice" hint={SAFE_TEXT_NOTE}><textarea className={textareaClass} maxLength={4000} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></Field>
      <fieldset className="flex flex-wrap items-center gap-4 text-sm">
        <legend className="mb-1 text-sm font-semibold text-brand-navy">Send to</legend>
        {GROUPS.map(([v, l]) => (
          <label key={v} className="flex items-center gap-2"><input type="checkbox" checked={f.audience.includes(v)} onChange={() => toggle(v)} />{l}</label>
        ))}
      </fieldset>
      <label className="flex items-center gap-2 text-sm font-semibold text-amber-800">
        <input type="checkbox" checked={f.attention} onChange={(e) => setF({ ...f, attention: e.target.checked })} />
        Needs attention (everyone must acknowledge it)
      </label>
      <button type="submit" className={primaryButton} disabled={f.title.trim().length < 3 || f.body.trim().length < 3 || !f.audience.length || post.isPending}>Post notice</button>
    </form>
  );
}

function Board() {
  const board = useNoticeBoard(true);
  return (
    <section className={`${card} space-y-3`}>
      <h2 className="text-base font-bold text-brand-navy">Notices sent</h2>
      {board.error ? <p role="alert" className="text-sm text-red-600">{errorText(board.error)}</p> : null}
      <ul className="divide-y divide-border">
        {(board.data ?? []).map((n) => (
          <li key={n.notice_id} className="space-y-1 py-3 text-sm">
            <p className="font-semibold text-brand-navy">
              {n.title}
              {n.needs_attention ? <span className="ml-2 rounded bg-amber-200 px-1.5 py-0.5 text-xs text-amber-900">Needs attention</span> : null}
            </p>
            <p className="text-xs text-muted-foreground">{fmt(n.created_at)} · by {n.posted_by} · {n.audience.join(", ").replace("_", "-")}</p>
            {n.needs_attention ? (
              <p className="text-xs">
                {n.acknowledged} of {n.recipients} acknowledged
                {n.outstanding.length ? <span className="block text-amber-800">Still to acknowledge: {n.outstanding.join(", ")}</span> : null}
              </p>
            ) : <p className="text-xs">{n.recipients} people</p>}
          </li>
        ))}
        {board.data && board.data.length === 0 ? <li className="py-3 text-sm text-muted-foreground">No notices posted yet.</li> : null}
      </ul>
    </section>
  );
}

export default function StaffNoticesPage() {
  const { data: role } = useStaffRole();
  const manager = canDecideTimeRequests(role);
  return (
    <div className="space-y-5">
      {manager ? <PostNotice /> : null}
      {manager ? <Board /> : null}
      <section className={`${card} space-y-3`}>
        <h2 className="text-base font-bold text-brand-navy">My notices</h2>
        <NoticesInbox />
      </section>
    </div>
  );
}
