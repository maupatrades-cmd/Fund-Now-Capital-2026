import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { invalidateActivity } from "@/hooks/useActivity";

// A story's owning entity — a lead (pre-qualification, B4.1) or a client. Drives
// the owning FK column (client_id XOR lead_id) and the query key, mirroring the
// documents DocEntity / stakeholders StakeEntity pattern.
export type StoryEntity = { kind: "client" | "lead"; id: string };

function entityColumn(kind: StoryEntity["kind"]): "client_id" | "lead_id" {
  return kind === "lead" ? "lead_id" : "client_id";
}

function storyKey(entity: StoryEntity | undefined) {
  return ["client-story", entity?.kind, entity?.id] as const;
}

// The 1:1 narrative record (B4 / SPEC S3; B4.1 makes it lead-or-client owned via
// the XOR columns). Editable markdown-text fields; the never-overwritten
// "ongoing impressions" live in client_story_notes.
export type ClientStory = {
  id: string;
  client_id: string | null;
  lead_id: string | null;
  business_story: string | null;
  founder_background: string | null;
  business_origin: string | null;
  competitive_edge: string | null;
  aspirations: string | null;
  contact_story: string | null;
  family_context: string | null;
  personal_interests: string | null;
  language_preference: string | null;
  communication_style: string | null;
  assets_narrative: string | null;
  initial_assessment: string | null;
  concerns_flagged: string | null;
  opportunities_seen: string | null;
  created_at: string;
  updated_at: string;
};

// The editable narrative fields, in display order (label + whether it's a long
// textarea). Drives the Story form so the columns stay in lockstep with the DB.
export const STORY_FIELDS: { key: StoryFieldKey; label: string; long?: boolean }[] = [
  { key: "business_story", label: "Business story", long: true },
  { key: "founder_background", label: "Founder background", long: true },
  { key: "business_origin", label: "Business origin" },
  { key: "competitive_edge", label: "Competitive edge" },
  { key: "aspirations", label: "Aspirations" },
  { key: "contact_story", label: "Contact story", long: true },
  { key: "family_context", label: "Family context" },
  { key: "personal_interests", label: "Personal interests" },
  { key: "language_preference", label: "Language preference" },
  { key: "communication_style", label: "Communication style" },
  { key: "assets_narrative", label: "Assets narrative", long: true },
  { key: "initial_assessment", label: "Initial assessment", long: true },
  { key: "concerns_flagged", label: "Concerns flagged" },
  { key: "opportunities_seen", label: "Opportunities seen" },
];

// Only the narrative text columns are field keys (never id/owner/audit columns).
export type StoryFieldKey =
  | "business_story"
  | "founder_background"
  | "business_origin"
  | "competitive_edge"
  | "aspirations"
  | "contact_story"
  | "family_context"
  | "personal_interests"
  | "language_preference"
  | "communication_style"
  | "assets_narrative"
  | "initial_assessment"
  | "concerns_flagged"
  | "opportunities_seen";

const STORY_COLUMNS =
  "id, client_id, lead_id, business_story, founder_background, business_origin, competitive_edge, " +
  "aspirations, contact_story, family_context, personal_interests, language_preference, " +
  "communication_style, assets_narrative, initial_assessment, concerns_flagged, " +
  "opportunities_seen, created_at, updated_at";

export function useClientStory(entity: StoryEntity | undefined) {
  return useQuery({
    queryKey: storyKey(entity),
    enabled: !!entity?.id,
    queryFn: async (): Promise<ClientStory | null> => {
      const { data, error } = await supabase
        .from("client_stories")
        .select(STORY_COLUMNS)
        .eq(entityColumn(entity!.kind), entity!.id)
        .maybeSingle();
      if (error) throw error;
      return (data as unknown as ClientStory | null) ?? null;
    },
  });
}

// Create-on-first-save (decision 4): upsert on the entity's unique owning column
// (client_id or lead_id — both are unique, NULLs-distinct), so the first save
// creates the row and later saves update it. RETURNING id + row-count check
// surfaces a silent RLS failure loudly (CLAUDE.md standing rule).
export function useSaveClientStory(entity: StoryEntity) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ fields }: { fields: Partial<Record<StoryFieldKey, string | null>> }) => {
      const col = entityColumn(entity.kind);
      const { data, error } = await supabase
        .from("client_stories")
        .upsert({ [col]: entity.id, ...fields }, { onConflict: col })
        .select("id");
      if (error) throw error;
      if (!data || data.length !== 1) throw new Error("Story was not saved (no row written).");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: storyKey(entity) });
      invalidateActivity(qc);
    },
  });
}

// ---- Ongoing impressions (append-only) --------------------------------------
export type StoryNote = {
  id: string;
  story_id: string;
  text: string;
  author_id: string | null;
  created_at: string;
};

export function useStoryNotes(storyId: string | undefined) {
  return useQuery({
    queryKey: ["story-notes", storyId],
    enabled: !!storyId,
    queryFn: async (): Promise<StoryNote[]> => {
      const { data, error } = await supabase
        .from("client_story_notes")
        .select("id, story_id, text, author_id, created_at")
        .eq("story_id", storyId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as StoryNote[];
    },
  });
}

// Append-only: insert only (the table has no UPDATE/DELETE RLS path). author_id
// defaults to auth.uid() server-side.
export function useAddStoryNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ storyId, text }: { storyId: string; text: string }) => {
      const { data, error } = await supabase
        .from("client_story_notes")
        .insert({ story_id: storyId, text })
        .select("id");
      if (error) throw error;
      if (!data || data.length !== 1) throw new Error("Impression was not saved (no row written).");
    },
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: ["story-notes", vars.storyId] }),
  });
}

// ---- Markdown export (B4.1) -------------------------------------------------
// Curated narrative sections (owner decision) — grouped for readability rather
// than a raw column dump, and the substrate for the future E6 Claude Story
// Refiner + E3 FNC application package. Every narrative column is covered by
// exactly one section; empty sections are omitted at build time.
const STORY_EXPORT_SECTIONS: { heading: string; keys: StoryFieldKey[] }[] = [
  { heading: "Business overview", keys: ["business_story", "business_origin"] },
  { heading: "Founder background", keys: ["founder_background"] },
  { heading: "Competitive edge", keys: ["competitive_edge"] },
  { heading: "Funding purpose & opportunity", keys: ["opportunities_seen", "aspirations"] },
  { heading: "Assets", keys: ["assets_narrative"] },
  {
    heading: "Relationship & personal context",
    keys: ["contact_story", "family_context", "personal_interests", "language_preference", "communication_style"],
  },
  { heading: "Owner assessment", keys: ["initial_assessment", "concerns_flagged"] },
];

export function buildStoryMarkdown(opts: {
  title: string;
  story: ClientStory | null;
  notes: StoryNote[];
}): string {
  const lines: string[] = [`# Client Story — ${opts.title}`, ""];

  for (const sec of STORY_EXPORT_SECTIONS) {
    const parts = sec.keys
      .map((k) => (opts.story?.[k] ?? "").trim())
      .filter((v) => v.length > 0);
    if (parts.length === 0) continue;
    lines.push(`## ${sec.heading}`, "", parts.join("\n\n"), "");
  }

  if (opts.notes.length > 0) {
    lines.push("## Ongoing impressions", "");
    // notes arrive newest-first; a narrative reads better oldest→newest.
    for (const n of [...opts.notes].reverse()) {
      const when = new Date(n.created_at).toLocaleDateString("en-ZA");
      lines.push(`- **${when}** — ${n.text.trim()}`);
    }
    lines.push("");
  }

  return lines.join("\n").trim() + "\n";
}
