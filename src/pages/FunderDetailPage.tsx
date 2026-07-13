import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Pencil,
  Check,
  X,
  Trash2,
  Plus,
  Mail,
  Phone,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import {
  useFunder,
  useFunderContacts,
  useUpdateFunder,
  useAddFunderContact,
  useDeleteFunderContact,
} from "@/hooks/useFunders";
import {
  agreementMeta,
  funderTypeLabel,
  formatTicketRange,
  COMMISSION_STRUCTURE,
  pct,
} from "@/lib/funders";

export default function FunderDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: funder, isLoading, isError, error } = useFunder(id);

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading funder…</div>;
  if (isError || !funder) {
    return (
      <div className="space-y-3">
        <BackLink />
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Couldn't load funder: {(error as Error)?.message ?? "not found"}
        </div>
      </div>
    );
  }

  const meta = agreementMeta(funder.agreement_status);

  return (
    <div className="max-w-4xl space-y-5">
      <BackLink />

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-border bg-white p-6 shadow-sm">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-brand-navy">{funder.name}</h1>
            <Badge className={meta.badgeClass}>{meta.label}</Badge>
            {!funder.is_active && (
              <Badge className="bg-slate-100 text-slate-500 ring-slate-400/20">Inactive</Badge>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {funderTypeLabel(funder.funder_type)} · Ticket{" "}
            {formatTicketRange(funder.ticket_min, funder.ticket_max)}
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate(`/funders/${funder.id}/edit`)}
          className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-brand-navy hover:bg-slate-50"
        >
          <Pencil className="h-4 w-4" /> Edit
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Partner display name (inline editable) */}
        <PartnerDisplayNameCard
          funderId={funder.id}
          value={funder.display_name_for_partner}
        />

        {/* Commission structure (reference) */}
        <Card title="Commission structure">
          <div className="space-y-1.5 text-sm">
            <Row label="Company retention" value={pct(COMMISSION_STRUCTURE.companyRetention)} />
            <Row label="Partner pool" value={pct(COMMISSION_STRUCTURE.partnerPool)} />
          </div>
          <div className="mt-3 border-t border-border pt-3">
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Partner share of pool (by tier)
            </p>
            <div className="space-y-1.5 text-sm">
              {COMMISSION_STRUCTURE.tiers.map((t) => (
                <Row key={t.label} label={t.label} value={pct(t.pct)} />
              ))}
            </div>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            The split is standard across funders; applied server-side on every funded deal.
          </p>
        </Card>

        {/* Contacts */}
        <ContactsCard funderId={funder.id} />

        {/* Notes */}
        <Card title="Notes">
          {funder.notes ? (
            <p className="whitespace-pre-wrap text-sm text-brand-navy">{funder.notes}</p>
          ) : (
            <p className="text-sm text-muted-foreground">No notes yet.</p>
          )}
        </Card>
      </div>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      to="/funders"
      className="inline-flex items-center gap-1.5 text-sm text-brand-teal hover:underline"
    >
      <ArrowLeft className="h-4 w-4" /> Back to funders
    </Link>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-white p-5 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold text-brand-navy">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-brand-navy">{value}</span>
    </div>
  );
}

function PartnerDisplayNameCard({
  funderId,
  value,
}: {
  funderId: string;
  value: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const update = useUpdateFunder();

  const save = async () => {
    const next = draft.trim();
    if (!next) {
      toast.error("Display name can't be empty");
      return;
    }
    try {
      await update.mutateAsync({ id: funderId, input: { display_name_for_partner: next } });
      toast.success("Partner display name updated");
      setEditing(false);
    } catch (e) {
      toast.error((e as Error).message || "Could not update");
    }
  };

  return (
    <Card title="Partner display name">
      <p className="mb-2 text-xs text-muted-foreground">
        The fictional name partners see instead of the real funder name.
      </p>
      {editing ? (
        <div className="flex items-center gap-2">
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="flex-1 rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-brand-teal focus:ring-2 focus:ring-brand-teal/20"
          />
          <button
            type="button"
            onClick={save}
            disabled={update.isPending}
            className="grid h-9 w-9 place-items-center rounded-lg bg-brand-green text-white hover:opacity-90 disabled:opacity-60"
            aria-label="Save"
          >
            <Check className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => {
              setDraft(value);
              setEditing(false);
            }}
            className="grid h-9 w-9 place-items-center rounded-lg border border-border text-brand-navy hover:bg-slate-50"
            aria-label="Cancel"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <span className="text-lg font-semibold text-brand-teal">{value}</span>
          <button
            type="button"
            onClick={() => {
              setDraft(value);
              setEditing(true);
            }}
            className="flex items-center gap-1.5 text-sm text-brand-teal hover:underline"
          >
            <Pencil className="h-3.5 w-3.5" /> Edit
          </button>
        </div>
      )}
    </Card>
  );
}

function ContactsCard({ funderId }: { funderId: string }) {
  const { data: contacts, isLoading } = useFunderContacts(funderId);
  const addContact = useAddFunderContact();
  const deleteContact = useDeleteFunderContact();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ full_name: "", position: "", email: "", phone: "" });

  const submit = async () => {
    if (!form.full_name.trim()) {
      toast.error("Contact name is required");
      return;
    }
    try {
      await addContact.mutateAsync({
        funder_id: funderId,
        full_name: form.full_name.trim(),
        position: form.position.trim() || null,
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
      });
      setForm({ full_name: "", position: "", email: "", phone: "" });
      setAdding(false);
    } catch (e) {
      toast.error((e as Error).message || "Could not add contact");
    }
  };

  const fieldCls =
    "w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-brand-teal focus:ring-2 focus:ring-brand-teal/20";

  return (
    <Card title="Contacts">
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : contacts && contacts.length > 0 ? (
        <ul className="space-y-2">
          {contacts.map((c) => (
            <li
              key={c.id}
              className="flex items-start justify-between gap-3 rounded-lg border border-border p-3"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium text-brand-navy">
                  {c.full_name}
                  {c.position && (
                    <span className="font-normal text-muted-foreground"> · {c.position}</span>
                  )}
                </div>
                <div className="mt-0.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                  {c.email && (
                    <span className="inline-flex items-center gap-1">
                      <Mail className="h-3 w-3" /> {c.email}
                    </span>
                  )}
                  {c.phone && (
                    <span className="inline-flex items-center gap-1">
                      <Phone className="h-3 w-3" /> {c.phone}
                    </span>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => deleteContact.mutate({ id: c.id, funderId })}
                className="text-muted-foreground hover:text-red-600"
                aria-label={`Delete ${c.full_name}`}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No contacts yet.</p>
      )}

      {adding ? (
        <div className="mt-3 space-y-2 border-t border-border pt-3">
          <input
            className={fieldCls}
            placeholder="Full name *"
            value={form.full_name}
            onChange={(e) => setForm({ ...form, full_name: e.target.value })}
          />
          <input
            className={fieldCls}
            placeholder="Position"
            value={form.position}
            onChange={(e) => setForm({ ...form, position: e.target.value })}
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input
              className={fieldCls}
              placeholder="Email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
            <input
              className={fieldCls}
              placeholder="Phone"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={submit}
              disabled={addContact.isPending}
              className="rounded-lg bg-brand-teal px-4 py-2 text-sm font-semibold text-white hover:bg-brand-teal/90 disabled:opacity-60"
            >
              {addContact.isPending ? "Adding…" : "Add contact"}
            </button>
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="rounded-lg border border-border px-4 py-2 text-sm text-brand-navy hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-brand-teal hover:underline"
        >
          <Plus className="h-4 w-4" /> Add contact
        </button>
      )}
    </Card>
  );
}
