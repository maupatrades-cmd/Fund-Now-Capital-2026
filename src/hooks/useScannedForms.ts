import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

// Scanned paper forms (20261117120000). All reads and writes go through SECURITY DEFINER RPCs; files live in the
// private scanned-forms bucket and are only opened through scanned_form_open_file (visibility check + activity log
// + short ticket), then a 60-second signed URL. Never a public link.
const BUCKET = "scanned-forms";
export const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
export const ACCEPTED_MIME = ["application/pdf", "image/jpeg", "image/png"] as const;

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data as T;
}

export type FormCategory = "client_deal" | "ceo" | "agent" | "finance" | "hr" | "office" | "field";
export type LinkKind = "client" | "staff" | "agent" | "person" | "field_contractor" | "none";
export type PeriodKind = "date" | "day" | "week" | "month";

export const CATEGORY_LABEL: Record<FormCategory, string> = {
  client_deal: "Client / deal",
  ceo: "CEO only",
  agent: "Agents / Team Leaders",
  finance: "Finance / admin",
  hr: "HR / staff",
  office: "Office registers",
  field: "Field team",
};

export type CatalogueForm = {
  code: string; title: string; category: FormCategory; link_kind: LinkKind; link_required: boolean;
  period_kind: PeriodKind; can_upload: boolean;
};

export type ScannedPage = { id: string; page_no: number; file_name: string; mime_type: string; size_bytes: number };

export type ScannedForm = {
  id: string; form_code: string; title: string; category: FormCategory; link_kind: LinkKind;
  client_id: string | null; client_name: string | null; deal_id: string | null; deal_reference: string | null;
  subject_profile_id: string | null; subject_name: string | null; period_kind: PeriodKind;
  period_start: string; period_end: string; signed_by: string; note: string | null; current_version: number;
  created_by: string; created_by_name: string | null; created_role: string; created_at: string; pages: ScannedPage[];
};

export type FormVersionPage = {
  version: number; page_no: number; file_id: string; file_name: string; mime_type: string; size_bytes: number;
  uploaded_by_name: string | null; uploaded_role: string; uploaded_at: string;
};

export type ScannedFormFilters = {
  formCode?: string | null; category?: FormCategory | null; from?: string | null; to?: string | null;
  subjectProfileId?: string | null; clientId?: string | null; dealId?: string | null; uploadedBy?: string | null;
};

export function useFormCatalogue() {
  return useQuery({ queryKey: ["scanned-form-catalogue"], queryFn: () => rpc<CatalogueForm[]>("scanned_form_catalogue_list") });
}

export function useScannedForms(f: ScannedFormFilters, enabled = true) {
  return useQuery({
    queryKey: ["scanned-forms", f],
    enabled,
    queryFn: () => rpc<ScannedForm[]>("scanned_forms_list", {
      p_form_code: f.formCode ?? null, p_category: f.category ?? null, p_from: f.from ?? null, p_to: f.to ?? null,
      p_subject_profile_id: f.subjectProfileId ?? null, p_client_id: f.clientId ?? null, p_deal_id: f.dealId ?? null,
      p_uploaded_by: f.uploadedBy ?? null, p_limit: 300,
    }),
  });
}

export function useFormVersions(formId: string | null) {
  return useQuery({
    queryKey: ["scanned-form-versions", formId],
    enabled: Boolean(formId),
    queryFn: () => rpc<FormVersionPage[]>("scanned_form_versions", { p_form_id: formId }),
  });
}

export function useLinkOptions(linkKind: LinkKind | null, search: string) {
  return useQuery({
    queryKey: ["scanned-form-link-options", linkKind, search],
    enabled: Boolean(linkKind) && linkKind !== "none",
    queryFn: () => rpc<{ id: string; label: string; detail: string }[]>("scanned_form_link_options", { p_link_kind: linkKind, p_search: search || null }),
  });
}

export function useClientDealsForForms(clientId: string | null) {
  return useQuery({
    queryKey: ["scanned-form-client-deals", clientId],
    enabled: Boolean(clientId),
    queryFn: () => rpc<{ id: string; reference: string | null; stage: string }[]>("scanned_form_client_deals", { p_client_id: clientId }),
  });
}

export function useMissingRegisters(enabled: boolean) {
  return useQuery({
    queryKey: ["scanned-form-missing"],
    enabled,
    queryFn: () => rpc<{ form_code: string; title: string; period_start: string; period_end: string }[]>("scanned_form_missing_registers"),
  });
}

function extensionFor(mime: string): string {
  return mime === "application/pdf" ? "pdf" : mime === "image/png" ? "png" : "jpg";
}

// Upload each page to <form_code>/<yyyy>/<mm>/<uuid>-<n>.<ext>. On any failure the pages already sent are removed,
// so nothing half-uploaded stays in the bucket.
async function uploadPages(formCode: string, files: File[]) {
  if (files.length === 0) throw new Error("Attach the scanned pages");
  const total = files.reduce((n, f) => n + f.size, 0);
  if (total > MAX_TOTAL_BYTES) throw new Error("The pages together are larger than 20 MB");
  for (const f of files) {
    if (!(ACCEPTED_MIME as readonly string[]).includes(f.type)) throw new Error(`${f.name}: only PDF, JPG and PNG files can be uploaded`);
  }
  const now = new Date();
  const folder = `${formCode}/${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}`;
  const uploaded: { path: string; file_name: string; mime_type: string; size_bytes: number }[] = [];
  try {
    for (const [i, f] of files.entries()) {
      const path = `${folder}/${crypto.randomUUID()}-${i + 1}.${extensionFor(f.type)}`;
      const { error } = await supabase.storage.from(BUCKET).upload(path, f, { contentType: f.type, upsert: false });
      if (error) throw error;
      uploaded.push({ path, file_name: f.name.slice(0, 200), mime_type: f.type, size_bytes: f.size });
    }
    return uploaded;
  } catch (e) {
    await removeUnregistered(uploaded.map((u) => u.path));
    throw e;
  }
}

async function removeUnregistered(paths: string[]) {
  if (paths.length === 0) return;
  const { error } = await supabase.storage.from(BUCKET).remove(paths);
  if (error) console.warn("Scanned-form cleanup failed:", error.message);
}

export type RegisterInput = {
  formCode: string; clientId: string | null; dealId: string | null; subjectProfileId: string | null;
  periodDate: string; signedBy: string; note: string; files: File[];
};

export function useRegisterScannedForm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (i: RegisterInput) => {
      const pages = await uploadPages(i.formCode, i.files);
      try {
        return await rpc<string>("scanned_form_register", {
          p_form_code: i.formCode, p_client_id: i.clientId, p_deal_id: i.dealId, p_subject_profile_id: i.subjectProfileId,
          p_period_date: i.periodDate, p_signed_by: i.signedBy, p_note: i.note || null, p_files: pages,
        });
      } catch (e) {
        await removeUnregistered(pages.map((p) => p.path));
        throw e;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["scanned-forms"] });
      qc.invalidateQueries({ queryKey: ["scanned-form-missing"] });
      qc.invalidateQueries({ queryKey: ["agent-file"] });
    },
  });
}

export function useReplaceScannedForm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (i: { formId: string; formCode: string; files: File[]; reason: string }) => {
      const pages = await uploadPages(i.formCode, i.files);
      try {
        return await rpc<number>("scanned_form_replace", { p_form_id: i.formId, p_files: pages, p_reason: i.reason });
      } catch (e) {
        await removeUnregistered(pages.map((p) => p.path));
        throw e;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["scanned-forms"] });
      qc.invalidateQueries({ queryKey: ["scanned-form-versions"] });
      qc.invalidateQueries({ queryKey: ["agent-file"] });
    },
  });
}

export function useDeleteScannedForm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (i: { formId: string; reason: string }) => {
      const paths = await rpc<string[]>("owner_delete_scanned_form", { p_form_id: i.formId, p_reason: i.reason });
      const { error } = await supabase.storage.from(BUCKET).remove(paths);
      if (error) throw new Error(`The form is deleted, but its files could not all be removed: ${error.message}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["scanned-forms"] }),
  });
}

// View (opens in a new tab) or download one page. The RPC logs it first; the signed URL lasts 60 seconds.
export async function openScannedPage(fileId: string, purpose: "view" | "download", fileName?: string) {
  const path = await rpc<string>("scanned_form_open_file", { p_file_id: fileId, p_purpose: purpose });
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60, purpose === "download" ? { download: fileName ?? true } : undefined);
  if (error) throw error;
  if (purpose === "view") window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  else window.location.assign(data.signedUrl);
}

// A payee proof captured through scanned forms is stored as "scanned-form:<form id>" (FNC-AG-BANK). Returns a signed
// URL to its first page for the bank-details viewers, or null when the reference is an ordinary payee-proofs path.
export const SCANNED_PROOF_PREFIX = "scanned-form:";
export async function scannedProofUrl(reference: string): Promise<string | null> {
  if (!reference.startsWith(SCANNED_PROOF_PREFIX)) return null;
  const formId = reference.slice(SCANNED_PROOF_PREFIX.length);
  const pages = await rpc<FormVersionPage[]>("scanned_form_versions", { p_form_id: formId });
  const first = pages.find((p) => p.page_no === 1);
  if (!first) throw new Error("The scanned bank letter has no pages");
  const path = await rpc<string>("scanned_form_open_file", { p_file_id: first.file_id, p_purpose: "view" });
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60);
  if (error) throw error;
  return data.signedUrl;
}

export function periodLabel(f: Pick<ScannedForm, "period_kind" | "period_start" | "period_end">): string {
  const d = (s: string) => new Date(`${s}T00:00:00`).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });
  if (f.period_kind === "month") return new Date(`${f.period_start}T00:00:00`).toLocaleDateString("en-ZA", { month: "long", year: "numeric" });
  if (f.period_kind === "week") return `Week of ${d(f.period_start)}`;
  return d(f.period_start);
}
