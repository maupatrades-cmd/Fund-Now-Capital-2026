import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowLeft, AlertTriangle, Ban } from "lucide-react";
import { toast } from "sonner";
import {
  useClient,
  useCreateClient,
  useUpdateClient,
  useReferralPartners,
  useCheckClientDuplicates,
  type ClientInput,
  type ClientDuplicate,
} from "@/hooks/useClients";
import { useIndustries, type IndustryWithSubs } from "@/hooks/useIndustries";
import { isValidCipc } from "@/lib/sa-validation";

const nullableAmount = z.preprocess(
  (v) => (v === "" || v == null ? null : Number(v)),
  z.number().nonnegative("Must be zero or more").nullable(),
);

const schema = z.object({
  business_name: z.string().trim().min(1, "Business name is required"),
  short_code: z
    .string()
    .trim()
    .toUpperCase()
    .refine((value) => !value || /^[A-Z0-9]{2,12}$/.test(value), "Use 2–12 letters or numbers"),
  cipc_number: z
    .string()
    .optional()
    .default("")
    .refine((v) => !v || isValidCipc(v), "Format: YYYY/NNNNNN/NN"),
  industry_id: z.string().optional().default(""),
  sub_industry_id: z.string().optional().default(""),
  sector_notes: z.string().optional().default(""),
  monthly_turnover: nullableAmount,
  address: z.string().optional().default(""),
  referral_partner_id: z.string().optional().default(""), // "" = Self
  notes: z.string().optional().default(""),
});

type FormValues = z.input<typeof schema>;

const inputCls =
  "w-full rounded-lg border border-border bg-white px-3 py-2.5 text-sm text-brand-navy outline-none focus:border-brand-teal focus:ring-2 focus:ring-brand-teal/20";
const labelCls = "block text-sm font-medium text-brand-navy mb-1.5";
const errCls = "mt-1 text-xs text-red-600";

export default function ClientFormPage() {
  const { id } = useParams();
  const isEdit = !!id;
  const navigate = useNavigate();
  const existing = useClient(id);
  const partners = useReferralPartners();
  const industries = useIndustries();
  const createClient = useCreateClient();
  const updateClient = useUpdateClient();

  if ((isEdit && existing.isLoading) || industries.isLoading) {
    return <div className="text-sm text-muted-foreground">Loading…</div>;
  }

  const c = existing.data;
  const defaults: FormValues = {
    business_name: c?.business_name ?? "",
    short_code: c?.short_code ?? "",
    cipc_number: c?.cipc_number ?? "",
    industry_id: c?.industry_id ?? "",
    sub_industry_id: c?.sub_industry_id ?? "",
    sector_notes: c?.sector_notes ?? "",
    monthly_turnover: c?.monthly_turnover == null ? "" : String(c.monthly_turnover),
    address: c?.address ?? "",
    referral_partner_id: c?.referral_partner_id ?? "",
    notes: c?.notes ?? "",
  } as FormValues;

  return (
    <ClientForm
      key={c?.id ?? "new"}
      defaults={defaults}
      isEdit={isEdit}
      excludeClientId={isEdit ? id! : null}
      partners={partners.data ?? []}
      industries={industries.data ?? []}
      submitting={createClient.isPending || updateClient.isPending}
      onCancel={() => navigate(isEdit ? `/clients/${id}` : "/clients")}
      onSubmit={async (values) => {
        const input: ClientInput = {
          business_name: values.business_name!.trim(),
          short_code: values.short_code?.trim() ? values.short_code.trim().toUpperCase() : null,
          cipc_number: values.cipc_number?.trim() ? values.cipc_number.trim() : null,
          // Legacy free-text sector is not edited here — preserve whatever's on the
          // record (owner reconciles it manually; deprecated once B2 lands).
          sector: c?.sector ?? null,
          sector_notes: values.sector_notes ? values.sector_notes : null,
          industry_id: values.industry_id ? values.industry_id : null,
          sub_industry_id: values.sub_industry_id ? values.sub_industry_id : null,
          monthly_turnover: (values.monthly_turnover as number | null) ?? null,
          address: values.address ? values.address : null,
          referral_partner_id: values.referral_partner_id ? values.referral_partner_id : null,
          notes: values.notes ? values.notes : null,
        };
        try {
          if (isEdit) {
            await updateClient.mutateAsync({ id: id!, input });
            toast.success("Client updated");
            navigate(`/clients/${id}`);
          } else {
            const created = await createClient.mutateAsync(input);
            toast.success("Client added — you can add contacts and documents now");
            navigate(`/clients/${created.id}`);
          }
        } catch (e) {
          toast.error((e as Error).message || "Could not save client");
        }
      }}
    />
  );
}

function ClientForm({
  defaults,
  isEdit,
  excludeClientId,
  partners,
  industries,
  submitting,
  onSubmit,
  onCancel,
}: {
  defaults: FormValues;
  isEdit: boolean;
  excludeClientId: string | null;
  partners: { id: string; name: string }[];
  industries: IndustryWithSubs[];
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

  const selectedIndustryId = watch("industry_id");
  const subOptions =
    industries.find((i) => i.id === selectedIndustryId)?.sub_industries ?? [];

  // Duplicate-detection gate (B5.2). A CIPC-vs-client collision blocks the save;
  // a fuzzy business-name match warns and requires typed confirmation.
  const checkDuplicates = useCheckClientDuplicates();
  const [blockMatch, setBlockMatch] = useState<ClientDuplicate | null>(null);
  const [warnMatches, setWarnMatches] = useState<ClientDuplicate[] | null>(null);
  const [pending, setPending] = useState<FormValues | null>(null);
  const [confirmText, setConfirmText] = useState("");

  const clearGate = () => {
    setBlockMatch(null);
    setWarnMatches(null);
    setPending(null);
    setConfirmText("");
  };

  // Any field edit while a gate is showing wipes it, so a stale snapshot can't be
  // confirmed.
  const gateActive = !!blockMatch || !!warnMatches;
  useEffect(() => {
    if (!gateActive) return;
    const sub = watch(() => clearGate());
    return () => sub.unsubscribe();
  }, [gateActive, watch]);

  // Client-side pre-check before the write. The server independently rejects a
  // CIPC-vs-client duplicate (clients_cipc_block), so a failed/bypassed check can
  // never create one.
  const guardedSubmit = async (v: FormValues) => {
    clearGate();
    let matches: ClientDuplicate[] = [];
    try {
      matches = await checkDuplicates.mutateAsync({
        business_name: v.business_name!.trim(),
        cipc_number: v.cipc_number?.trim() || null,
        exclude_client_id: excludeClientId,
      });
    } catch (e) {
      console.warn("client duplicate check failed", e);
      toast.error("Couldn't check for duplicates — please try again.");
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
    <div className="max-w-2xl space-y-4">
      <Link to="/clients" className="inline-flex items-center gap-1.5 text-sm text-brand-teal hover:underline">
        <ArrowLeft className="h-4 w-4" /> Back to clients
      </Link>

      <form
        onSubmit={handleSubmit(guardedSubmit)}
        className="space-y-5 rounded-xl border border-border bg-white p-6 shadow-sm"
      >
        <h2 className="text-lg font-semibold text-brand-navy">
          {isEdit ? "Edit client" : "Add client"}
        </h2>

        <div>
          <label className={labelCls} htmlFor="business_name">
            Business name
          </label>
          <input id="business_name" className={inputCls} {...register("business_name")} />
          {errors.business_name && <p className={errCls}>{errors.business_name.message}</p>}
        </div>

        <div>
          <label className={labelCls} htmlFor="short_code">
            Invoice short code
          </label>
          <input
            id="short_code"
            maxLength={12}
            placeholder="Example: MAMAMABASE"
            className={`${inputCls} uppercase`}
            {...register("short_code")}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Used in funder invoice payment references. Use 2–12 letters or numbers.
          </p>
          {errors.short_code && <p className={errCls}>{errors.short_code.message}</p>}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelCls} htmlFor="cipc_number">
              CIPC number
            </label>
            <input
              id="cipc_number"
              placeholder="YYYY/NNNNNN/NN"
              className={inputCls}
              {...register("cipc_number")}
            />
            {errors.cipc_number && <p className={errCls}>{errors.cipc_number.message}</p>}
          </div>
          <div>
            <label className={labelCls} htmlFor="industry_id">
              Industry
            </label>
            <select
              id="industry_id"
              className={inputCls}
              {...register("industry_id", {
                // Changing the industry invalidates the previously chosen sub-industry.
                onChange: () => setValue("sub_industry_id", ""),
              })}
            >
              <option value="">Not set</option>
              {industries.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                  {i.active ? "" : " (inactive)"}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelCls} htmlFor="sub_industry_id">
              Sub-industry
            </label>
            <select
              id="sub_industry_id"
              className={inputCls}
              disabled={!selectedIndustryId}
              {...register("sub_industry_id")}
            >
              <option value="">{selectedIndustryId ? "Not set" : "Select an industry first"}</option>
              {subOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.active ? "" : " (inactive)"}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls} htmlFor="monthly_turnover">
              Monthly turnover (R)
            </label>
            <input
              id="monthly_turnover"
              type="number"
              min="0"
              step="1000"
              className={inputCls}
              {...register("monthly_turnover")}
            />
            {errors.monthly_turnover && <p className={errCls}>{errors.monthly_turnover.message}</p>}
          </div>
        </div>

        <div>
          <label className={labelCls} htmlFor="sector_notes">
            Sector notes <span className="font-normal text-muted-foreground">(anything the taxonomy doesn't capture)</span>
          </label>
          <textarea id="sector_notes" rows={2} className={inputCls} {...register("sector_notes")} />
        </div>

        <div>
          <label className={labelCls} htmlFor="referral_partner_id">
            Referred by
          </label>
          <select id="referral_partner_id" className={inputCls} {...register("referral_partner_id")}>
            <option value="">Self</option>
            {partners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelCls} htmlFor="address">
            Address
          </label>
          <textarea id="address" rows={2} className={inputCls} {...register("address")} />
        </div>

        <div>
          <label className={labelCls} htmlFor="notes">
            Notes
          </label>
          <textarea id="notes" rows={3} className={inputCls} {...register("notes")} />
        </div>

        {/* Hard block: an exact CIPC match against an existing client. */}
        {blockMatch && (
          <div className="flex items-start gap-3 rounded-xl border border-red-300 bg-red-50 p-4 text-sm">
            <Ban className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
            <div className="space-y-1">
              <p className="font-semibold text-red-800">
                A client already exists for this CIPC number — {blockMatch.business_name}.
              </p>
              <p className="text-red-700">
                A CIPC number is a unique legal identifier, so this is the same business.{" "}
                <Link to={`/clients/${blockMatch.entity_id}`} className="font-medium underline">
                  Open the existing client
                </Link>{" "}
                instead, or correct the CIPC number to continue.
              </p>
            </div>
          </div>
        )}

        {/* Soft warn: fuzzy-name matches — save allowed after typed confirmation. */}
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
                Type <span className="font-mono font-bold">SAVE</span> to add this client anyway
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

        <div className="flex items-center gap-3 pt-2">
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
                {checking ? "Checking…" : submitting ? "Saving…" : isEdit ? "Save changes" : "Add client"}
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

function matchLabel(m: ClientDuplicate): string {
  const where = m.entity === "client" ? "existing client" : "existing lead";
  switch (m.match_kind) {
    case "cipc":
      return `same CIPC number (${where})`;
    case "name":
      return `similar business name (${where})`;
    default:
      return where;
  }
}
