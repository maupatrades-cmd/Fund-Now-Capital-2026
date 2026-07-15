import { useMemo, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import {
  useIndustries,
  useFundersMinimal,
  useFunderAppetite,
  useAddIndustry,
  useAddSubIndustry,
  useToggleIndustryActive,
  useToggleSubIndustryActive,
  useUpsertAppetite,
  useClearAppetite,
  appetiteCellKey,
  APPETITE_META,
  APPETITE_LEVELS,
  type AppetiteLevel,
  type IndustryWithSubs,
} from "@/hooks/useIndustries";

type Tab = "industries" | "appetite";

const inputCls =
  "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-brand-navy outline-none focus:border-brand-teal focus:ring-2 focus:ring-brand-teal/20";

export default function IndustriesPage() {
  const [tab, setTab] = useState<Tab>("industries");

  return (
    <div className="max-w-6xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-brand-navy">Industry classification</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The taxonomy every deal and funder-fit decision reads from. Manage industries and
          sub-industries, and set each funder's appetite per industry.
        </p>
      </div>

      <div className="flex gap-1 border-b border-border">
        <TabButton active={tab === "industries"} onClick={() => setTab("industries")}>
          Industries
        </TabButton>
        <TabButton active={tab === "appetite"} onClick={() => setTab("appetite")}>
          Funder appetite
        </TabButton>
      </div>

      {tab === "industries" ? <IndustriesTab /> : <AppetiteTab />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 1 — Industries tree
// ---------------------------------------------------------------------------
function IndustriesTab() {
  const { data: industries, isLoading } = useIndustries();
  const addIndustry = useAddIndustry();
  const [newName, setNewName] = useState("");

  const nextSortOrder = useMemo(
    () => (industries?.length ? Math.max(...industries.map((i) => i.sort_order)) + 1 : 1),
    [industries],
  );

  const onAdd = () => {
    const name = newName.trim();
    if (!name) return;
    addIndustry.mutate(
      { name, sortOrder: nextSortOrder },
      {
        onSuccess: () => {
          setNewName("");
          toast.success("Industry added");
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : "Could not add industry"),
      },
    );
  };

  if (isLoading) return <LoadingCard label="Loading industries…" />;

  return (
    <div className="space-y-4">
      <div className="flex items-end gap-2 rounded-xl border border-border bg-white p-4 shadow-sm">
        <div className="flex-1">
          <label className="block text-sm font-medium text-brand-navy mb-1.5" htmlFor="new-industry">
            Add industry
          </label>
          <input
            id="new-industry"
            className={inputCls}
            placeholder="e.g. Renewable Energy"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onAdd()}
          />
        </div>
        <button
          type="button"
          onClick={onAdd}
          disabled={addIndustry.isPending || !newName.trim()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-teal px-4 py-2 text-sm font-semibold text-white hover:bg-brand-teal/90 disabled:opacity-60"
        >
          <Plus className="h-4 w-4" /> Add
        </button>
      </div>

      <div className="space-y-3">
        {(industries ?? []).map((industry) => (
          <IndustryCard key={industry.id} industry={industry} />
        ))}
      </div>
    </div>
  );
}

function IndustryCard({ industry }: { industry: IndustryWithSubs }) {
  const toggleIndustry = useToggleIndustryActive();
  const toggleSub = useToggleSubIndustryActive();
  const addSub = useAddSubIndustry();
  const [newSub, setNewSub] = useState("");

  const nextSubOrder = industry.sub_industries.length
    ? Math.max(...industry.sub_industries.map((s) => s.sort_order)) + 1
    : 1;

  const onAddSub = () => {
    const name = newSub.trim();
    if (!name) return;
    addSub.mutate(
      { industryId: industry.id, name, sortOrder: nextSubOrder },
      {
        onSuccess: () => {
          setNewSub("");
          toast.success("Sub-industry added");
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : "Could not add sub-industry"),
      },
    );
  };

  return (
    <div className="rounded-xl border border-border bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">{industry.sort_order}.</span>
          <span className={"font-semibold " + (industry.active ? "text-brand-navy" : "text-muted-foreground line-through")}>
            {industry.name}
          </span>
        </div>
        <ActiveToggle
          checked={industry.active}
          onChange={(active) =>
            toggleIndustry.mutate(
              { id: industry.id, active },
              { onError: (e) => toast.error(e instanceof Error ? e.message : "Could not update") },
            )
          }
          label={`${industry.name} active`}
        />
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5 pl-6">
        {industry.sub_industries.map((sub) => (
          <button
            key={sub.id}
            type="button"
            title={sub.active ? "Active — click to deactivate" : "Inactive — click to activate"}
            onClick={() =>
              toggleSub.mutate(
                { id: sub.id, active: !sub.active },
                { onError: (e) => toast.error(e instanceof Error ? e.message : "Could not update") },
              )
            }
            className={
              "rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset transition-colors " +
              (sub.active
                ? "bg-brand-teal/10 text-brand-navy ring-brand-teal/30 hover:bg-brand-teal/20"
                : "bg-slate-50 text-muted-foreground line-through ring-border hover:bg-slate-100")
            }
          >
            {sub.name}
          </button>
        ))}
        {industry.sub_industries.length === 0 && (
          <span className="text-xs text-muted-foreground">No sub-industries yet.</span>
        )}
      </div>

      <div className="mt-3 flex items-center gap-2 pl-6">
        <input
          className={inputCls + " max-w-xs"}
          placeholder="Add sub-industry…"
          value={newSub}
          onChange={(e) => setNewSub(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onAddSub()}
          aria-label={`Add sub-industry to ${industry.name}`}
        />
        <button
          type="button"
          onClick={onAddSub}
          disabled={addSub.isPending || !newSub.trim()}
          className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-sm font-medium text-brand-navy hover:bg-slate-50 disabled:opacity-60"
        >
          <Plus className="h-3.5 w-3.5" /> Add
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 2 — Funder appetite matrix
// ---------------------------------------------------------------------------
type EditingCell = {
  funderId: string;
  funderName: string;
  industryId: string;
  industryName: string;
};

function AppetiteTab() {
  const { data: industries, isLoading: li } = useIndustries();
  const { data: funders, isLoading: lf } = useFundersMinimal();
  const { data: appetite, isLoading: la } = useFunderAppetite();
  const [editing, setEditing] = useState<EditingCell | null>(null);

  if (li || lf || la) return <LoadingCard label="Loading appetite matrix…" />;

  const activeIndustries = (industries ?? []).filter((i) => i.active);

  if (!funders?.length) {
    return (
      <div className="rounded-xl border border-border bg-white p-6 text-sm text-muted-foreground shadow-sm">
        No funders on the panel yet.
      </div>
    );
  }

  return (
    <>
      <p className="text-xs text-muted-foreground">
        Click any cell to set that funder's appetite for the industry. Colour key:{" "}
        {APPETITE_LEVELS.map((lvl) => (
          <Badge key={lvl} className={APPETITE_META[lvl].className + " ml-1"}>
            {APPETITE_META[lvl].label}
          </Badge>
        ))}
      </p>

      <div className="overflow-x-auto rounded-xl border border-border bg-white shadow-sm">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="sticky left-0 z-10 bg-white px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Funder
              </th>
              {activeIndustries.map((i) => (
                <th
                  key={i.id}
                  className="px-3 py-3 text-left text-xs font-semibold text-brand-navy"
                  style={{ minWidth: 120 }}
                >
                  {i.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {funders.map((f) => (
              <tr key={f.id} className="border-b border-border last:border-0">
                <th className="sticky left-0 z-10 bg-white px-4 py-2.5 text-left font-medium text-brand-navy">
                  {f.name}
                </th>
                {activeIndustries.map((i) => {
                  const cell = appetite?.[appetiteCellKey(f.id, i.id)];
                  return (
                    <td key={i.id} className="px-3 py-2.5">
                      <button
                        type="button"
                        onClick={() =>
                          setEditing({
                            funderId: f.id,
                            funderName: f.name,
                            industryId: i.id,
                            industryName: i.name,
                          })
                        }
                        title={cell?.notes ?? "Set appetite"}
                        className="min-w-[64px]"
                      >
                        {cell ? (
                          <Badge className={APPETITE_META[cell.appetite_level].className}>
                            {APPETITE_META[cell.appetite_level].label}
                          </Badge>
                        ) : (
                          <span className="rounded-full px-2.5 py-0.5 text-xs text-muted-foreground ring-1 ring-inset ring-border hover:bg-slate-50">
                            +
                          </span>
                        )}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <AppetiteEditor
          cell={editing}
          current={appetite?.[appetiteCellKey(editing.funderId, editing.industryId)] ?? null}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function AppetiteEditor({
  cell,
  current,
  onClose,
}: {
  cell: EditingCell;
  current: { id: string; appetite_level: AppetiteLevel; notes: string | null } | null;
  onClose: () => void;
}) {
  const upsert = useUpsertAppetite();
  const clear = useClearAppetite();
  const [level, setLevel] = useState<AppetiteLevel>(current?.appetite_level ?? "high");
  const [notes, setNotes] = useState(current?.notes ?? "");

  const onSave = () => {
    upsert.mutate(
      { funderId: cell.funderId, industryId: cell.industryId, level, notes: notes.trim() || null },
      {
        onSuccess: () => {
          toast.success("Appetite saved");
          onClose();
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save appetite"),
      },
    );
  };

  const onClear = () => {
    if (!current) return onClose();
    // Optimistic delete: the hook hides the cell immediately and rolls back +
    // toasts on failure, so we only handle the success path here.
    clear.mutate(
      { id: current.id, funderId: cell.funderId, industryId: cell.industryId },
      {
        onSuccess: () => {
          toast.success("Appetite cleared");
          onClose();
        },
      },
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-md space-y-4 rounded-xl border border-border bg-white p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Edit funder appetite"
      >
        <div>
          <h3 className="text-lg font-semibold text-brand-navy">{cell.funderName}</h3>
          <p className="text-sm text-muted-foreground">{cell.industryName}</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-brand-navy mb-1.5" htmlFor="appetite-level">
            Appetite level
          </label>
          <select
            id="appetite-level"
            className={inputCls}
            value={level}
            onChange={(e) => setLevel(e.target.value as AppetiteLevel)}
          >
            {APPETITE_LEVELS.map((lvl) => (
              <option key={lvl} value={lvl}>
                {APPETITE_META[lvl].label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-brand-navy mb-1.5" htmlFor="appetite-notes">
            Notes <span className="font-normal text-muted-foreground">(owner-only)</span>
          </label>
          <textarea
            id="appetite-notes"
            rows={3}
            className={inputCls}
            placeholder="Optional context — never shown to partners."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        <div className="flex items-center justify-between gap-3 pt-1">
          <button
            type="button"
            onClick={onClear}
            disabled={!current || clear.isPending}
            className="text-sm font-medium text-red-600 hover:underline disabled:opacity-40"
          >
            {current ? "Clear" : ""}
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-brand-navy hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={upsert.isPending}
              className="rounded-lg bg-brand-teal px-4 py-2 text-sm font-semibold text-white hover:bg-brand-teal/90 disabled:opacity-60"
            >
              {upsert.isPending ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------
function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "px-4 py-2.5 text-sm font-medium -mb-px border-b-2 transition-colors " +
        (active
          ? "border-brand-teal text-brand-navy"
          : "border-transparent text-muted-foreground hover:text-brand-navy")
      }
    >
      {children}
    </button>
  );
}

function ActiveToggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
      <input
        type="checkbox"
        className="h-4 w-4 rounded border-border align-middle"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={label}
      />
      Active
    </label>
  );
}

function LoadingCard({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center gap-2 rounded-xl border border-border bg-white py-16 text-sm text-muted-foreground shadow-sm">
      <Loader2 className="h-4 w-4 animate-spin" /> {label}
    </div>
  );
}
