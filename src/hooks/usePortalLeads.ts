import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/lib/useSession";
import type { PortalKind } from "@/components/portal/PortalShell";

// Documents submitted through the portal are attached to the lead with an honest
// provenance (upload_source = 'partner' | 'contractor') and left as type 'other'
// — the owner re-classifies during qualification. 'other' is not period-scoped,
// so it never trips the period_start/end CHECK.
const BUCKET = "documents";
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10MB per file

// ---- Submission ------------------------------------------------------------

export type SubmitLeadInput = {
  business_name: string;
  contact_name: string;
  contact_cell: string | null;
  contact_email: string | null;
  cipc_number: string | null;
  industry_id: string | null;
  funding_amount: number | null;
  funding_purpose: string | null;
  files: File[];
};

const RPC_FOR: Record<PortalKind, "partner_submit_lead" | "contractor_submit_lead"> = {
  partner: "partner_submit_lead",
  contractor: "contractor_submit_lead",
};

function safeName(name: string): string {
  return name.replace(/[^\w.-]+/g, "_");
}

// Attach one file to a freshly-created lead. Storage upload first, then the
// documents row (RETURNING id + row-count check per the standing rule so a
// silent RLS block surfaces loudly). On a failed insert we remove the orphaned
// object — the submitter DELETE storage policy (own uploads under own leads)
// makes this rollback effective, not a silent no-op — logging only a NON-PII
// trace (never the path/filename).
async function attachFile(leadId: string, file: File, source: PortalKind): Promise<void> {
  const documentId = crypto.randomUUID();
  const path = `leads/${leadId}/${documentId}/${safeName(file.name)}`;

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (upErr) throw upErr;

  const { data, error: insErr } = await supabase
    .from("documents")
    .insert({
      id: documentId,
      lead_id: leadId,
      filename: file.name,
      storage_path: path,
      document_type: "other",
      upload_source: source,
      file_size_bytes: file.size,
      mime_type: file.type || null,
    })
    .select("id");

  if (insErr || !data || data.length !== 1) {
    const { error: rmErr } = await supabase.storage.from(BUCKET).remove([path]);
    if (rmErr) {
      console.warn(
        `Lead document rollback failed (lead=${leadId} at=${new Date().toISOString()}):`,
        rmErr.message,
      );
    }
    throw insErr ?? new Error("Document upload was blocked (no row created).");
  }
}

export type SubmitLeadResult = { leadId: string; failedCount: number };

export function useSubmitLead(portal: PortalKind) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: SubmitLeadInput): Promise<SubmitLeadResult> => {
      // Lead creation is the ONLY step that can reject the mutation. If the RPC
      // fails, no lead was created — a retry is safe (and won't duplicate).
      const { data: leadId, error } = await supabase.rpc(RPC_FOR[portal], {
        p_business_name: input.business_name,
        p_contact_name: input.contact_name,
        p_contact_cell: input.contact_cell,
        p_contact_email: input.contact_email,
        p_cipc_number: input.cipc_number,
        p_industry_id: input.industry_id,
        p_funding_amount: input.funding_amount,
        p_funding_purpose: input.funding_purpose,
      });
      if (error) throw error;
      if (!leadId || typeof leadId !== "string") {
        throw new Error("Submission did not return a lead id.");
      }

      // Documents are uploaded AFTER the lead exists (RLS + storage policies key
      // off the lead's attribution). Once the lead is created the mutation is
      // considered a success — a doc failure must NOT reject it, or the user
      // would retry and create a duplicate lead + duplicate owner notification.
      // We collect failures and report them separately so the form can show a
      // partial-success warning. (Attaching docs to an existing lead is a
      // planned follow-up flow — see PR body.)
      let failedCount = 0;
      for (const file of input.files) {
        try {
          await attachFile(leadId, file, portal);
        } catch (e) {
          failedCount += 1;
          console.warn(
            `Lead document attach failed (lead=${leadId} at=${new Date().toISOString()}):`,
            (e as Error).message,
          );
        }
      }

      return { leadId, failedCount };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portal-leads", portal] });
    },
  });
}

export { MAX_FILE_BYTES };

// ---- List (own submissions) ------------------------------------------------

export type PortalLeadRow = {
  id: string;
  business_name: string;
  contact_name: string;
  funding_amount: string | null;
  qualification_stage: string;
  created_at: string;
};

// The submitter's own leads (RLS returns only rows where the caller is the
// attributed partner/contractor). Keyed by portal so the partner + contractor
// caches never cross.
export function usePortalLeads(portal: PortalKind) {
  // Key by the session user id so a same-tab sign-out/sign-in as a different
  // user of the same role can never reuse the previous user's cached leads
  // (the Macroscope cache-isolation fix — mirrors usePortalDeals / useProfileRole).
  // RLS is still the authoritative auth.uid() scope; this just keeps the client
  // cache per-user. The onSuccess invalidate above uses a prefix key, so it still
  // matches (and clears) this per-uid entry.
  const uid = useSession()?.user?.id ?? null;

  return useQuery({
    queryKey: ["portal-leads", portal, uid],
    queryFn: async (): Promise<PortalLeadRow[]> => {
      const { data, error } = await supabase
        .from("leads")
        .select("id, business_name, contact_name, funding_amount, qualification_stage, created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as PortalLeadRow[];
    },
  });
}

// Submitter-facing status derived from the owner's qualification_stage. The
// submitter sees a simple 4-state pipeline, not the owner's internal vocabulary.
export type PortalLeadStatus = "New" | "Under Review" | "Qualified" | "Declined";

export function leadStatus(stage: string): PortalLeadStatus {
  switch (stage) {
    case "qualified":
      return "Qualified";
    case "not_qualified":
      return "Declined";
    case "under_qualification":
      return "Under Review";
    default:
      return "New";
  }
}

export const STATUS_BADGE: Record<PortalLeadStatus, string> = {
  New: "bg-slate-100 text-slate-600 ring-slate-500/20",
  "Under Review": "bg-teal-50 text-teal-700 ring-teal-600/20",
  Qualified: "bg-green-50 text-green-700 ring-green-600/20",
  Declined: "bg-red-50 text-red-700 ring-red-600/20",
};
