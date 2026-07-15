import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Pencil } from "lucide-react";
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
  labelFor,
} from "@/lib/leads";
import { useLead, one } from "@/hooks/useLeads";

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
          <Info label="Follow-up date" value={lead.follow_up_date} />
          <Info label="Initial notes" value={lead.initial_notes} />
        </Section>
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
