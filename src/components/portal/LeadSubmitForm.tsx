import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Paperclip, UploadCloud, X } from "lucide-react";
import { useIndustries } from "@/hooks/useIndustries";
import {
  useSubmitLead,
  MAX_FILE_BYTES,
  type SubmitLeadInput,
} from "@/hooks/usePortalLeads";
import type { PortalKind } from "@/components/portal/PortalShell";
import { isValidCipc, isValidSaCell, normaliseSaCell } from "@/lib/sa-validation";
import { formatFileSize } from "@/lib/documents";

/*
 * Shared lead-submission form for both portals (partner + contractor). Same
 * fields, same UX; only the RPC differs (chosen by `portal` inside
 * useSubmitLead). Mirrors the owner lead form's shape (react-hook-form + zod,
 * SA validation helpers) but simplified to what an external submitter provides.
 */

const schema = z.object({
  business_name: z.string().trim().min(1, "Business name is required"),
  contact_name: z.string().trim().min(1, "Contact person is required"),
  contact_cell: z
    .string()
    .trim()
    .min(1, "Contact phone is required")
    .refine((v) => isValidSaCell(v), "Enter a valid SA cell (0.. or +27..)"),
  contact_email: z
    .string()
    .trim()
    .min(1, "Contact email is required")
    .refine((v) => z.email().safeParse(v).success, "Enter a valid email"),
  cipc_number: z
    .string()
    .optional()
    .default("")
    .refine((v) => !v || isValidCipc(v), "Format: YYYY/NNNNNN/NN"),
  industry_id: z.string().optional().default(""),
  funding_amount: z
    .string()
    .trim()
    .min(1, "Funding amount is required")
    .refine((v) => Number.isFinite(Number(v)) && Number(v) > 0, "Enter an amount greater than zero"),
  funding_purpose: z.string().trim().min(1, "Tell us what the funding is for"),
});

type FormValues = z.input<typeof schema>;

const inputCls =
  "w-full rounded-lg border border-border bg-white px-3 py-2.5 text-sm text-brand-navy outline-none focus:border-brand-teal focus:ring-2 focus:ring-brand-teal/20";
const labelCls = "block text-sm font-medium text-brand-navy mb-1.5";
const errCls = "mt-1 text-xs text-red-600";

const strOrNull = (v: string | undefined) => {
  const t = (v ?? "").trim();
  return t ? t : null;
};

export default function LeadSubmitForm({ portal }: { portal: PortalKind }) {
  const navigate = useNavigate();
  const industries = useIndustries();
  const submit = useSubmitLead(portal);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  // Files live in local state — File objects don't round-trip through RHF well.
  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addFiles = (incoming: FileList | null) => {
    if (!incoming) return;
    setFileError(null);
    const next: File[] = [...files];
    for (const f of Array.from(incoming)) {
      if (f.size > MAX_FILE_BYTES) {
        setFileError(`"${f.name}" is larger than 10MB and was not added.`);
        continue;
      }
      // De-dupe by name+size so re-picking the same file doesn't double it.
      if (!next.some((e) => e.name === f.name && e.size === f.size)) next.push(f);
    }
    setFiles(next);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeFile = (idx: number) => setFiles((prev) => prev.filter((_, i) => i !== idx));

  const onSubmit = async (v: FormValues) => {
    const input: SubmitLeadInput = {
      business_name: v.business_name!.trim(),
      contact_name: v.contact_name!.trim(),
      contact_cell: v.contact_cell ? normaliseSaCell(v.contact_cell) : null,
      contact_email: strOrNull(v.contact_email),
      cipc_number: strOrNull(v.cipc_number),
      industry_id: strOrNull(v.industry_id),
      funding_amount: Number(v.funding_amount),
      funding_purpose: strOrNull(v.funding_purpose),
      files,
    };
    try {
      await submit.mutateAsync(input);
      toast.success("Lead submitted for review");
      navigate(`/${portal}/leads`);
    } catch (e) {
      toast.error((e as Error).message || "Could not submit lead");
    }
  };

  const submitting = submit.isPending;

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold text-brand-navy">Submit a new lead</h1>
        <p className="text-sm text-muted-foreground">
          Tell us about the business that needs funding. We'll review it and take it from there.
        </p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        {/* Business */}
        <Fieldset title="Business">
          <Field label="Business name" error={errors.business_name?.message} full>
            <input className={inputCls} {...register("business_name")} />
          </Field>
          <Field label="CIPC number (optional)" error={errors.cipc_number?.message}>
            <input className={inputCls} placeholder="YYYY/NNNNNN/NN" {...register("cipc_number")} />
          </Field>
          <Field label="Sector / industry">
            <select className={inputCls} disabled={industries.isLoading} {...register("industry_id")}>
              <option value="">{industries.isLoading ? "Loading…" : "Not sure / other"}</option>
              {(industries.data ?? []).map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
          </Field>
        </Fieldset>

        {/* Contact */}
        <Fieldset title="Contact person">
          <Field label="Full name" error={errors.contact_name?.message}>
            <input className={inputCls} {...register("contact_name")} />
          </Field>
          <Field label="Phone" error={errors.contact_cell?.message}>
            <input className={inputCls} placeholder="082 123 4567" {...register("contact_cell")} />
          </Field>
          <Field label="Email" error={errors.contact_email?.message} full>
            <input className={inputCls} placeholder="name@business.co.za" {...register("contact_email")} />
          </Field>
        </Fieldset>

        {/* Funding need */}
        <Fieldset title="Funding need">
          <Field label="Amount requested (R)" error={errors.funding_amount?.message}>
            <input
              type="number"
              min="0"
              step="1000"
              className={inputCls}
              {...register("funding_amount")}
            />
          </Field>
          <Field label="What is the funding for?" error={errors.funding_purpose?.message} full>
            <textarea
              rows={3}
              className={inputCls}
              placeholder="e.g. Stock for a confirmed purchase order, new equipment, working capital…"
              {...register("funding_purpose")}
            />
          </Field>
        </Fieldset>

        {/* Documents */}
        <Fieldset title="Supporting documents (optional)">
          <div className="sm:col-span-2">
            <label className={labelCls}>Attach files</label>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex w-full flex-col items-center gap-2 rounded-lg border border-dashed border-border bg-slate-50 px-4 py-6 text-center hover:border-brand-teal hover:bg-brand-teal/5"
            >
              <UploadCloud className="h-6 w-6 text-brand-teal" />
              <span className="text-sm font-medium text-brand-navy">Click to choose files</span>
              <span className="text-xs text-muted-foreground">
                CIPC docs, bank statements, quotes — up to 10MB each
              </span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => addFiles(e.target.files)}
            />
            {fileError && <p className={errCls}>{fileError}</p>}

            {files.length > 0 && (
              <ul className="mt-3 space-y-2">
                {files.map((f, idx) => (
                  <li
                    key={`${f.name}-${f.size}-${idx}`}
                    className="flex items-center gap-2 rounded-lg border border-border bg-white px-3 py-2 text-sm"
                  >
                    <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate text-brand-navy">{f.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{formatFileSize(f.size)}</span>
                    <button
                      type="button"
                      onClick={() => removeFile(idx)}
                      className="shrink-0 rounded p-1 text-muted-foreground hover:bg-slate-100 hover:text-red-600"
                      aria-label={`Remove ${f.name}`}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Fieldset>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={submitting}
            className="rounded-lg bg-brand-teal px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-teal/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Submitting…" : "Submit lead"}
          </button>
          <button
            type="button"
            onClick={() => navigate(`/${portal}/leads`)}
            className="rounded-lg border border-border px-5 py-2.5 text-sm font-medium text-brand-navy hover:bg-slate-50"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

function Fieldset({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-4 rounded-xl border border-border bg-white p-6 shadow-sm">
      <legend className="px-1 text-sm font-semibold text-brand-navy">{title}</legend>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

function Field({
  label,
  error,
  full,
  children,
}: {
  label: string;
  error?: string;
  full?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={full ? "sm:col-span-2" : undefined}>
      <label className={labelCls}>{label}</label>
      {children}
      {error && <p className={errCls}>{error}</p>}
    </div>
  );
}
