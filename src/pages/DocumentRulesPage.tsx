import { useState } from "react";
import { toast } from "sonner";
import { card, errorText, selectClass } from "@/components/staff/StaffShell";
import {
  ENTITY_TYPES, LEVEL_LABEL, useConfirmDocList, useDocListDetail, useDocListsOverview, useEditDocItem,
  type DocLevel, type DocListOverview,
} from "@/hooks/useDocLists";

const LEVEL_CLASS: Record<DocLevel, string> = {
  required: "bg-red-50 text-red-800", conditional: "bg-amber-100 text-amber-900",
  optional: "bg-slate-100 text-slate-700", required_later: "bg-blue-50 text-blue-800",
};
const COMMON_VIEW_TYPE = "purchase_order_finance"; // buys nothing from the common list, so it shows it unchanged

function ListBody({ list, isOwner }: { list: DocListOverview; isOwner: boolean }) {
  const [entity, setEntity] = useState<string>("");
  const isCommon = list.kind === "common";
  const detail = useDocListDetail(isCommon ? COMMON_VIEW_TYPE : list.code, isCommon ? null : entity || null);
  const edit = useEditDocItem();
  const items = (detail.data?.items ?? []).filter((i) => !isCommon || i.source === "COMMON");

  const onLevel = async (listCode: string, doc: string, level: DocLevel) => {
    try { await edit.mutateAsync({ list: listCode, doc, level }); toast.success("Saved as a new version of this list."); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not save."); }
  };

  return (
    <div className="mt-3 space-y-3">
      {!isCommon ? (
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-brand-navy">Show the list for a client that is a</span>
          <select className={`${selectClass} max-w-xs`} value={entity} onChange={(e) => setEntity(e.target.value)}>
            <option value="">Standard list (no entity type)</option>
            {ENTITY_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
      ) : null}
      {detail.isError ? <p role="alert" className="text-sm text-red-700">{errorText(detail.error)}</p> : null}
      {(detail.data?.entity_notes ?? []).map((n) => <p key={n} className="text-sm text-muted-foreground">{n}</p>)}
      <ul className="divide-y divide-border text-sm">
        {items.map((i) => {
          const editable = isOwner && !i.source.startsWith("ENTITY:") && (isCommon ? i.source === "COMMON" : i.source === list.code);
          return (
            <li key={i.doc_code} className="flex items-start justify-between gap-3 py-2">
              <span>
                <span className="mr-2 font-mono text-xs text-muted-foreground">{i.doc_code}</span>{i.title}
                {i.note ? <span className="block text-xs text-muted-foreground">{i.note}</span> : null}
                {i.source !== list.code && !isCommon ? (
                  <span className="block text-xs text-muted-foreground">{i.source === "COMMON" ? "From the common list" : i.source.startsWith("ENTITY:") ? "Added for this entity type" : `From ${i.source.replace(/_/g, " ")}`}</span>
                ) : null}
              </span>
              {editable ? (
                <select className={`${selectClass} w-40 shrink-0`} aria-label={`${i.title} requirement`} value={i.level} disabled={edit.isPending}
                  onChange={(e) => void onLevel(i.source, i.doc_code, e.target.value as DocLevel)}>
                  {(Object.keys(LEVEL_LABEL) as DocLevel[]).map((l) => <option key={l} value={l}>{LEVEL_LABEL[l]}</option>)}
                </select>
              ) : (
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${LEVEL_CLASS[i.level]}`}>{LEVEL_LABEL[i.level]}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// Founder-only editing and confirmation; the Operations Manager can view. Lists come from the FNC Required
// Documents Spec (10 Oct 2026) and are NOT enforced until each is confirmed here.
export default function DocumentRulesPage() {
  const lists = useDocListsOverview();
  const confirm = useConfirmDocList();
  const [open, setOpen] = useState<string | null>(null);
  const isOwner = true; // the route is owner-only; the database enforces it again on every write

  const onConfirm = async (l: DocListOverview) => {
    if (!window.confirm(`Confirm "${l.label}"? Until confirmed, files of this type cannot reach Complete.`)) return;
    try { await confirm.mutateAsync(l.code); toast.success("List confirmed."); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not confirm."); }
  };

  const groups = new Map<string, DocListOverview[]>();
  for (const l of lists.data ?? []) groups.set(l.group, [...(groups.get(l.group) ?? []), l]);
  const total = (lists.data ?? []).length;
  const done = (lists.data ?? []).filter((l) => l.confirmed).length;

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4">
      <div>
        <h1 className="text-2xl font-bold text-brand-navy">Required documents</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          One list per funding type, plus the common list that applies to all of them. A file cannot reach Complete until its
          list is confirmed and every required document is received. Every change makes a new version; files keep the version they opened with.
        </p>
        <p className="mt-1 text-sm font-semibold text-brand-navy">{done} of {total} lists confirmed</p>
      </div>
      {lists.isError ? <p role="alert" className="text-sm text-red-700">{errorText(lists.error)}</p> : null}
      {[...groups.entries()].map(([group, rows]) => (
        <section key={group} className="space-y-2">
          <h2 className="text-base font-bold text-brand-navy">{group}</h2>
          {rows.map((l) => (
            <div key={l.code} className={card}>
              <div className="flex items-center justify-between gap-3">
                <button type="button" className="text-left" aria-expanded={open === l.code} onClick={() => setOpen(open === l.code ? null : l.code)}>
                  <span className="font-semibold text-brand-navy">{l.label}</span>
                  <span className="block text-xs text-muted-foreground">
                    {l.items} documents{l.includes ? `, plus everything in ${l.includes.replace(/_/g, " ")}` : ""} · version {l.version}
                  </span>
                </button>
                <div className="flex shrink-0 items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${l.confirmed ? "bg-green-100 text-green-900" : "bg-amber-100 text-amber-900"}`}>
                    {l.confirmed ? "Confirmed" : "Not confirmed"}
                  </span>
                  {!l.confirmed ? (
                    <button type="button" disabled={confirm.isPending} onClick={() => void onConfirm(l)}
                      className="rounded-lg bg-brand-teal px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60">Confirm</button>
                  ) : null}
                </div>
              </div>
              {open === l.code ? <ListBody list={l} isOwner={isOwner} /> : null}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
