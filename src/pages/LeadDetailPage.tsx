import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Pencil, CheckCircle2, XCircle, PlayCircle } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { formatZAR } from "@/lib/format";
import {
  ENTITY_TYPES,
  EMPLOYEE_RANGES,
  TURNOVER_RANGES,
  FUNDING_TIMELINES,
  FUNDING_PURPOSES,
  SECURITY_OPTIONS,
  QUALIFICATION_STAGES,
  QUALIFICATION_BADGE,
  NOT_QUALIFIED_REASONS,
  labelFor,
} from "@/lib/leads";
import {
  useLead,
  useStartQualifying,
  useQualifyLead,
  useMarkNotQualified,
  type Lead,
} from "@/hooks/useLeads";
import { one } from "@/hooks/useClients";
import { ActivityFeed } from "@/components/activity/ActivityFeed";

const labelList = (options: { value: string; label: string }[], values: string[] | null) =>
  values && values.length ? values.map((v) => labelFor(options, v)).join(", ") : null;

export default function LeadDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: lead, isLoading, isError, error } = useLead(id);

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading lead…</div>;
  if (isError || !lead) {
    return (
      <div className="space-y-3">
        <BackLink />
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Couldn't load lead: {(error as Error)?.message ?? "not found"}
        </div>
      </div>
    );
  }

  const referredBy =
    lead.referred_by === "other"
      ? lead.referred_by_other || "Other"
      : lead.referred_by === "bright_destiny"
        ? (one(lead.referral_partner)?.name ?? "Bright Destiny")
        : "Self (direct)";

  return (
    <div className="max-w-4xl space-y-5">
      <BackLink />

      <div className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-border bg-white p-6 shadow-sm">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-brand-navy">{lead.business_name}</h1>
            <Badge className={QUALIFICATION_BADGE[lead.qualification_stage] ?? ""}>
              {labelFor(QUALIFICATION_STAGES, lead.qualification_stage)}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {one(lead.industry)?.name || "Industry not set"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate(`/leads/${lead.id}/edit`)}
          className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-brand-navy hover:bg-slate-50"
        >
          <Pencil className="h-4 w-4" /> Edit
        </button>
      </div>

      <QualificationPanel lead={lead} />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Section title="Business info">
          <Info label="Entity type" value={labelFor(ENTITY_TYPES, lead.entity_type)} />
          <Info label="CIPC number" value={lead.cipc_number} />
          <Info label="Industry" value={one(lead.industry)?.name ?? null} />
          <Info label="Sub-industry" value={one(lead.sub_industry)?.name ?? null} />
          <Info label="Website" value={lead.website} />
          <Info label="Sector notes" value={lead.sector_notes} />
        </Section>

        <Section title="Trading & scale">
          <Info label="Trading history" value={lead.trading_history_months != null ? `${lead.trading_history_months} months` : null} />
          <Info label="Employees" value={labelFor(EMPLOYEE_RANGES, lead.employee_range)} />
          <Info label="Monthly turnover" value={labelFor(TURNOVER_RANGES, lead.monthly_turnover_range)} />
          <Info label="Annual turnover" value={lead.annual_turnover != null ? formatZAR(lead.annual_turnover) : null} />
        </Section>

        <Section title="Primary contact">
          <Info label="Name" value={lead.contact_name} />
          <Info label="Role" value={lead.contact_role} />
          <Info label="Cell" value={lead.contact_cell} />
          <Info label="Email" value={lead.contact_email} />
          <Info label="ID number" value={lead.contact_id_number} />
        </Section>

        <Section title="Addresses">
          <Info label="Physical" value={lead.physical_address} />
          <Info label="Registered" value={lead.registered_address} />
          <Info label="Region" value={lead.region} />
        </Section>

        <Section title="Funding need">
          <Info label="Amount" value={lead.funding_amount != null ? formatZAR(lead.funding_amount) : null} />
          <Info label="Timeline" value={labelFor(FUNDING_TIMELINES, lead.funding_timeline)} />
          <Info label="Purpose" value={labelList(FUNDING_PURPOSES, lead.funding_purpose)} />
        </Section>

        <Section title="Debt & security">
          <Info label="Existing debt" value={lead.has_existing_debt ? "Yes" : "No"} />
          <Info label="Debt details" value={lead.existing_debt_details?.notes ?? null} />
          <Info label="Security available" value={labelList(SECURITY_OPTIONS, lead.security_available)} />
        </Section>

        <Section title="Referral">
          <Info label="Referred by" value={referredBy} />
          <Info label="Loaded on behalf" value={lead.loaded_on_behalf ? "Yes" : "No"} />
          {lead.loaded_on_behalf && (
            <Info label="Original referrer" value={one(lead.original_referrer)?.name ?? null} />
          )}
        </Section>

        <Section title="Notes & follow-up">
          <Info
            label="Follow-up date"
            value={lead.follow_up_date ? new Date(lead.follow_up_date).toLocaleDateString("en-ZA") : null}
          />
          <Info label="Initial notes" value={lead.initial_notes} />
        </Section>
      </div>

      <section className="rounded-xl border border-border bg-white p-5 shadow-sm">
        <ActivityFeed entityId={lead.id} />
      </section>
    </div>
  );
}

const btnPrimary =
  "inline-flex items-center gap-1.5 rounded-lg bg-brand-teal px-4 py-2 text-sm font-semibold text-white hover:bg-brand-teal/90 disabled:opacity-60";
const btnDanger =
  "inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60";
const btnNeutral =
  "rounded-lg border border-border px-4 py-2 text-sm font-medium text-brand-navy hover:bg-slate-50";

function QualificationPanel({ lead }: { lead: Lead }) {
  const navigate = useNavigate();
  const startQualifying = useStartQualifying();
  const qualify = useQualifyLead();
  const [confirmQualify, setConfirmQualify] = useState(false);
  const [notQualifiedOpen, setNotQualifiedOpen] = useState(false);

  const stage = lead.qualification_stage;
  const linkedDeal = lead.linked_deals?.[0] ?? null;

  const onStart = () =>
    startQualifying.mutate(lead.id, {
      onError: (e) => toast.error(e instanceof Error ? e.message : "Could not start qualifying"),
    });

  const onQualify = () =>
    qualify.mutate(lead.id, {
      onSuccess: (dealId) => {
        toast.success("Lead qualified — deal created");
        navigate(`/deals/${dealId}`);
      },
      onError: (e) => toast.error(e instanceof Error ? e.message : "Could not qualify lead"),
    });

  return (
    <section className="rounded-xl border border-border bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-brand-navy">Qualification</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Current stage:{" "}
            <span className="font-medium text-brand-navy">{labelFor(QUALIFICATION_STAGES, stage)}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {stage === "new_lead" && (
            <button type="button" className={btnPrimary} onClick={onStart} disabled={startQualifying.isPending}>
              <PlayCircle className="h-4 w-4" /> Start Qualifying
            </button>
          )}
          {stage === "under_qualification" && (
            <>
              <button type="button" className={btnPrimary} onClick={() => setConfirmQualify(true)}>
                <CheckCircle2 className="h-4 w-4" /> Qualify
              </button>
              <button type="button" className={btnDanger} onClick={() => setNotQualifiedOpen(true)}>
                <XCircle className="h-4 w-4" /> Mark Not Qualified
              </button>
            </>
          )}
          {(stage === "qualified" || stage === "not_qualified") && (
            <Badge className={QUALIFICATION_BADGE[stage] ?? ""}>
              {labelFor(QUALIFICATION_STAGES, stage)}
            </Badge>
          )}
        </div>
      </div>

      {stage === "qualified" && (
        <p className="mt-3 text-sm text-muted-foreground">
          {linkedDeal ? (
            <>
              Deal created:{" "}
              <Link to={`/deals/${linkedDeal.id}`} className="font-medium text-brand-teal hover:underline">
                {linkedDeal.reference ?? "View deal"}
              </Link>
            </>
          ) : (
            "This lead is qualified."
          )}
        </p>
      )}
      {stage === "not_qualified" && (
        <div className="mt-3 space-y-1 text-sm">
          <p className="text-muted-foreground">
            Reason:{" "}
            <span className="font-medium text-brand-navy">
              {labelFor(NOT_QUALIFIED_REASONS, lead.not_qualified_reason)}
            </span>
          </p>
          {lead.not_qualified_notes && (
            <p className="text-muted-foreground">
              Notes: <span className="text-brand-navy">{lead.not_qualified_notes}</span>
            </p>
          )}
        </div>
      )}

      {confirmQualify && (
        <ModalShell onClose={() => setConfirmQualify(false)} label="Qualify lead">
          <h3 className="text-lg font-semibold text-brand-navy">Qualify this lead and create a deal?</h3>
          <p className="text-sm text-muted-foreground">
            A new deal will be created at the "Qualifying" stage linked to this lead.
          </p>
          <div className="flex items-center justify-end gap-2 pt-1">
            <button type="button" className={btnNeutral} onClick={() => setConfirmQualify(false)}>
              Cancel
            </button>
            <button type="button" className={btnPrimary} onClick={onQualify} disabled={qualify.isPending}>
              {qualify.isPending ? "Qualifying…" : "Qualify & create deal"}
            </button>
          </div>
        </ModalShell>
      )}
      {notQualifiedOpen && (
        <NotQualifiedModal leadId={lead.id} onClose={() => setNotQualifiedOpen(false)} />
      )}
    </section>
  );
}

function NotQualifiedModal({ leadId, onClose }: { leadId: string; onClose: () => void }) {
  const markNotQualified = useMarkNotQualified();
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");

  const inputCls =
    "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-brand-navy outline-none focus:border-brand-teal focus:ring-2 focus:ring-brand-teal/20";

  const onSubmit = () => {
    if (!reason) {
      toast.error("Choose a reason");
      return;
    }
    markNotQualified.mutate(
      { id: leadId, reason, notes: notes.trim() || null },
      {
        onSuccess: () => {
          toast.success("Lead marked not qualified");
          onClose();
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : "Could not update lead"),
      },
    );
  };

  return (
    <ModalShell onClose={onClose} label="Mark lead not qualified">
      <h3 className="text-lg font-semibold text-brand-navy">Mark not qualified</h3>
      <div>
        <label className="block text-sm font-medium text-brand-navy mb-1.5" htmlFor="nq-reason">
          Reason
        </label>
        <select id="nq-reason" className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)}>
          <option value="">Select a reason…</option>
          {NOT_QUALIFIED_REASONS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-sm font-medium text-brand-navy mb-1.5" htmlFor="nq-notes">
          Notes <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <textarea
          id="nq-notes"
          rows={3}
          className={inputCls}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>
      <div className="flex items-center justify-end gap-2 pt-1">
        <button type="button" className={btnNeutral} onClick={onClose}>
          Cancel
        </button>
        <button type="button" className={btnDanger} onClick={onSubmit} disabled={markNotQualified.isPending}>
          {markNotQualified.isPending ? "Saving…" : "Confirm not qualified"}
        </button>
      </div>
    </ModalShell>
  );
}

function ModalShell({
  onClose,
  label,
  children,
}: {
  onClose: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-md space-y-4 rounded-xl border border-border bg-white p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={label}
      >
        {children}
      </div>
    </div>
  );
}

function BackLink() {
  return (
    <Link to="/leads" className="inline-flex items-center gap-1.5 text-sm text-brand-teal hover:underline">
      <ArrowLeft className="h-4 w-4" /> Back to leads
    </Link>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-white p-5 shadow-sm">
      <h3 className="mb-3 text-sm font-semibold text-brand-navy">{title}</h3>
      <dl className="space-y-2 text-sm">{children}</dl>
    </section>
  );
}

function Info({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium text-brand-navy">{value || "—"}</dd>
    </div>
  );
}
