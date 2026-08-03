import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { formatZAR } from "@/lib/format";
import { CommissionStateBadge } from "@/components/deal/CommissionStateBadge";
import {
  ADJUSTMENTS,
  ATTRIBUTION_TYPES,
  CALC_BASES,
  CALC_BASE_BY_VALUE,
  MAX_TIER_MODIFIERS,
  TIER_MODIFIERS,
  TIMINGS,
  estimateGross,
  labelForAdjustment,
  labelForAttribution,
  labelForBase,
  labelForTierModifier,
  labelForTiming,
  type Adjustment,
  type AttributionType,
  type CalcBase,
  type CommissionCalculation,
  type TierModifier,
  type Timing,
} from "@/lib/commissionPicker";
import {
  useAttributionOptions,
  useCommissionPicker,
  useDealCommissionRecord,
  useProfileName,
  useSetCommissionPicker,
  useTransitionToLocked,
  useTransitionToPending,
  useUnlockCommission,
  useUpdateCommissionPicker,
} from "@/hooks/useCommissionPicker";

// Owner-only Commission Picker (PICKER.md). Lives on the Deal Detail Page.
// Section A base / B tier modifiers / C timing / D adjustments + attribution;
// live estimated-gross preview; POTENTIAL → PENDING → LOCKED lifecycle.
//
// Scope note: this PR folds ATTRIBUTION into the picker's own verified Save
// (stored under commission_calculation.attribution) rather than a separate
// set_deal_attribution RPC — that tier-engine RPC is not yet built/live, so
// wiring a Save to it would ship a broken button. The attribution selection
// round-trips today and is forward-compatible with the tier engine.

const numOrNull = (s: string): number | null => {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

const BASE_VALUES = CALC_BASES.map((b) => b.value) as [CalcBase, ...CalcBase[]];
const TIMING_VALUES = TIMINGS.map((t) => t.value) as [Timing, ...Timing[]];
const TIER_VALUES = TIER_MODIFIERS.map((t) => t.value) as [TierModifier, ...TierModifier[]];
const ADJ_VALUES = ADJUSTMENTS.map((a) => a.value) as [Adjustment, ...Adjustment[]];
const ATTR_VALUES = ATTRIBUTION_TYPES.map((a) => a.value) as [AttributionType, ...AttributionType[]];

// Validates the assembled selection at Save time. Cross-field rules (a percent
// base needs a rate + amount, points needs sell/buy/facility, a cap needs a
// positive value, a contractor/partner attribution needs a person) live in the
// superRefine so the error points at the offending field.
const formSchema = z
  .object({
    base: z.enum(BASE_VALUES),
    rate: z.number().finite().min(0).nullable(),
    baseAmount: z.number().finite().min(0).nullable(),
    sellRate: z.number().finite().nullable(),
    buyRate: z.number().finite().nullable(),
    cap: z.number().finite().nullable(),
    timing: z.enum(TIMING_VALUES),
    tierModifiers: z.array(z.enum(TIER_VALUES)).max(MAX_TIER_MODIFIERS),
    adjustments: z.array(z.enum(ADJ_VALUES)),
    attrType: z.enum(ATTR_VALUES),
    contractorId: z.string().nullable(),
    partnerId: z.string().nullable(),
  })
  .superRefine((v, ctx) => {
    const kind = CALC_BASE_BY_VALUE[v.base].kind;
    if (kind === "percent") {
      if (v.rate == null) ctx.addIssue({ code: "custom", path: ["rate"], message: "Enter a rate (%)." });
      if (v.baseAmount == null)
        ctx.addIssue({ code: "custom", path: ["baseAmount"], message: "Enter the base amount." });
    } else if (kind === "points") {
      if (v.sellRate == null) ctx.addIssue({ code: "custom", path: ["sellRate"], message: "Enter the sell rate." });
      if (v.buyRate == null) ctx.addIssue({ code: "custom", path: ["buyRate"], message: "Enter the buy rate." });
      if (v.baseAmount == null)
        ctx.addIssue({ code: "custom", path: ["baseAmount"], message: "Enter the advance amount." });
    } else if (v.baseAmount == null) {
      ctx.addIssue({ code: "custom", path: ["baseAmount"], message: "Enter the commission amount." });
    }
    if (v.adjustments.includes("cap_ceiling") && (v.cap == null || v.cap <= 0)) {
      ctx.addIssue({ code: "custom", path: ["cap"], message: "Enter a cap greater than zero." });
    }
    if (v.attrType === "fnc_contractor" && !v.contractorId)
      ctx.addIssue({ code: "custom", path: ["contractorId"], message: "Pick a contractor." });
    if (v.attrType === "bright_destiny_partner" && !v.partnerId)
      ctx.addIssue({ code: "custom", path: ["partnerId"], message: "Pick a partner." });
  });

export function CommissionPickerWidget({ dealId, amountRequested }: { dealId: string; amountRequested: string | null }) {
  const { data: state, isLoading, isError, error } = useCommissionPicker(dealId);
  const setPicker = useSetCommissionPicker();
  const updatePicker = useUpdateCommissionPicker();
  const toPending = useTransitionToPending();
  const toLocked = useTransitionToLocked();
  const unlock = useUnlockCommission();
  const { data: attrOptions } = useAttributionOptions();

  // ---- Form state (controlled) ----
  const [base, setBase] = useState<CalcBase>("percent_of_finance_charge");
  const [rate, setRate] = useState("");
  const [baseAmount, setBaseAmount] = useState("");
  const [sellRate, setSellRate] = useState("");
  const [buyRate, setBuyRate] = useState("");
  const [cap, setCap] = useState("");
  const [timing, setTiming] = useState<Timing>("upfront_at_funding");
  const [tierModifiers, setTierModifiers] = useState<TierModifier[]>([]);
  const [adjustments, setAdjustments] = useState<Adjustment[]>([]);
  const [attrType, setAttrType] = useState<AttributionType>("direct_fnc");
  const [contractorId, setContractorId] = useState("");
  const [partnerId, setPartnerId] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const commissionState = state?.commission_state ?? null;
  const isLocked = commissionState === "locked";

  // Hydrate from the server when the deal changes or the lifecycle state moves
  // (a transition never changes the picks, so re-seeding on state change is safe
  // and keeps the read-only locked view canonical). `hydratedKey` prevents an
  // unrelated refetch from clobbering an in-progress edit.
  const hydratedKey = useRef<string | null>(null);
  useEffect(() => {
    if (!state) return;
    const key = `${dealId}:${state.commission_state ?? "none"}`;
    if (hydratedKey.current === key) return;
    hydratedKey.current = key;

    const c = state.commission_calculation;
    if (c) {
      setBase(c.base);
      setRate(c.rate != null ? String(c.rate) : "");
      setBaseAmount(c.inputs?.base_amount != null ? String(c.inputs.base_amount) : "");
      setSellRate(c.inputs?.sell_rate != null ? String(c.inputs.sell_rate) : "");
      setBuyRate(c.inputs?.buy_rate != null ? String(c.inputs.buy_rate) : "");
      setCap(c.inputs?.cap != null ? String(c.inputs.cap) : "");
      setTiming(c.timing);
      setTierModifiers(c.tier_modifiers ?? []);
      setAdjustments(c.adjustments ?? []);
      setAttrType(c.attribution?.type ?? "direct_fnc");
      setContractorId(c.attribution?.contractor_id ?? "");
      setPartnerId(c.attribution?.partner_id ?? "");
    }
    setFormError(null);
  }, [dealId, state]);

  const baseMeta = CALC_BASE_BY_VALUE[base];

  // Live preview — recomputes on every input change.
  const estimated = useMemo(
    () =>
      estimateGross({
        base,
        rate: numOrNull(rate),
        adjustments,
        inputs: {
          base_amount: numOrNull(baseAmount),
          sell_rate: numOrNull(sellRate),
          buy_rate: numOrNull(buyRate),
          cap: numOrNull(cap),
        },
      }),
    [base, rate, baseAmount, sellRate, buyRate, cap, adjustments],
  );

  const toggleTier = (v: TierModifier) => {
    setTierModifiers((prev) => {
      if (prev.includes(v)) return prev.filter((x) => x !== v);
      if (prev.length >= MAX_TIER_MODIFIERS) {
        toast.error(`Pick at most ${MAX_TIER_MODIFIERS} tier modifiers.`);
        return prev;
      }
      return [...prev, v];
    });
  };
  const toggleAdj = (v: Adjustment) =>
    setAdjustments((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]));

  // ---- Save (create or edit) ----
  const savingRef = useRef(false);
  const saving = setPicker.isPending || updatePicker.isPending;

  const buildCalculation = (): CommissionCalculation => ({
    base,
    rate: baseMeta.kind === "percent" ? numOrNull(rate) : undefined,
    timing,
    tier_modifiers: tierModifiers,
    adjustments,
    inputs: {
      base_amount: numOrNull(baseAmount),
      ...(baseMeta.kind === "points" ? { sell_rate: numOrNull(sellRate), buy_rate: numOrNull(buyRate) } : {}),
      ...(adjustments.includes("cap_ceiling") ? { cap: numOrNull(cap) } : {}),
    },
    attribution: {
      type: attrType,
      ...(attrType === "fnc_contractor" ? { contractor_id: contractorId } : {}),
      ...(attrType === "bright_destiny_partner" ? { partner_id: partnerId } : {}),
    },
  });

  const onSave = async () => {
    if (savingRef.current || isLocked) return;
    setFormError(null);

    const parsed = formSchema.safeParse({
      base,
      rate: numOrNull(rate),
      baseAmount: numOrNull(baseAmount),
      sellRate: numOrNull(sellRate),
      buyRate: numOrNull(buyRate),
      cap: numOrNull(cap),
      timing,
      tierModifiers,
      adjustments,
      attrType,
      contractorId: contractorId || null,
      partnerId: partnerId || null,
    });
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? "Please complete the required fields.");
      return;
    }
    if (estimated == null || estimated < 0) {
      setFormError("The estimated gross commission couldn't be computed from these inputs.");
      return;
    }

    savingRef.current = true;
    const calculation = buildCalculation();
    const payload = { dealId, calculation, estimatedGross: estimated };
    try {
      // No row yet → create (set); an existing POTENTIAL/PENDING row → edit (update).
      if (commissionState == null) await setPicker.mutateAsync(payload);
      else await updatePicker.mutateAsync(payload);
      toast.success("Commission saved");
    } catch (e) {
      toast.error((e as Error).message || "Could not save the commission");
    } finally {
      savingRef.current = false;
    }
  };

  // ---- Transitions ----
  const pendingRef = useRef(false);
  const onMoveToPending = async () => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    try {
      await toPending.mutateAsync({ dealId });
      toast.success("Moved to Pending");
    } catch (e) {
      toast.error((e as Error).message || "Could not move to pending");
    } finally {
      pendingRef.current = false;
    }
  };

  const [lockOpen, setLockOpen] = useState(false);
  const [unlockOpen, setUnlockOpen] = useState(false);

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading commission…</p>;
  if (isError) {
    return (
      <p className="text-sm text-red-600">
        {(error as Error)?.message ?? "Could not load commission state."}
      </p>
    );
  }

  const disabled = isLocked;

  return (
    <div className="space-y-5">
      {/* Header + state badge */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-brand-navy">Commission Calculation</h3>
        <CommissionStateBadge state={commissionState} />
      </div>

      {isLocked && <LockedBanner dealId={dealId} state={state!} />}

      {/* Attribution — always visible, above the picker (PICKER.md). */}
      <fieldset disabled={disabled} className="space-y-2">
        <SectionTitle>Attribution</SectionTitle>
        <p className="text-xs text-muted-foreground">Who this deal belongs to — drives the downstream split.</p>
        <div className="grid gap-2 sm:grid-cols-3">
          {ATTRIBUTION_TYPES.map((a) => (
            <RadioCard
              key={a.value}
              checked={attrType === a.value}
              onSelect={() => setAttrType(a.value)}
              label={a.label}
              hint={a.hint}
              disabled={disabled}
            />
          ))}
        </div>
        {attrType === "fnc_contractor" && (
          <SelectField
            label="Contractor"
            value={contractorId}
            onChange={setContractorId}
            options={attrOptions?.contractors ?? []}
            emptyLabel="No active contractors"
            disabled={disabled}
          />
        )}
        {attrType === "bright_destiny_partner" && (
          <SelectField
            label="Partner"
            value={partnerId}
            onChange={setPartnerId}
            options={attrOptions?.partners ?? []}
            emptyLabel="No active partners"
            disabled={disabled}
          />
        )}
      </fieldset>

      <div className="border-t border-border" />

      {/* Section A — Calculation base (pick 1) */}
      <fieldset disabled={disabled} className="space-y-2">
        <SectionTitle>A · Calculation base</SectionTitle>
        <div className="grid gap-2 sm:grid-cols-2">
          {CALC_BASES.map((b) => (
            <RadioCard
              key={b.value}
              checked={base === b.value}
              onSelect={() => setBase(b.value)}
              label={b.label}
              hint={b.hint}
              disabled={disabled}
            />
          ))}
        </div>

        {/* Base-dependent inputs */}
        <div className="grid gap-3 sm:grid-cols-2 pt-1">
          {baseMeta.kind === "percent" && (
            <NumberField label="Rate (%)" value={rate} onChange={setRate} placeholder="10" disabled={disabled} />
          )}
          {baseMeta.kind === "points" && (
            <>
              <NumberField label="Sell rate" value={sellRate} onChange={setSellRate} placeholder="1.5" disabled={disabled} />
              <NumberField label="Buy rate" value={buyRate} onChange={setBuyRate} placeholder="1.2" disabled={disabled} />
            </>
          )}
          <NumberField
            label={baseMeta.amountLabel}
            value={baseAmount}
            onChange={setBaseAmount}
            placeholder="140000"
            disabled={disabled}
            hint={
              amountRequested && (baseMeta.value === "percent_of_gross_funded" || baseMeta.kind === "points")
                ? `Deal amount requested: ${formatZAR(amountRequested)}`
                : undefined
            }
          />
        </div>
      </fieldset>

      {/* Section B — Tier modifiers (0–2) */}
      <fieldset disabled={disabled} className="space-y-2">
        <SectionTitle>
          B · Tier modifiers <span className="font-normal text-muted-foreground">(pick 0–{MAX_TIER_MODIFIERS})</span>
        </SectionTitle>
        <div className="grid gap-2 sm:grid-cols-2">
          {TIER_MODIFIERS.map((t) => (
            <CheckCard
              key={t.value}
              checked={tierModifiers.includes(t.value)}
              onToggle={() => toggleTier(t.value)}
              label={t.label}
              hint={t.hint}
              disabled={disabled}
            />
          ))}
        </div>
      </fieldset>

      {/* Section C — Timing (pick 1) */}
      <fieldset disabled={disabled} className="space-y-2">
        <SectionTitle>C · Timing</SectionTitle>
        <div className="grid gap-2 sm:grid-cols-3">
          {TIMINGS.map((t) => (
            <RadioCard
              key={t.value}
              checked={timing === t.value}
              onSelect={() => setTiming(t.value)}
              label={t.label}
              hint={t.hint}
              disabled={disabled}
            />
          ))}
        </div>
      </fieldset>

      {/* Section D — Special adjustments (0–N) */}
      <fieldset disabled={disabled} className="space-y-2">
        <SectionTitle>
          D · Special adjustments <span className="font-normal text-muted-foreground">(pick 0–N)</span>
        </SectionTitle>
        <div className="grid gap-2 sm:grid-cols-2">
          {ADJUSTMENTS.map((a) => (
            <CheckCard
              key={a.value}
              checked={adjustments.includes(a.value)}
              onToggle={() => toggleAdj(a.value)}
              label={a.label}
              hint={a.hint}
              disabled={disabled}
            />
          ))}
        </div>
        {adjustments.includes("cap_ceiling") && (
          <div className="sm:max-w-xs">
            <NumberField label="Cap / ceiling (R)" value={cap} onChange={setCap} placeholder="20000" disabled={disabled} />
          </div>
        )}
      </fieldset>

      <div className="border-t border-border" />

      {/* Estimated gross preview */}
      <div className="rounded-lg bg-brand-navy/5 p-4">
        <div className="flex items-center justify-between gap-4">
          <span className="text-sm font-medium text-brand-navy">Estimated Gross Commission</span>
          <span className="text-lg font-bold text-brand-navy">
            {estimated != null ? formatZAR(estimated, { cents: true }) : "—"}
          </span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          FNC gross before the downstream split. VAT / retention / clawback and other adjustments are applied later by the
          money engine, not to this figure.
        </p>
      </div>

      {formError && <p className="text-sm text-red-600">{formError}</p>}

      {/* Actions */}
      {!isLocked && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="rounded-lg bg-brand-teal px-4 py-2 text-sm font-semibold text-white hover:bg-brand-teal/90 disabled:opacity-60"
          >
            {saving ? "Saving…" : commissionState == null ? "Save commission" : "Save changes"}
          </button>

          {commissionState === "potential" && (
            <button
              type="button"
              onClick={onMoveToPending}
              disabled={toPending.isPending}
              className="rounded-lg border border-brand-navy px-4 py-2 text-sm font-medium text-brand-navy hover:bg-slate-50 disabled:opacity-60"
            >
              {toPending.isPending ? "Moving…" : "Move to Pending"}
            </button>
          )}

          {commissionState === "pending" && (
            <button
              type="button"
              onClick={() => setLockOpen(true)}
              className="rounded-lg bg-brand-green px-4 py-2 text-sm font-semibold text-white hover:bg-brand-green/90"
            >
              Lock Commission
            </button>
          )}
        </div>
      )}

      {isLocked && (
        <button
          type="button"
          onClick={() => setUnlockOpen(true)}
          className="rounded-lg border border-amber-400 px-4 py-2 text-sm font-medium text-amber-700 hover:bg-amber-50"
        >
          Unlock
        </button>
      )}

      {lockOpen && (
        <LockModal
          estimated={estimated}
          isPending={toLocked.isPending}
          onClose={() => setLockOpen(false)}
          onConfirm={async (actual) => {
            try {
              await toLocked.mutateAsync({ dealId, actualGross: actual });
              toast.success("Commission locked");
              setLockOpen(false);
            } catch (e) {
              toast.error((e as Error).message || "Could not lock the commission");
            }
          }}
        />
      )}

      {unlockOpen && (
        <UnlockModal
          isPending={unlock.isPending}
          onClose={() => setUnlockOpen(false)}
          onConfirm={async (reason) => {
            try {
              await unlock.mutateAsync({ dealId, reason });
              toast.success("Commission unlocked — back to Pending");
              setUnlockOpen(false);
            } catch (e) {
              toast.error((e as Error).message || "Could not unlock the commission");
            }
          }}
        />
      )}
    </div>
  );
}

// -------------------------------------------------------------------------
// Locked read-only banner: actual gross, audit trail, downstream tier result.
// -------------------------------------------------------------------------
function LockedBanner({ dealId, state }: { dealId: string; state: NonNullable<ReturnType<typeof useCommissionPicker>["data"]> }) {
  const { data: lockedByName } = useProfileName(state.commission_locked_by);
  const { data: record } = useDealCommissionRecord(dealId, true);
  const calc = state.commission_calculation;

  return (
    <div className="space-y-3 rounded-lg border border-brand-green/30 bg-brand-green/5 p-4">
      <div className="flex items-center justify-between gap-4">
        <span className="text-sm font-medium text-brand-navy">Actual Gross Commission (locked)</span>
        <span className="text-lg font-bold text-brand-navy">
          {formatZAR(state.actual_gross_commission, { cents: true })}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        Locked {state.commission_locked_at ? new Date(state.commission_locked_at).toLocaleString("en-ZA") : ""}
        {lockedByName ? ` by ${lockedByName}` : ""}. Inputs are read-only — use Unlock to make corrections.
      </p>

      {calc && (
        <div className="text-xs text-muted-foreground">
          <span className="font-medium text-brand-navy">{labelForBase(calc.base)}</span>
          {calc.rate != null ? ` · ${calc.rate}%` : ""} · {labelForTiming(calc.timing)} ·{" "}
          {labelForAttribution(calc.attribution?.type ?? "direct_fnc")}
          {calc.tier_modifiers?.length ? ` · ${calc.tier_modifiers.map(labelForTierModifier).join(", ")}` : ""}
          {calc.adjustments?.length ? ` · ${calc.adjustments.map(labelForAdjustment).join(", ")}` : ""}
        </div>
      )}

      {/* Downstream tier / split result (owner-only) */}
      <div className="border-t border-brand-green/20 pt-2">
        {record ? (
          <div className="space-y-1 text-sm">
            <Row label="Gross commission" value={formatZAR(record.gross_commission, { cents: true })} strong />
            <Row label="Company retention" value={formatZAR(record.company_retention, { cents: true })} />
            <Row label="Partner pool" value={formatZAR(record.partner_pool, { cents: true })} />
            <Row
              label={`Partner share${record.tier_pct != null ? ` (${record.tier_pct}%)` : ""}`}
              value={formatZAR(record.partner_share, { cents: true })}
            />
            <Row label="Owner share" value={formatZAR(record.owner_share, { cents: true })} strong />
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            The tier split will appear here once this deal's commission is processed by the money engine.
          </p>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className={strong ? "text-brand-navy" : "text-muted-foreground"}>{label}</span>
      <span className={strong ? "font-bold text-brand-navy" : "font-medium text-brand-navy"}>{value}</span>
    </div>
  );
}

// -------------------------------------------------------------------------
// Modals
// -------------------------------------------------------------------------
function LockModal({
  estimated,
  isPending,
  onClose,
  onConfirm,
}: {
  estimated: number | null;
  isPending: boolean;
  onClose: () => void;
  onConfirm: (actual: number) => void;
}) {
  const [actual, setActual] = useState(estimated != null ? String(estimated) : "");
  const confirmingRef = useRef(false);
  const n = numOrNull(actual);

  return (
    <Modal title="Lock commission" onClose={onClose}>
      <p className="text-sm text-muted-foreground">
        Enter the actual FNC gross commission the funder paid. Locking makes it immutable until you unlock for a correction.
      </p>
      <NumberField label="Actual gross commission (R)" value={actual} onChange={setActual} placeholder="14000" />
      <div className="flex items-center gap-3 pt-1">
        <button
          type="button"
          disabled={isPending || n == null || n < 0}
          onClick={() => {
            if (confirmingRef.current || n == null || n < 0) return;
            confirmingRef.current = true;
            onConfirm(n);
            // Re-arm shortly after; the modal usually unmounts on success.
            setTimeout(() => (confirmingRef.current = false), 1000);
          }}
          className="rounded-lg bg-brand-green px-4 py-2 text-sm font-semibold text-white hover:bg-brand-green/90 disabled:opacity-60"
        >
          {isPending ? "Locking…" : "Confirm lock"}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-brand-navy hover:bg-slate-50"
        >
          Cancel
        </button>
      </div>
    </Modal>
  );
}

function UnlockModal({
  isPending,
  onClose,
  onConfirm,
}: {
  isPending: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const confirmingRef = useRef(false);
  const trimmed = reason.trim();

  return (
    <Modal title="Unlock commission" onClose={onClose}>
      <p className="text-sm text-muted-foreground">
        This unlocks the deal for corrections and moves it back to <strong>Pending</strong>. A typed reason is recorded in
        the audit trail.
      </p>
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">Reason</label>
        <textarea
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. funder disputed the amount"
          className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:border-brand-teal focus:ring-2 focus:ring-brand-teal/20"
        />
      </div>
      <div className="flex items-center gap-3 pt-1">
        <button
          type="button"
          disabled={isPending || trimmed === ""}
          onClick={() => {
            if (confirmingRef.current || trimmed === "") return;
            confirmingRef.current = true;
            onConfirm(trimmed);
            setTimeout(() => (confirmingRef.current = false), 1000);
          }}
          className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-500/90 disabled:opacity-60"
        >
          {isPending ? "Unlocking…" : "Unlock for corrections"}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-brand-navy hover:bg-slate-50"
        >
          Cancel
        </button>
      </div>
    </Modal>
  );
}

// -------------------------------------------------------------------------
// Small presentational primitives
// -------------------------------------------------------------------------
function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h4 className="text-xs font-semibold uppercase tracking-wide text-brand-navy">{children}</h4>;
}

function RadioCard({
  checked,
  onSelect,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onSelect: () => void;
  label: string;
  hint: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      aria-pressed={checked}
      className={
        "flex flex-col items-start rounded-lg border px-3 py-2 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-70 " +
        (checked
          ? "border-brand-teal bg-brand-teal/10 ring-1 ring-brand-teal"
          : "border-border hover:bg-slate-50")
      }
    >
      <span className="font-medium text-brand-navy">{label}</span>
      <span className="text-xs text-muted-foreground">{hint}</span>
    </button>
  );
}

function CheckCard({
  checked,
  onToggle,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
  hint: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={checked}
      className={
        "flex items-start gap-2 rounded-lg border px-3 py-2 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-70 " +
        (checked ? "border-brand-teal bg-brand-teal/10 ring-1 ring-brand-teal" : "border-border hover:bg-slate-50")
      }
    >
      <span
        className={
          "mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border text-[10px] " +
          (checked ? "border-brand-teal bg-brand-teal text-white" : "border-slate-300")
        }
        aria-hidden="true"
      >
        {checked ? "✓" : ""}
      </span>
      <span className="flex flex-col">
        <span className="font-medium text-brand-navy">{label}</span>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </span>
    </button>
  );
}

function NumberField({
  label,
  value,
  onChange,
  placeholder,
  disabled,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <Input
        type="number"
        inputMode="decimal"
        step="any"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
      />
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
  emptyLabel,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { id: string; label: string }[];
  emptyLabel: string;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1 sm:max-w-sm">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled || options.length === 0}
        className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:border-brand-teal disabled:cursor-not-allowed disabled:opacity-70"
      >
        <option value="">{options.length === 0 ? emptyLabel : "Select…"}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
