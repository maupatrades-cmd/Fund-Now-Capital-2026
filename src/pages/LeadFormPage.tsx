import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowLeft, AlertTriangle, Ban } from "lucide-react";
import { toast } from "sonner";
import { useReferralPartners } from "@/hooks/useClients";
import { useIndustries, type IndustryWithSubs } from "@/hooks/useIndustries";
import {
  useLead,
  useCreateLead,
  useUpdateLead,
  useCheckLeadDuplicates,
  type LeadInput,
  type LeadDuplicate,
} from "@/hooks/useLeads";
import {
  ENTITY_TYPES,
  EMPLOYEE_RANGES,
  TURNOVER_RANGES,
  FUNDING_TIMELINES,
  FUNDING_PURPOSES,
  SECURITY_OPTIONS,
  REFERRED_BY,
  CIPC_REGEX,
  SA_ID_REGEX,
  isValidSaCell,
  normaliseSaCell,
} from "@/lib/leads";

const schema = z.object({
  business_name: z.string().trim().min(1, "Business name is required"),
  entity_type: z.string().optional().default(""),
  cipc_number: z
    .string()
    .optional()
    .default("")
    .refine((v) => !v || CIPC_REGEX.test(v), "Format: YYYY/NNNNNN/NN"),
  industry_id: z.string().optional().default(""),
  sub_industry_id: z.string().optional().default(""),
  sector_notes: z.string().optional().default(""),
  website: z.string().optional().default(""),
  trading_history_months: z.string().optional().default(""),
  employee_range: z.string().optional().default(""),
  monthly_turnover_range: z.string().optional().default(""),
  annual_turnover: z.string().optional().default(""),
  contact_name: z.string().trim().min(1, "Contact name is required"),
  contact_role: z.string().optional().default(""),
  contact_cell: z
    .string()
    .optional()
    .default("")
    .refine((v) => !v || isValidSaCell(v), "Enter a valid SA cell (0.. or +27..)"),
  contact_email: z
    .string()
    .optional()
    .default("")
    .refine((v) => !v || z.email().safeParse(v).success, "Enter a valid email"),
  contact_id_number: z
    .string()
    .optional()
    .default("")
    .refine((v) => !v || SA_ID_REGEX.test(v), "SA ID must be 13 digits"),
  physical_address: z.string().optional().default(""),
  registered_address: z.string().optional().default(""),
  region: z.string().optional().default(""),
  funding_amount: z.string().optional().default(""),
  funding_purpose: z.array(z.string()).optional().default([]),
  funding_timeline: z.string().optional().default(""),
  has_existing_debt: z.boolean().optional().default(false),
  existing_debt_details: z.string().optional().default(""),
  security_available: z.array(z.string()).optional().default([]),
  referred_by: z.string().optional().default("self"),
  referred_by_other: z.string().optional().default(""),
  loaded_on_behalf: z.boolean().optional().default(false),
  original_referrer_id: z.string().optional().default(""),
  initial_notes: z.string().optional().default(""),
  follow_up_date: z.string().optional().default(""),
});

type FormValues = z.input<typeof schema>;

const inputCls =
  "w-full rounded-lg border border-border bg-white px-3 py-2.5 text-sm text-brand-navy outline-none focus:border-brand-teal focus:ring-2 focus:ring-brand-teal/20";
const labelCls = "block text-sm font-medium text-brand-navy mb-1.5";
const errCls = "mt-1 text-xs text-red-600";

const toNum = (v: string | undefined) => {
  const n = Number(v);
  return v && Number.isFinite(n) ? n : null;
};
const strOrNull = (v: string | undefined) => (v && v.trim() ? v.trim() : null);

export default function LeadFormPage() {
  const { id } = useParams();
  const isEdit = !!id;
  const navigate = useNavigate();
  const existing = useLead(id);
  const partners = useReferralPartners();
  const industries = useIndustries();
  const createLead = useCreateLead();
  const updateLead = useUpdateLead();

  if ((isEdit && existing.isLoading) || industries.isLoading || partners.isLoading) {
    return <div className="text-sm text-muted-foreground">Loading…</div>;
  }

  // If the lead we're editing fails to load, never fall through to blank
  // defaults — a save would overwrite the real record with empty values.
  if (isEdit && existing.isError) {
    return (
      <div className="max-w-3xl space-y-3">
        <Link to="/leads" className="inline-flex items-center gap-1.5 text-sm text-brand-teal hover:underline">
          <ArrowLeft className="h-4 w-4" /> Back to leads
        </Link>
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Couldn't load this lead to edit: {(existing.error as Error)?.message ?? "not found"}.{" "}
          <button type="button" onClick={() => existing.refetch()} className="font-medium underline">
            Retry
          </button>
        </div>
      </div>
    );
  }

  // Match on the stable slug, not the display name (rename-safe).
  const brightDestinyId = partners.data?.find((p) => p.slug === "bright_destiny")?.id ?? null;
  const l = existing.data;

  const defaults: FormValues = {
    business_name: l?.business_name ?? "",
    entity_type: l?.entity_type ?? "",
    cipc_number: l?.cipc_number ?? "",
    industry_id: l?.industry_id ?? "",
    sub_industry_id: l?.sub_industry_id ?? "",
    sector_notes: l?.sector_notes ?? "",
    website: l?.website ?? "",
    trading_history_months: l?.trading_history_months == null ? "" : String(l.trading_history_months),
    employee_range: l?.employee_range ?? "",
    monthly_turnover_range: l?.monthly_turnover_range ?? "",
    annual_turnover: l?.annual_turnover == null ? "" : String(l.annual_turnover),
    contact_name: l?.contact_name ?? "",
    contact_role: l?.contact_role ?? "",
    contact_cell: l?.contact_cell ?? "",
    contact_email: l?.contact_email ?? "",
    contact_id_number: l?.contact_id_number ?? "",
    physical_address: l?.physical_address ?? "",
    registered_address: l?.registered_address ?? "",
    region: l?.region ?? "",
    funding_amount: l?.funding_amount == null ? "" : String(l.funding_amount),
    funding_purpose: l?.funding_purpose ?? [],
    funding_timeline: l?.funding_timeline ?? "",
    has_existing_debt: l?.has_existing_debt ?? false,
    existing_debt_details: l?.existing_debt_details?.notes ?? "",
    security_available: l?.security_available ?? [],
    referred_by: l?.referred_by ?? "self",
    referred_by_other: l?.referred_by_other ?? "",
    loaded_on_behalf: l?.loaded_on_behalf ?? false,
    original_referrer_id: l?.original_referrer_id ?? "",
    initial_notes: l?.initial_notes ?? "",
    follow_up_date: l?.follow_up_date ?? "",
  } as FormValues;

  const buildInput = (v: FormValues): LeadInput => {
    const referredBy = v.referred_by || "self";
    const loadedOnBehalf = !!v.loaded_on_behalf;
    return {
      business_name: v.business_name!.trim(),
      entity_type: strOrNull(v.entity_type),
      cipc_number: strOrNull(v.cipc_number),
      industry_id: strOrNull(v.industry_id),
      sub_industry_id: strOrNull(v.sub_industry_id),
      sector_notes: strOrNull(v.sector_notes),
      website: strOrNull(v.website),
      trading_history_months: toNum(v.trading_history_months),
      employee_range: strOrNull(v.employee_range),
      monthly_turnover_range: strOrNull(v.monthly_turnover_range),
      annual_turnover: toNum(v.annual_turnover),
      contact_name: v.contact_name!.trim(),
      contact_role: strOrNull(v.contact_role),
      contact_cell: v.contact_cell ? normaliseSaCell(v.contact_cell) : null,
      contact_email: strOrNull(v.contact_email),
      contact_id_number: strOrNull(v.contact_id_number),
      physical_address: strOrNull(v.physical_address),
      registered_address: strOrNull(v.registered_address),
      region: strOrNull(v.region),
      funding_amount: toNum(v.funding_amount),
      funding_purpose: v.funding_purpose ?? [],
      funding_timeline: strOrNull(v.funding_timeline),
      has_existing_debt: !!v.has_existing_debt,
      existing_debt_details:
        v.has_existing_debt && v.existing_debt_details?.trim()
          ? { notes: v.existing_debt_details.trim() }
          : null,
      security_available: v.security_available ?? [],
      referred_by: referredBy,
      referred_by_other: referredBy === "other" ? strOrNull(v.referred_by_other) : null,
      // Bright Destiny is the only contracted partner → auto-link on that choice.
      referral_partner_id: referredBy === "bright_destiny" ? brightDestinyId : null,
      loaded_on_behalf: loadedOnBehalf,
      original_referrer_id: loadedOnBehalf ? strOrNull(v.original_referrer_id) : null,
      initial_notes: strOrNull(v.initial_notes),
      follow_up_date: strOrNull(v.follow_up_date),
    };
  };

  return (
    <LeadForm
      key={l?.id ?? "new"}
      defaults={defaults}
      isEdit={isEdit}
      excludeLeadId={isEdit ? id! : null}
      industries={industries.data ?? []}
      partners={partners.data ?? []}
      submitting={createLead.isPending || updateLead.isPending}
      onCancel={() => navigate(isEdit ? `/leads/${id}` : "/leads")}
      onSubmit={async (v) => {
        const input = buildInput(v);
        try {
          if (isEdit) {
            await updateLead.mutateAsync({ id: id!, input });
            toast.success("Lead updated");
            navigate(`/leads/${id}`);
          } else {
            const created = await createLead.mutateAsync(input);
            toast.success("Lead captured");
            navigate(`/leads/${created.id}`);
          }
        } catch (e) {
          toast.error((e as Error).message || "Could not save lead");
        }
      }}
    />
  );
}

function LeadForm({
  defaults,
  isEdit,
  excludeLeadId,
  industries,
  partners,
  submitting,
  onSubmit,
  onCancel,
}: {
  defaults: FormValues;
  isEdit: boolean;
  excludeLeadId: string | null;
  industries: IndustryWithSubs[];
  partners: { id: string; name: string }[];
  submitting: boolean;
  onSubmit: (v: FormValues) => void;
  onCancel: () => void;
}) {
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: defaults });

  const checkDuplicates = useCheckLeadDuplicates();
  // Duplicate-detection gate (B2.3). A CIPC-vs-lead collision blocks the save;
  // fuzzy-name / email / cell matches warn and require typed confirmation.
  const [blockMatch, setBlockMatch] = useState<LeadDuplicate | null>(null);
  const [warnMatches, setWarnMatches] = useState<LeadDuplicate[] | null>(null);
  const [pending, setPending] = useState<FormValues | null>(null);
  const [confirmText, setConfirmText] = useState("");

  const industryId = watch("industry_id");
  const referredBy = watch("referred_by");
  const hasDebt = watch("has_existing_debt");
  const loadedOnBehalf = watch("loaded_on_behalf");
  const subOptions = industries.find((i) => i.id === industryId)?.sub_industries ?? [];

  const clearGate = () => {
    setBlockMatch(null);
    setWarnMatches(null);
    setPending(null);
    setConfirmText("");
  };

  // Client-side pre-check before the write. The server independently rejects a
  // CIPC-vs-lead duplicate, so a failed/bypassed check can never create one.
  const guardedSubmit = async (v: FormValues) => {
    clearGate();
    const cell = v.contact_cell && isValidSaCell(v.contact_cell) ? normaliseSaCell(v.contact_cell) : null;
    let matches: LeadDuplicate[] = [];
    try {
      matches = await checkDuplicates.mutateAsync({
        business_name: v.business_name!.trim(),
        cipc_number: strOrNull(v.cipc_number),
        contact_email: strOrNull(v.contact_email),
        contact_cell: cell,
        exclude_lead_id: excludeLeadId,
      });
    } catch (e) {
      // Advisory check failed — proceed to the save; the DB guard still protects
      // against a genuine CIPC duplicate.
      console.warn("duplicate check failed, proceeding to save", e);
      onSubmit(v);
      return;
    }
    const block = matches.find((m) => m.severity === "block");
    if (block) {
      setBlockMatch(block);
      return;
    }
    const warns = matches.filter((m) => m.severity === "warn");
    if (warns.length) {
      setWarnMatches(warns);
      setPending(v);
      return;
    }
    onSubmit(v);
  };

  const checking = checkDuplicates.isPending;

  return (
    <div className="max-w-3xl space-y-4">
      <Link to="/leads" className="inline-flex items-center gap-1.5 text-sm text-brand-teal hover:underline">
        <ArrowLeft className="h-4 w-4" /> Back to leads
      </Link>

      <form onSubmit={handleSubmit(guardedSubmit)} className="space-y-6">
        <h2 className="text-lg font-semibold text-brand-navy">{isEdit ? "Edit lead" : "Add lead"}</h2>

        {/* Business info */}
        <Fieldset title="Business info">
          <Field label="Business name" error={errors.business_name?.message} full>
            <input className={inputCls} {...register("business_name")} />
          </Field>
          <Field label="Entity type">
            <select className={inputCls} {...register("entity_type")}>
              <option value="">Not set</option>
              {ENTITY_TYPES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
          <Field label="CIPC number" error={errors.cipc_number?.message}>
            <input className={inputCls} placeholder="YYYY/NNNNNN/NN" {...register("cipc_number")} />
          </Field>
          <Field label="Industry">
            <select
              className={inputCls}
              {...register("industry_id", { onChange: () => setValue("sub_industry_id", "") })}
            >
              <option value="">Not set</option>
              {industries.map((i) => (
                <option key={i.id} value={i.id}>{i.name}{i.active ? "" : " (inactive)"}</option>
              ))}
            </select>
          </Field>
          <Field label="Sub-industry">
            <select className={inputCls} disabled={!industryId} {...register("sub_industry_id")}>
              <option value="">{industryId ? "Not set" : "Select an industry first"}</option>
              {subOptions.map((s) => (
                <option key={s.id} value={s.id}>{s.name}{s.active ? "" : " (inactive)"}</option>
              ))}
            </select>
          </Field>
          <Field label="Website">
            <input className={inputCls} placeholder="https://…" {...register("website")} />
          </Field>
          <Field label="Sector notes" full>
            <textarea rows={2} className={inputCls} {...register("sector_notes")} />
          </Field>
        </Fieldset>

        {/* Trading & scale */}
        <Fieldset title="Trading & scale">
          <Field label="Trading history (months)">
            <input type="number" min="0" className={inputCls} {...register("trading_history_months")} />
          </Field>
          <Field label="Employees">
            <select className={inputCls} {...register("employee_range")}>
              <option value="">Not set</option>
              {EMPLOYEE_RANGES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
          <Field label="Monthly turnover">
            <select className={inputCls} {...register("monthly_turnover_range")}>
              <option value="">Not set</option>
              {TURNOVER_RANGES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
          <Field label="Annual turnover (R)">
            <input type="number" min="0" step="1000" className={inputCls} {...register("annual_turnover")} />
          </Field>
        </Fieldset>

        {/* Primary contact */}
        <Fieldset title="Primary contact">
          <Field label="Contact name" error={errors.contact_name?.message}>
            <input className={inputCls} {...register("contact_name")} />
          </Field>
          <Field label="Role">
            <input className={inputCls} {...register("contact_role")} />
          </Field>
          <Field label="Cell" error={errors.contact_cell?.message}>
            <input className={inputCls} placeholder="082 123 4567" {...register("contact_cell")} />
          </Field>
          <Field label="Email" error={errors.contact_email?.message}>
            <input className={inputCls} {...register("contact_email")} />
          </Field>
          <Field label="ID number" error={errors.contact_id_number?.message}>
            <input className={inputCls} placeholder="13 digits" {...register("contact_id_number")} />
          </Field>
        </Fieldset>

        {/* Addresses */}
        <Fieldset title="Addresses">
          <Field label="Physical address" full>
            <textarea rows={2} className={inputCls} {...register("physical_address")} />
          </Field>
          <Field label="Registered address" full>
            <textarea rows={2} className={inputCls} {...register("registered_address")} />
          </Field>
          <Field label="Region">
            <input className={inputCls} placeholder="e.g. Gauteng" {...register("region")} />
          </Field>
        </Fieldset>

        {/* Funding need */}
        <Fieldset title="Funding need">
          <Field label="Funding amount (R)">
            <input type="number" min="0" step="1000" className={inputCls} {...register("funding_amount")} />
          </Field>
          <Field label="Timeline">
            <select className={inputCls} {...register("funding_timeline")}>
              <option value="">Not set</option>
              {FUNDING_TIMELINES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
          <Field label="Funding purpose" full>
            <CheckboxGroup options={FUNDING_PURPOSES} name="funding_purpose" register={register} />
          </Field>
        </Fieldset>

        {/* Debt & security */}
        <Fieldset title="Debt & security">
          <Field label="Has existing debt" full>
            <label className="inline-flex items-center gap-2 text-sm text-brand-navy">
              <input type="checkbox" className="h-4 w-4 rounded border-border" {...register("has_existing_debt")} />
              This business has existing debt
            </label>
          </Field>
          {hasDebt && (
            <Field label="Existing debt details" full>
              <textarea rows={2} className={inputCls} {...register("existing_debt_details")} />
            </Field>
          )}
          <Field label="Security available" full>
            <CheckboxGroup options={SECURITY_OPTIONS} name="security_available" register={register} />
          </Field>
        </Fieldset>

        {/* Referral */}
        <Fieldset title="Referral">
          <Field label="Referred by">
            <select className={inputCls} {...register("referred_by")}>
              {REFERRED_BY.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
          {referredBy === "bright_destiny" && (
            <Field label=" ">
              <p className="text-xs text-muted-foreground">Auto-linked to Bright Destiny.</p>
            </Field>
          )}
          {referredBy === "other" && (
            <Field label="Referrer name">
              <input className={inputCls} placeholder="Who referred this lead?" {...register("referred_by_other")} />
            </Field>
          )}
          <Field label="Loaded on behalf" full>
            <label className="inline-flex items-center gap-2 text-sm text-brand-navy">
              <input type="checkbox" className="h-4 w-4 rounded border-border" {...register("loaded_on_behalf")} />
              I'm capturing this on behalf of a referral partner
            </label>
          </Field>
          {loadedOnBehalf && (
            <Field label="Original referrer" full>
              <select className={inputCls} {...register("original_referrer_id")}>
                <option value="">Select partner…</option>
                {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
          )}
        </Fieldset>

        {/* Notes & follow-up */}
        <Fieldset title="Notes & follow-up">
          <Field label="Follow-up date">
            <input type="date" className={inputCls} {...register("follow_up_date")} />
          </Field>
          <Field label="Initial notes" full>
            <textarea rows={3} className={inputCls} {...register("initial_notes")} />
          </Field>
        </Fieldset>

        {/* Hard block: an exact CIPC match against an existing lead. */}
        {blockMatch && (
          <div className="flex items-start gap-3 rounded-xl border border-red-300 bg-red-50 p-4 text-sm">
            <Ban className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
            <div className="space-y-1">
              <p className="font-semibold text-red-800">
                A lead already exists for this CIPC number — {blockMatch.business_name}.
              </p>
              <p className="text-red-700">
                A CIPC number is a unique legal identifier, so this is the same business.{" "}
                <Link to={`/leads/${blockMatch.entity_id}`} className="font-medium underline">
                  Open the existing lead
                </Link>{" "}
                instead, or correct the CIPC number to continue.
              </p>
            </div>
          </div>
        )}

        {/* Soft warn: fuzzy-name / email / cell matches — save allowed after typed confirmation. */}
        {warnMatches && (
          <div className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
              <div>
                <p className="font-semibold text-amber-900">This looks like a possible duplicate.</p>
                <p className="text-amber-800">
                  We found {warnMatches.length} similar {warnMatches.length === 1 ? "record" : "records"}.
                  Check it isn't the same business before saving.
                </p>
              </div>
            </div>
            <ul className="space-y-1.5 pl-8">
              {warnMatches.map((m) => (
                <li key={`${m.entity}-${m.entity_id}-${m.match_kind}`} className="text-amber-900">
                  <Link
                    to={m.entity === "client" ? `/clients/${m.entity_id}` : `/leads/${m.entity_id}`}
                    className="font-medium underline"
                  >
                    {m.business_name}
                  </Link>{" "}
                  <span className="text-amber-700">— {matchLabel(m)}</span>
                </li>
              ))}
            </ul>
            <div className="pl-8">
              <label className="block font-medium text-amber-900 mb-1.5">
                Type <span className="font-mono font-bold">SAVE</span> to add this lead anyway
              </label>
              <input
                className="w-40 rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm text-brand-navy outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="SAVE"
              />
            </div>
          </div>
        )}

        <div className="flex items-center gap-3">
          {warnMatches ? (
            <>
              <button
                type="button"
                disabled={submitting || confirmText.trim().toUpperCase() !== "SAVE"}
                onClick={() => pending && onSubmit(pending)}
                className="rounded-lg bg-amber-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-60"
              >
                {submitting ? "Saving…" : "Save anyway"}
              </button>
              <button
                type="button"
                onClick={clearGate}
                className="rounded-lg border border-border px-5 py-2.5 text-sm font-medium text-brand-navy hover:bg-slate-50"
              >
                Go back
              </button>
            </>
          ) : (
            <>
              <button
                type="submit"
                disabled={submitting || checking}
                className="rounded-lg bg-brand-teal px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-teal/90 disabled:opacity-60"
              >
                {checking ? "Checking…" : submitting ? "Saving…" : isEdit ? "Save changes" : "Add lead"}
              </button>
              <button
                type="button"
                onClick={onCancel}
                className="rounded-lg border border-border px-5 py-2.5 text-sm font-medium text-brand-navy hover:bg-slate-50"
              >
                Cancel
              </button>
            </>
          )}
        </div>
      </form>
    </div>
  );
}

// Human label for why a duplicate candidate matched.
function matchLabel(m: LeadDuplicate): string {
  const where = m.entity === "client" ? "existing client" : "existing lead";
  switch (m.match_kind) {
    case "cipc":
      return `same CIPC number (${where})`;
    case "name":
      return `similar business name (${where})`;
    case "email":
      return `same contact email (${where})`;
    case "cell":
      return `same contact cell (${where})`;
    default:
      return where;
  }
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

function CheckboxGroup({
  options,
  name,
  register,
}: {
  options: { value: string; label: string }[];
  name: "funding_purpose" | "security_available";
  register: ReturnType<typeof useForm<FormValues>>["register"];
}) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2">
      {options.map((o) => (
        <label key={o.value} className="inline-flex items-center gap-2 text-sm text-brand-navy">
          <input type="checkbox" value={o.value} className="h-4 w-4 rounded border-border" {...register(name)} />
          {o.label}
        </label>
      ))}
    </div>
  );
}
