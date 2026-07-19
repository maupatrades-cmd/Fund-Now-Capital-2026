import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  useClientStory,
  useSaveClientStory,
  useStoryNotes,
  useAddStoryNote,
  STORY_FIELDS,
  type StoryFieldKey,
} from "@/hooks/useClientStory";

const ctl =
  "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-brand-navy outline-none focus:border-brand-teal focus:ring-2 focus:ring-brand-teal/20";

type Draft = Partial<Record<StoryFieldKey, string>>;

export function StoryPanel({ clientId }: { clientId: string }) {
  const { data: story, isLoading } = useClientStory(clientId);
  const save = useSaveClientStory();
  const [draft, setDraft] = useState<Draft>({});

  // Seed the form once per story identity (id + updated_at), NOT on every
  // background refetch — otherwise a refetch-on-window-focus/reconnect while the
  // owner is mid-edit would silently overwrite unsaved narrative. The key also
  // changes after a save (updated_at bumps), so the freshly-saved values re-seed.
  const seededRef = useRef<string | null>(null);
  useEffect(() => {
    if (!story) return;
    const key = `${story.id}:${story.updated_at}`;
    if (seededRef.current === key) return;
    seededRef.current = key;
    const seeded: Draft = {};
    for (const f of STORY_FIELDS) seeded[f.key] = (story[f.key] as string | null) ?? "";
    setDraft(seeded);
  }, [story]);

  const onSave = async () => {
    // Persist all narrative fields together; empty strings become null.
    const fields: Partial<Record<StoryFieldKey, string | null>> = {};
    for (const f of STORY_FIELDS) fields[f.key] = (draft[f.key] ?? "").trim() || null;
    try {
      await save.mutateAsync({ clientId, fields });
      toast.success("Story saved");
    } catch (e) {
      toast.error((e as Error).message || "Could not save story");
    }
  };

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading story…</p>;

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <p className="text-xs text-muted-foreground">
          The client's narrative — who they are, what drives them, how to work with them. Markdown is
          fine. Saving the first field creates the story record.
        </p>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {STORY_FIELDS.map((f) => (
            <label
              key={f.key}
              className={`flex flex-col gap-1 text-xs font-medium text-muted-foreground ${
                f.long ? "lg:col-span-2" : ""
              }`}
            >
              {f.label}
              <textarea
                className={ctl}
                rows={f.long ? 4 : 2}
                value={draft[f.key] ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
              />
            </label>
          ))}
        </div>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onSave}
            disabled={save.isPending}
            className="rounded-lg bg-brand-teal px-4 py-2 text-sm font-semibold text-white hover:bg-brand-teal/90 disabled:opacity-60"
          >
            {save.isPending ? "Saving…" : "Save story"}
          </button>
        </div>
      </div>

      <div className="border-t border-border pt-5">
        <h4 className="mb-1 text-sm font-semibold text-brand-navy">Ongoing impressions</h4>
        <p className="mb-3 text-xs text-muted-foreground">
          Append-only — impressions are never edited or deleted, so the record stays honest over time.
        </p>
        {story ? (
          <Impressions storyId={story.id} />
        ) : (
          <p className="text-sm text-muted-foreground">Save the story first to start logging impressions.</p>
        )}
      </div>
    </div>
  );
}

function Impressions({ storyId }: { storyId: string }) {
  const { data: notes, isLoading } = useStoryNotes(storyId);
  const add = useAddStoryNote();
  const [text, setText] = useState("");

  const onAdd = async () => {
    const t = text.trim();
    if (!t) return;
    try {
      await add.mutateAsync({ storyId, text: t });
      setText("");
    } catch (e) {
      toast.error((e as Error).message || "Could not add impression");
    }
  };

  const rows = useMemo(() => notes ?? [], [notes]);

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2">
        <textarea
          className={ctl}
          rows={2}
          placeholder="Add an impression…"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button
          type="button"
          onClick={onAdd}
          disabled={add.isPending || !text.trim()}
          className="shrink-0 rounded-lg bg-brand-teal px-4 py-2 text-sm font-semibold text-white hover:bg-brand-teal/90 disabled:opacity-60"
        >
          Add
        </button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading impressions…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No impressions logged yet.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((n) => (
            <li key={n.id} className="rounded-lg border border-border bg-slate-50 p-3">
              <p className="whitespace-pre-wrap text-sm text-brand-navy">{n.text}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {new Date(n.created_at).toLocaleString("en-ZA")}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
