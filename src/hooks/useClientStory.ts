import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { invalidateActivity } from "@/hooks/useActivity";

// The 1:1 client narrative record (B4 / SPEC S3). Editable markdown-text fields;
// the never-overwritten "ongoing impressions" live in client_story_notes.
export type ClientStory = {
  id: string;
  client_id: string;
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
export const STORY_FIELDS: { key: keyof ClientStory; label: string; long?: boolean }[] = [
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

export type StoryFieldKey = (typeof STORY_FIELDS)[number]["key"];

const STORY_COLUMNS =
  "id, client_id, business_story, founder_background, business_origin, competitive_edge, " +
  "aspirations, contact_story, family_context, personal_interests, language_preference, " +
  "communication_style, assets_narrative, initial_assessment, concerns_flagged, " +
  "opportunities_seen, created_at, updated_at";

export function useClientStory(clientId: string | undefined) {
  return useQuery({
    queryKey: ["client-story", clientId],
    enabled: !!clientId,
    queryFn: async (): Promise<ClientStory | null> => {
      const { data, error } = await supabase
        .from("client_stories")
        .select(STORY_COLUMNS)
        .eq("client_id", clientId!)
        .maybeSingle();
      if (error) throw error;
      return (data as unknown as ClientStory | null) ?? null;
    },
  });
}

// Create-on-first-save (decision 4): upsert on the unique client_id so the first
// save creates the row and later saves update it. RETURNING id + row-count check
// surfaces a silent RLS failure loudly (CLAUDE.md standing rule).
export function useSaveClientStory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      clientId,
      fields,
    }: {
      clientId: string;
      fields: Partial<Record<StoryFieldKey, string | null>>;
    }) => {
      const { data, error } = await supabase
        .from("client_stories")
        .upsert({ client_id: clientId, ...fields }, { onConflict: "client_id" })
        .select("id");
      if (error) throw error;
      if (!data || data.length !== 1) throw new Error("Story was not saved (no row written).");
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["client-story", vars.clientId] });
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
