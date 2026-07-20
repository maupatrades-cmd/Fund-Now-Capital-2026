import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, Pencil, Trash2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import {
  useStakeholders,
  useSaveStakeholder,
  useDeleteStakeholder,
  type Stakeholder,
  type StakeEntity,
  type StakeholderInput,
} from "@/hooks/useStakeholders";
import {
  STAKEHOLDER_ROLES,
  ID_TYPES,
  STAKEHOLDER_ROLE_BADGE,
  ROLE_LABEL,
  BENEFICIAL_OWNER_THRESHOLD,
  isValidPassportNumber,
  summarizeRoles,
  shareholdingSum,
  type StakeholderRole,
} from "@/lib/stakeholders";
import { isValidSAIdNumber, formatSaIdSummary, isValidSaCell, normaliseSaCell } from "@/lib/sa-validation";
import { COUNTRIES, countryLabel } from "@/lib/countries";

const fieldCls =
  "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-brand-navy outline-none focus:border-brand-teal focus:ring-2 focus:ring-brand-teal/20";
const labelCls = "block text-xs font-medium text-muted-foreground mb-1";
const errCls = "mt-1 text-xs text-red-600";
const btnPrimary =
  "inline-flex items-center gap-1.5 rounded-lg bg-brand-teal px-4 py-2 text-sm font-semibold text-white hover:bg-brand-teal/90 disabled:opacity-60";
const btnNeutral = "rounded-lg border border-border px-4 py-2 text-sm font-medium text-brand-navy hover:bg-slate-50";

const schema = z
  .object({
    full_name: z.string().trim().min(1, "Name is required"),
    id_type: z.enum(["sa_id", "passport"]),
    id_number: z.string().optional().default(""),
    passport_country: z.string().optional().default(""),
    roles: z.array(z.string()).default([]),
    shareholding_percent: z.string().optional().default(""),
    is_beneficial_owner: z.boolean().default(false),
    cell: z.string().optional().default(""),
    email: z.string().optional().default(""),
    physical_address: z.string().optional().default(""),
    notes: z.string().optional().default(""),
  })
  .superRefine((val, ctx) => {
    if (!val.roles || val.roles.length === 0)
      ctx.addIssue({ code: "custom", path: ["roles"], message: "Select at least one role" });

    if (val.id_number) {
      if (val.id_type === "sa_id" && !isValidSAIdNumber(val.id_number))
        ctx.addIssue({ code: "custom", path: ["id_number"], message: "Not a valid SA ID number — check the digits" });
      if (val.id_type === "passport" && !isValidPassportNumber(val.id_number))
        ctx.addIssue({ code: "custom", path: ["id_number"], message: "Passport must be 6–12 letters/numbers" });
    }

    if (val.id_type === "passport" && !val.passport_country)
      ctx.addIssue({ code: "custom", path: ["passport_country"], message: "Select the passport country" });

    const isShareholder = (val.roles ?? []).includes("shareholder");
    if (isShareholder && !val.shareholding_percent)
      ctx.addIssue({ code: "custom", path: ["shareholding_percent"], message: "Shareholders need a shareholding %" });
    if (val.shareholding_percent) {
      const n = Number(val.shareholding_percent);
      if (Number.isNaN(n) || n < 0 || n > 100)
        ctx.addIssue({ code: "custom", path: ["shareholding_percent"], message: "Enter a percentage between 0 and 100" });
    }

    if (val.cell && !isValidSaCell(val.cell))
      ctx.addIssue({ code: "custom", path: ["cell"], message: "Enter a valid SA cell number" });
    if (val.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(val.email))
      ctx.addIssue({ code: "custom", path: ["email"], message: "Enter a valid email" });
  });

type FormValues = z.input<typeof schema>;

export function StakeholdersPanel({ entity }: { entity: StakeEntity }) {
  const { data, isLoading } = useStakeholders(entity);
  const del = useDeleteStakeholder(entity);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Stakeholder | null>(null);

  const rows = data ?? [];
  const summary = summarizeRoles(rows);
  const shareSum = shareholdingSum(rows);
  const hasShareholders = rows.some((r) => r.roles.includes("shareholder"));

  const onDelete = async (s: Stakeholder) => {
    if (!window.confirm(`Remove ${s.full_name} from this ${entity.kind}'s stakeholders?`)) return;
    try {
      await del.mutateAsync(s.id);
      toast.success("Stakeholder removed");
    } catch (e) {
      toast.error((e as Error).message || "Could not remove stakeholder");
    }
  };

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading stakeholders…</p>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-brand-navy">
            {rows.length === 0 ? "No stakeholders captured yet" : summary}
          </p>
          {hasShareholders && (
            <p
              className={
                "text-xs " + (shareSum > 100 ? "font-medium text-amber-700" : "text-muted-foreground")
              }
            >
              {shareSum > 100
                ? `⚠ Shareholding totals ${shareSum}% — over 100%. Review the cap table.`
                : `Shareholding allocated: ${shareSum}%${shareSum < 100 ? ` · ${100 - shareSum}% unallocated` : ""}`}
            </p>
          )}
        </div>
        {!adding && !editing && (
          <button type="button" className={btnPrimary} onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" /> Add stakeholder
          </button>
        )}
      </div>

      {adding && (
        <StakeholderForm entity={entity} existing={null} onDone={() => setAdding(false)} />
      )}

      <ul className="space-y-2">
        {rows.map((s) =>
          editing?.id === s.id ? (
            <li key={s.id}>
              <StakeholderForm entity={entity} existing={s} onDone={() => setEditing(null)} />
            </li>
          ) : (
            <li key={s.id}>
              <StakeholderRow
                s={s}
                onEdit={() => setEditing(s)}
                onDelete={() => onDelete(s)}
                disabled={del.isPending}
              />
            </li>
          ),
        )}
      </ul>
    </div>
  );
}

function StakeholderRow({
  s,
  onEdit,
  onDelete,
  disabled,
}: {
  s: Stakeholder;
  onEdit: () => void;
  onDelete: () => void;
  disabled: boolean;
}) {
  const idLine =
    s.id_type === "passport"
      ? s.id_number
        ? `Passport ${s.id_number} · ${countryLabel(s.passport_country)}`
        : `Passport · ${countryLabel(s.passport_country)}`
      : s.id_number
        ? `SA ID ${s.id_number}`
        : "SA ID —";

  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-border bg-slate-50 p-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-brand-navy">{s.full_name}</span>
          {s.roles.map((r) => (
            <Badge key={r} className={STAKEHOLDER_ROLE_BADGE[r as StakeholderRole]}>
              {ROLE_LABEL[r as StakeholderRole] ?? r}
            </Badge>
          ))}
          {s.is_beneficial_owner && (
            <Badge className="bg-brand-navy/10 text-brand-navy ring-brand-navy/20">
              <ShieldCheck className="mr-1 h-3 w-3" /> Beneficial owner
            </Badge>
          )}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {idLine}
          {s.shareholding_percent != null && <> · {s.shareholding_percent}% shareholding</>}
        </p>
        {(s.cell || s.email) && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            {[s.cell, s.email].filter(Boolean).join(" · ")}
          </p>
        )}
      </div>
      <div className="flex shrink-0 gap-1">
        <button
          type="button"
          onClick={onEdit}
          disabled={disabled}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-white hover:text-brand-navy disabled:opacity-50"
          aria-label="Edit stakeholder"
        >
          <Pencil className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={disabled}
          className="rounded-md p-1.5 text-red-600 hover:bg-white disabled:opacity-50"
          aria-label="Remove stakeholder"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function StakeholderForm({
  entity,
  existing,
  onDone,
}: {
  entity: StakeEntity;
  existing: Stakeholder | null;
  onDone: () => void;
}) {
  const isEdit = !!existing;
  const save = useSaveStakeholder(entity);
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      full_name: existing?.full_name ?? "",
      id_type: existing?.id_type ?? "sa_id",
      id_number: existing?.id_number ?? "",
      passport_country: existing?.passport_country ?? "",
      roles: existing?.roles ?? [],
      shareholding_percent:
        existing?.shareholding_percent != null ? String(existing.shareholding_percent) : "",
      is_beneficial_owner: existing?.is_beneficial_owner ?? false,
      cell: existing?.cell ?? "",
      email: existing?.email ?? "",
      physical_address: existing?.physical_address ?? "",
      notes: existing?.notes ?? "",
    },
  });

  const idType = watch("id_type");
  const idNumber = watch("id_number") ?? "";
  const pctRaw = watch("shareholding_percent") ?? "";

  // Auto-suggest beneficial owner at >= threshold (decision 4). Respect a manual
  // toggle: once the owner touches the checkbox, stop overriding it. On edit we
  // start "touched" so a stored value is never clobbered.
  const boTouched = useRef(isEdit);
  useEffect(() => {
    if (boTouched.current) return;
    const n = Number(pctRaw);
    setValue("is_beneficial_owner", !Number.isNaN(n) && pctRaw !== "" && n >= BENEFICIAL_OWNER_THRESHOLD);
  }, [pctRaw, setValue]);

  const idSummary = idType === "sa_id" ? formatSaIdSummary(idNumber) : null;

  const onSubmit = async (v: FormValues) => {
    const roles = (v.roles ?? []) as StakeholderRole[];
    const pct = v.shareholding_percent ? Number(v.shareholding_percent) : null;
    const input: StakeholderInput = {
      full_name: v.full_name!.trim(),
      id_type: v.id_type!,
      id_number: v.id_number?.trim() || null,
      // country only travels with a passport (matches the DB CHECK).
      passport_country: v.id_type === "passport" ? v.passport_country || null : null,
      roles,
      shareholding_percent: pct,
      is_beneficial_owner: !!v.is_beneficial_owner,
      cell: v.cell ? normaliseSaCell(v.cell) : null,
      email: v.email?.trim() || null,
      physical_address: v.physical_address?.trim() || null,
      notes: v.notes?.trim() || null,
    };
    try {
      await save.mutateAsync({ id: existing?.id, input });
      toast.success(isEdit ? "Stakeholder updated" : "Stakeholder added");
      onDone();
    } catch (e) {
      toast.error((e as Error).message || "Could not save stakeholder");
    }
  };

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="space-y-3 rounded-lg border border-brand-teal/40 bg-slate-50 p-4"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={labelCls}>Full name</label>
          <input className={fieldCls} {...register("full_name")} />
          {errors.full_name && <p className={errCls}>{errors.full_name.message}</p>}
        </div>

        <div>
          <label className={labelCls}>ID type</label>
          <select className={fieldCls} {...register("id_type")}>
            {ID_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelCls}>{idType === "passport" ? "Passport number" : "SA ID number"}</label>
          <input
            className={fieldCls}
            placeholder={idType === "passport" ? "6–12 letters/numbers" : "13 digits"}
            {...register("id_number")}
          />
          {errors.id_number ? (
            <p className={errCls}>{errors.id_number.message}</p>
          ) : (
            idSummary && <p className="mt-1 text-xs text-brand-teal">{idSummary}</p>
          )}
        </div>

        {idType === "passport" && (
          <div className="sm:col-span-2">
            <label className={labelCls}>Passport country</label>
            <select className={fieldCls} {...register("passport_country")}>
              <option value="">Select a country…</option>
              {COUNTRIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label} ({c.value})
                </option>
              ))}
            </select>
            {errors.passport_country && <p className={errCls}>{errors.passport_country.message}</p>}
          </div>
        )}

        <div className="sm:col-span-2">
          <label className={labelCls}>Roles</label>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {STAKEHOLDER_ROLES.map((r) => (
              <label key={r.value} className="inline-flex items-center gap-2 text-sm text-brand-navy">
                <input
                  type="checkbox"
                  value={r.value}
                  className="h-4 w-4 rounded border-border accent-brand-teal"
                  {...register("roles")}
                />
                {r.label}
              </label>
            ))}
          </div>
          {errors.roles && <p className={errCls}>{errors.roles.message as string}</p>}
        </div>

        <div>
          <label className={labelCls}>Shareholding %</label>
          <input
            type="number"
            min="0"
            max="100"
            step="0.01"
            className={fieldCls}
            placeholder="e.g. 30"
            {...register("shareholding_percent")}
          />
          {errors.shareholding_percent && <p className={errCls}>{errors.shareholding_percent.message}</p>}
        </div>

        <div className="flex items-end">
          <label className="inline-flex items-center gap-2 text-sm text-brand-navy">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-border accent-brand-teal"
              {...register("is_beneficial_owner", { onChange: () => (boTouched.current = true) })}
            />
            Beneficial owner
            <span className="text-xs text-muted-foreground">(FICA: suggested at ≥{BENEFICIAL_OWNER_THRESHOLD}%)</span>
          </label>
        </div>

        <div>
          <label className={labelCls}>Cell</label>
          <input className={fieldCls} placeholder="082 123 4567" {...register("cell")} />
          {errors.cell && <p className={errCls}>{errors.cell.message}</p>}
        </div>

        <div>
          <label className={labelCls}>Email</label>
          <input className={fieldCls} {...register("email")} />
          {errors.email && <p className={errCls}>{errors.email.message}</p>}
        </div>

        <div className="sm:col-span-2">
          <label className={labelCls}>Physical address</label>
          <input className={fieldCls} {...register("physical_address")} />
        </div>

        <div className="sm:col-span-2">
          <label className={labelCls}>Notes</label>
          <textarea rows={2} className={fieldCls} {...register("notes")} />
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <button type="button" className={btnNeutral} onClick={onDone} disabled={save.isPending}>
          Cancel
        </button>
        <button type="submit" className={btnPrimary} disabled={save.isPending}>
          {save.isPending ? "Saving…" : isEdit ? "Save changes" : "Add stakeholder"}
        </button>
      </div>
    </form>
  );
}
