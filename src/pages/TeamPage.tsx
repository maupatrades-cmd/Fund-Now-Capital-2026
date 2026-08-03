import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Loader2,
  UserPlus,
  MoreVertical,
  Pencil,
  Send,
  Ban,
  Copy,
  Check,
  ShieldAlert,
  Eye,
  EyeOff,
  X,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import {
  useTeamMembers,
  useReferralPartnerOptions,
  useInviteUser,
  useUpdateUserRole,
  useDeactivateUser,
  type InviteResult,
} from "@/hooks/useTeam";
import {
  ASSIGNABLE_ROLES,
  roleLabel,
  roleBadgeClass,
  statusBadgeClass,
  formatJoined,
  type TeamFilter,
  type TeamMember,
  type UserRole,
} from "@/lib/team";
import ApplicationsPanel from "@/components/team/ApplicationsPanel";
import { useApplications } from "@/hooks/useApplications";

const fieldCls =
  "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-brand-navy outline-none focus:border-brand-teal focus:ring-2 focus:ring-brand-teal/20";
const labelCls = "block text-xs font-medium text-muted-foreground mb-1";
const errCls = "mt-1 text-xs text-red-600";
const btnPrimary =
  "inline-flex items-center gap-1.5 rounded-lg bg-brand-teal px-4 py-2 text-sm font-semibold text-white hover:bg-brand-teal/90 disabled:opacity-60";
const btnNeutral =
  "inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-brand-navy hover:bg-slate-50";

type AuditWarning = { msg: string; severe: boolean };

// Copy for the POPIA audit-fallback banner. `recorded` distinguishes "queued
// for backfill" (amber, informational) from the double-failure case where the
// fallback row ALSO failed and nothing is queued (red, escalate).
function auditWarn(what: string, recorded: boolean): AuditWarning {
  if (recorded) {
    return {
      msg: `${what} succeeded, but the audit-log entry could not be written. It has been flagged for backfill (audit_log_failures) — no action needed now, but let the admin know.`,
      severe: false,
    };
  }
  return {
    msg: `${what} succeeded, but the audit-log entry could not be written AND the backfill record also failed — nothing is queued. Please escalate to the admin now so the POPIA record can be recovered.`,
    severe: true,
  };
}

// "applications" is a sibling tab that swaps the whole body to the owner's
// contractor-application review view (Lane 2a) — it is not a filter over the
// people (profiles) list, so it lives alongside the role filters here.
type TeamTab = TeamFilter | "applications";

const FILTER_TABS: { value: TeamTab; label: string }[] = [
  { value: "all", label: "All" },
  { value: "owner", label: "Owners" },
  { value: "partner", label: "Partners" },
  { value: "contractor", label: "Contractors" },
  { value: "deactivated", label: "Deactivated" },
  { value: "applications", label: "Applications" },
];

export default function TeamPage() {
  const { data: members, isLoading, isError, refetch } = useTeamMembers();
  // Applications share the same cached query the panel uses (owner-only) — this
  // only powers the tab's count badge.
  const { data: applications } = useApplications();
  const [searchParams] = useSearchParams();
  // Deep-link support: the "New contractor application" notification links to
  // /team?tab=applications and should land on that tab.
  const [filter, setFilter] = useState<TeamTab>(
    searchParams.get("tab") === "applications" ? "applications" : "all",
  );
  const [inviteOpen, setInviteOpen] = useState(false);
  // Keep the deep-link honest even if the user is already on /team when the
  // "New contractor application" notification is clicked (fresh mount is handled
  // by the state initializer above; this fires only when the URL param changes).
  const tabParam = searchParams.get("tab");
  useEffect(() => {
    if (tabParam === "applications") setFilter("applications");
  }, [tabParam]);
  const [editing, setEditing] = useState<TeamMember | null>(null);
  const [deactivating, setDeactivating] = useState<TeamMember | null>(null);
  const [tempPassword, setTempPassword] = useState<{ name: string; password: string } | null>(null);
  // Shown when an action returned audit_logged:false (the POPIA row went to the
  // audit_log_failures fallback — or, when severe, couldn't be queued at all).
  const [auditWarning, setAuditWarning] = useState<AuditWarning | null>(null);

  const counts = useMemo(() => {
    const list = members ?? [];
    return {
      all: list.length,
      owner: list.filter((m) => m.is_active && m.role === "owner").length,
      partner: list.filter((m) => m.is_active && m.role === "partner").length,
      contractor: list.filter((m) => m.is_active && m.role === "contractor").length,
      deactivated: list.filter((m) => !m.is_active).length,
      applications: applications?.length ?? 0,
    };
  }, [members, applications]);

  const filtered = useMemo(() => {
    const list = members ?? [];
    if (filter === "all") return list;
    if (filter === "deactivated") return list.filter((m) => !m.is_active);
    return list.filter((m) => m.is_active && m.role === (filter as UserRole));
  }, [members, filter]);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading team…
      </div>
    );
  }

  // A load failure must not masquerade as an empty team ("No people yet").
  if (isError) {
    return (
      <div className="max-w-5xl">
        <div className="flex flex-col items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-6 py-14 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-red-100 text-red-600">
            <AlertTriangle className="h-7 w-7" strokeWidth={1.75} />
          </span>
          <div className="space-y-1">
            <p className="text-base font-semibold text-brand-navy">Couldn't load the team</p>
            <p className="mx-auto max-w-sm text-sm text-muted-foreground">
              Something went wrong fetching the list. Check your connection and try again.
            </p>
          </div>
          <button type="button" onClick={() => void refetch()} className={btnNeutral + " mt-1"}>
            <Loader2 className="h-4 w-4" /> Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-brand-navy">Team Management</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Invite and manage the people who use the CRM — referral partners and FNC contractors. Owner accounts are
            created outside the app and can't be changed here.
          </p>
        </div>
        <button type="button" onClick={() => setInviteOpen(true)} className={btnPrimary}>
          <UserPlus className="h-4 w-4" /> Invite New Person
        </button>
      </div>

      {auditWarning && (
        <div
          className={
            "flex items-start gap-2 rounded-lg border p-3 text-sm " +
            (auditWarning.severe
              ? "border-red-300 bg-red-50 text-red-800"
              : "border-amber-300 bg-amber-50 text-amber-800")
          }
        >
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="flex-1">{auditWarning.msg}</span>
          <button
            type="button"
            onClick={() => setAuditWarning(null)}
            className={
              "shrink-0 rounded p-0.5 " +
              (auditWarning.severe ? "text-red-700 hover:bg-red-100" : "text-amber-700 hover:bg-amber-100")
            }
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex flex-wrap gap-1 border-b border-border">
        {FILTER_TABS.map((t) => {
          const active = filter === t.value;
          return (
            <button
              key={t.value}
              type="button"
              onClick={() => setFilter(t.value)}
              className={
                "relative -mb-px px-3 py-2 text-sm font-medium transition-colors " +
                (active
                  ? "border-b-2 border-brand-teal text-brand-navy"
                  : "border-b-2 border-transparent text-muted-foreground hover:text-brand-navy")
              }
            >
              {t.label}
              <span className="ml-1.5 text-xs text-muted-foreground">{counts[t.value]}</span>
            </button>
          );
        })}
      </div>

      {filter === "applications" ? (
        <ApplicationsPanel />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={UserPlus}
          title="No people yet"
          description="Invite your first team member to get started."
        />
      ) : (
        <TeamTable
          members={filtered}
          onEdit={(m) => setEditing(m)}
          onDeactivate={(m) => setDeactivating(m)}
          onAuditWarning={setAuditWarning}
        />
      )}

      {inviteOpen && (
        <InviteDialog
          onClose={() => setInviteOpen(false)}
          onTempPassword={(name, password) => setTempPassword({ name, password })}
          onAuditWarning={setAuditWarning}
        />
      )}
      {editing && <EditRoleDialog member={editing} onClose={() => setEditing(null)} />}
      {deactivating && (
        <DeactivateDialog
          member={deactivating}
          onClose={() => setDeactivating(null)}
          onAuditWarning={setAuditWarning}
        />
      )}
      {tempPassword && (
        <TempPasswordModal
          name={tempPassword.name}
          password={tempPassword.password}
          onClose={() => setTempPassword(null)}
        />
      )}
    </div>
  );
}

// ---- table ------------------------------------------------------------------

function TeamTable({
  members,
  onEdit,
  onDeactivate,
  onAuditWarning,
}: {
  members: TeamMember[];
  onEdit: (m: TeamMember) => void;
  onDeactivate: (m: TeamMember) => void;
  onAuditWarning: (w: AuditWarning) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-white shadow-sm">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="px-4 py-3 font-medium">Name</th>
            <th className="px-4 py-3 font-medium">Email</th>
            <th className="px-4 py-3 font-medium">Phone</th>
            <th className="px-4 py-3 font-medium">Role</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium">Joined</th>
            <th className="px-4 py-3 font-medium text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.id} className="border-b border-border/60 last:border-0">
              <td className="px-4 py-3">
                <div className="font-medium text-brand-navy">{m.full_name || "—"}</div>
                {m.role === "partner" && m.referral_partner_name && (
                  <div className="text-xs text-muted-foreground">{m.referral_partner_name}</div>
                )}
              </td>
              <td className="px-4 py-3 text-brand-navy">{m.email || "—"}</td>
              <td className="px-4 py-3 text-muted-foreground">{m.phone_number || "—"}</td>
              <td className="px-4 py-3">
                <Badge className={roleBadgeClass(m.role)}>{roleLabel(m.role)}</Badge>
              </td>
              <td className="px-4 py-3">
                <Badge className={statusBadgeClass(m.is_active)}>{m.is_active ? "Active" : "Deactivated"}</Badge>
              </td>
              <td className="px-4 py-3 text-muted-foreground">{formatJoined(m.created_at)}</td>
              <td className="px-4 py-3 text-right">
                <RowActions
                  member={m}
                  onEdit={() => onEdit(m)}
                  onDeactivate={() => onDeactivate(m)}
                  onAuditWarning={onAuditWarning}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---- per-row actions menu ---------------------------------------------------

function RowActions({
  member,
  onEdit,
  onDeactivate,
  onAuditWarning,
}: {
  member: TeamMember;
  onEdit: () => void;
  onDeactivate: () => void;
  onAuditWarning: (w: AuditWarning) => void;
}) {
  const [open, setOpen] = useState(false);
  // Fixed-position anchor so the menu renders through a portal (document.body)
  // and is never clipped by the table's overflow-x-auto container, even on the
  // last rows.
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const invite = useInviteUser();

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    // Any scroll/resize would drift the fixed menu off the button — just close.
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  // The owner account and deactivated users have no actions.
  if (member.role === "owner" || !member.is_active) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }

  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) });
    setOpen(true);
  };

  const onResend = async () => {
    setOpen(false);
    try {
      const res = (await invite.mutateAsync({
        email: member.email ?? "",
        full_name: member.full_name ?? "",
        phone: member.phone_number ?? "",
        role: member.role as Exclude<UserRole, "owner">,
        invite_method: "magic_link",
      })) as InviteResult;
      if (res.email_sent === false) {
        toast.error(`Could not send the login email to ${member.email}. Please try again shortly.`);
      } else {
        toast.success(`Login link re-sent to ${member.email}`);
      }
      if (res.audit_logged === false) onAuditWarning(auditWarn("Resending the invite", res.audit_failure_recorded === true));
    } catch (e) {
      toast.error((e as Error).message || "Could not resend the invite.");
    }
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        className="rounded-lg p-1.5 text-muted-foreground hover:bg-slate-100 hover:text-brand-navy"
        aria-label="Row actions"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <MoreVertical className="h-4 w-4" />
      </button>
      {open &&
        pos &&
        createPortal(
          <>
            {/* click-outside catcher */}
            <button
              type="button"
              className="fixed inset-0 z-40 cursor-default"
              aria-hidden="true"
              tabIndex={-1}
              onClick={() => setOpen(false)}
            />
            <div
              role="menu"
              style={{ position: "fixed", top: pos.top, right: pos.right }}
              className="z-50 w-44 overflow-hidden rounded-lg border border-border bg-white py-1 text-left shadow-lg"
            >
              <MenuItem
                icon={Pencil}
                label="Edit role"
                onClick={() => {
                  setOpen(false);
                  onEdit();
                }}
              />
              <MenuItem icon={Send} label="Resend invite" disabled={invite.isPending} onClick={onResend} />
              <MenuItem
                icon={Ban}
                label="Deactivate"
                danger
                onClick={() => {
                  setOpen(false);
                  onDeactivate();
                }}
              />
            </div>
          </>,
          document.body,
        )}
    </>
  );
}

function MenuItem({
  icon: Icon,
  label,
  onClick,
  danger,
  disabled,
}: {
  icon: typeof Pencil;
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={
        "flex w-full items-center gap-2 px-3 py-2 text-sm disabled:opacity-50 " +
        (danger ? "text-red-700 hover:bg-red-50" : "text-brand-navy hover:bg-slate-50")
      }
    >
      <Icon className="h-4 w-4" /> {label}
    </button>
  );
}

// ---- invite dialog ----------------------------------------------------------

const inviteSchema = z
  .object({
    full_name: z.string().trim().min(1, "Full name is required."),
    email: z.string().trim().email("Enter a valid email address."),
    phone: z.string().trim().min(1, "Phone is required."),
    role: z.enum(["partner", "contractor"]),
    invite_method: z.enum(["magic_link", "temp_password"]),
    temp_password: z.string(),
  })
  .superRefine((v, ctx) => {
    if (v.invite_method === "temp_password" && v.temp_password.trim().length < 8) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["temp_password"],
        message: "Temporary password must be at least 8 characters.",
      });
    }
  });

type InviteFormValues = z.infer<typeof inviteSchema>;

function InviteDialog({
  onClose,
  onTempPassword,
  onAuditWarning,
}: {
  onClose: () => void;
  onTempPassword: (name: string, password: string) => void;
  onAuditWarning: (w: AuditWarning) => void;
}) {
  const invite = useInviteUser();
  const [serverErr, setServerErr] = useState<string | null>(null);
  const [showTemp, setShowTemp] = useState(false);
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<InviteFormValues>({
    resolver: zodResolver(inviteSchema),
    defaultValues: {
      full_name: "",
      email: "",
      phone: "",
      role: "partner",
      invite_method: "magic_link",
      temp_password: "",
    },
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const method = watch("invite_method");
  const role = watch("role");

  const onSubmit = async (v: InviteFormValues) => {
    setServerErr(null);
    try {
      const res = await invite.mutateAsync({
        email: v.email.trim(),
        full_name: v.full_name.trim(),
        phone: v.phone.trim(),
        role: v.role,
        invite_method: v.invite_method,
        temp_password: v.invite_method === "temp_password" ? v.temp_password.trim() : undefined,
      });

      if (res.status === "existing") {
        // magic_link existing = a resend fired, so honor delivery + audit
        // outcomes exactly like the created path (this is the retry-after-
        // failure landing spot). temp_password existing sends/writes nothing.
        if (res.invite_method === "magic_link") {
          if (res.email_sent === false) {
            const msg =
              `${v.email.trim()} is already a member, but the login email could not be sent. ` +
              `Click "Send Invite" again to retry, or use "Resend invite" from the table.`;
            setServerErr(msg);
            toast.warning(msg);
            if (res.audit_logged === false)
              onAuditWarning(auditWarn("Resending the invite", res.audit_failure_recorded === true));
            return; // keep the dialog open for a retry
          }
          toast.success(`Login link sent to ${v.email.trim()} (already a member)`);
          if (res.audit_logged === false)
            onAuditWarning(auditWarn("Resending the invite", res.audit_failure_recorded === true));
          onClose();
          return;
        }
        toast.info(res.message || `${v.email.trim()} is already a member.`);
        onClose();
        return;
      }

      // Account created but the magic-link email failed to send — keep the
      // dialog open so the owner can retry (a re-submit hits the idempotent
      // existing path and resends) instead of a false success.
      if (v.invite_method === "magic_link" && res.email_sent === false) {
        const msg =
          `${v.full_name.trim()}'s account was created, but the login email to ${v.email.trim()} could not be sent. ` +
          `Click "Send Invite" again to retry, or use "Resend invite" from the table.`;
        setServerErr(msg);
        toast.warning(msg);
        if (res.audit_logged === false) onAuditWarning(auditWarn("Creating the account", res.audit_failure_recorded === true));
        return;
      }

      toast.success(`${v.full_name.trim()} invited as ${roleLabel(v.role)}`);
      if (res.phone_saved === false) {
        toast.warning(
          `${v.full_name.trim()}'s account was created, but the phone number couldn't be saved. Edit the person to add it.`,
        );
      }
      if (res.audit_logged === false) onAuditWarning(auditWarn("Inviting the person", res.audit_failure_recorded === true));
      if (v.invite_method === "temp_password" && res.temp_password) {
        onClose();
        onTempPassword(v.full_name.trim(), res.temp_password);
      } else {
        onClose();
      }
    } catch (e) {
      const msg = (e as Error).message || "Could not send the invite.";
      setServerErr(msg);
      toast.error(msg);
    }
  };

  return (
    <DialogShell title="Invite New Person" onClose={onClose}>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div>
          <label className={labelCls} htmlFor="inv-name">Full name</label>
          <input id="inv-name" className={fieldCls} placeholder="e.g. Doctor Bright" {...register("full_name")} />
          {errors.full_name && <p className={errCls}>{errors.full_name.message}</p>}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={labelCls} htmlFor="inv-email">Email</label>
            <input id="inv-email" type="email" className={fieldCls} placeholder="name@example.com" {...register("email")} />
            {errors.email && <p className={errCls}>{errors.email.message}</p>}
          </div>
          <div>
            <label className={labelCls} htmlFor="inv-phone">Phone</label>
            <input id="inv-phone" className={fieldCls} placeholder="e.g. 082 123 4567" {...register("phone")} />
            {errors.phone && <p className={errCls}>{errors.phone.message}</p>}
          </div>
        </div>

        <div>
          <label className={labelCls} htmlFor="inv-role">Role</label>
          <select id="inv-role" className={fieldCls} {...register("role")}>
            {ASSIGNABLE_ROLES.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
          <p className="mt-1 text-xs text-muted-foreground">
            {role === "partner"
              ? "Referral partners refer leads and see only their own, with fictional funder names."
              : "Contractors are FNC's direct team, with their own portal."}
          </p>
        </div>

        <fieldset className="space-y-2">
          <legend className={labelCls}>How to send login access?</legend>
          <label className="flex items-start gap-2 rounded-lg border border-border p-2.5 text-sm cursor-pointer">
            <input type="radio" value="magic_link" className="mt-0.5 accent-brand-teal" {...register("invite_method")} />
            <span>
              <span className="font-medium text-brand-navy">Magic link</span>
              <span className="block text-xs text-muted-foreground">Emails a one-click, single-use login link.</span>
            </span>
          </label>
          <label className="flex items-start gap-2 rounded-lg border border-border p-2.5 text-sm cursor-pointer">
            <input type="radio" value="temp_password" className="mt-0.5 accent-brand-teal" {...register("invite_method")} />
            <span>
              <span className="font-medium text-brand-navy">Temporary password</span>
              <span className="block text-xs text-muted-foreground">
                You set a password and share it verbally — no email is sent.
              </span>
            </span>
          </label>
        </fieldset>

        {method === "temp_password" && (
          <div>
            <label className={labelCls} htmlFor="inv-temp">Temporary password</label>
            <div className="relative">
              <input
                id="inv-temp"
                type={showTemp ? "text" : "password"}
                className={fieldCls + " pr-10"}
                placeholder="At least 8 characters"
                autoComplete="new-password"
                {...register("temp_password")}
              />
              <button
                type="button"
                onClick={() => setShowTemp((s) => !s)}
                className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-brand-navy"
                aria-label={showTemp ? "Hide password" : "Show password"}
              >
                {showTemp ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {errors.temp_password && <p className={errCls}>{errors.temp_password.message}</p>}
            <p className="mt-1 text-xs text-muted-foreground">
              Hidden by default — use the eye to check it before sharing verbally.
            </p>
          </div>
        )}

        {serverErr && <p className={errCls}>{serverErr}</p>}

        <div className="flex items-center justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className={btnNeutral}>Cancel</button>
          <button type="submit" disabled={invite.isPending} className={btnPrimary}>
            {invite.isPending
              ? "Working…"
              : method === "temp_password"
                ? "Create with Password"
                : "Send Invite"}
          </button>
        </div>
      </form>
    </DialogShell>
  );
}

// ---- edit role dialog -------------------------------------------------------

function EditRoleDialog({ member, onClose }: { member: TeamMember; onClose: () => void }) {
  const update = useUpdateUserRole();
  const { data: partners } = useReferralPartnerOptions();
  const [newRole, setNewRole] = useState<Exclude<UserRole, "owner">>(
    member.role === "partner" || member.role === "contractor" ? member.role : "partner",
  );
  const [partnerId, setPartnerId] = useState<string>(member.referral_partner_id ?? "");
  const [serverErr, setServerErr] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const unchanged =
    newRole === member.role &&
    (newRole !== "partner" || (partnerId || null) === (member.referral_partner_id ?? null));

  const onConfirm = async () => {
    setServerErr(null);
    try {
      await update.mutateAsync({
        user_id: member.id,
        new_role: newRole,
        new_referral_partner_id: newRole === "partner" ? partnerId || null : null,
      });
      toast.success(`${member.full_name || member.email} is now a ${roleLabel(newRole)}`);
      onClose();
    } catch (e) {
      const msg = (e as Error).message || "Could not update the role.";
      setServerErr(msg);
      toast.error(msg);
    }
  };

  return (
    <DialogShell title="Edit role" onClose={onClose}>
      <div className="space-y-4">
        <div className="text-sm">
          <span className="text-muted-foreground">Current role: </span>
          <Badge className={roleBadgeClass(member.role)}>{roleLabel(member.role)}</Badge>
        </div>

        <div>
          <label className={labelCls} htmlFor="edit-role">New role</label>
          <select
            id="edit-role"
            className={fieldCls}
            value={newRole}
            onChange={(e) => setNewRole(e.target.value as Exclude<UserRole, "owner">)}
          >
            {ASSIGNABLE_ROLES.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </div>

        {newRole === "partner" && (
          <div>
            <label className={labelCls} htmlFor="edit-partner">Referral partner (optional)</label>
            <select id="edit-partner" className={fieldCls} value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
              <option value="">— None —</option>
              {(partners ?? []).map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        )}

        <p className="flex items-start gap-2 rounded-lg bg-amber-50 p-2.5 text-xs text-amber-800">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          Changing role will reset their referral partner link (unless they stay a partner) and requires the user to
          re-authenticate for the new access to take effect.
        </p>

        {serverErr && <p className={errCls}>{serverErr}</p>}

        <div className="flex items-center justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className={btnNeutral}>Cancel</button>
          <button type="button" onClick={onConfirm} disabled={update.isPending || unchanged} className={btnPrimary}>
            {update.isPending ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </DialogShell>
  );
}

// ---- deactivate dialog ------------------------------------------------------

function DeactivateDialog({
  member,
  onClose,
  onAuditWarning,
}: {
  member: TeamMember;
  onClose: () => void;
  onAuditWarning: (w: AuditWarning) => void;
}) {
  const deactivate = useDeactivateUser();
  const [confirmText, setConfirmText] = useState("");
  const [serverErr, setServerErr] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const onConfirm = async () => {
    setServerErr(null);
    try {
      const res = await deactivate.mutateAsync(member.id);
      toast.success(`${member.full_name || member.email} deactivated`);
      if (res.audit_logged === false) onAuditWarning(auditWarn("Deactivating the person", res.audit_failure_recorded === true));
      onClose();
    } catch (e) {
      const msg = (e as Error).message || "Could not deactivate the user.";
      setServerErr(msg);
      toast.error(msg);
    }
  };

  return (
    <DialogShell title="Deactivate person" onClose={onClose}>
      <div className="space-y-4">
        <p className="flex items-start gap-2 rounded-lg bg-red-50 p-2.5 text-sm text-red-800">
          <Ban className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <strong>{member.full_name || member.email}</strong> will no longer be able to log in, and any active session
            ends. Their history stays intact.
          </span>
        </p>
        <div>
          <label className={labelCls} htmlFor="deact-confirm">
            Type <span className="font-mono font-semibold text-brand-navy">DEACTIVATE</span> to confirm
          </label>
          <input
            id="deact-confirm"
            className={fieldCls}
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="DEACTIVATE"
            autoComplete="off"
          />
        </div>

        {serverErr && <p className={errCls}>{serverErr}</p>}

        <div className="flex items-center justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className={btnNeutral}>Cancel</button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={deactivate.isPending || confirmText.trim() !== "DEACTIVATE"}
            className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
          >
            {deactivate.isPending ? "Deactivating…" : "Deactivate"}
          </button>
        </div>
      </div>
    </DialogShell>
  );
}

// ---- temp password reveal ---------------------------------------------------

function TempPasswordModal({
  name,
  password,
  onClose,
}: {
  name: string;
  password: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy — select and copy the password manually.");
    }
  };

  return (
    <DialogShell title="Temporary password" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Share this password with <strong className="text-brand-navy">{name}</strong> verbally or through a secure
          channel — it is shown once and won't be retrievable later.
        </p>
        <div className="flex items-center gap-2">
          <code className="flex-1 select-all break-all rounded-lg border border-border bg-slate-50 px-3 py-2 font-mono text-sm text-brand-navy">
            {password}
          </code>
          <button type="button" onClick={copy} className={btnNeutral} aria-label="Copy password">
            {copied ? <Check className="h-4 w-4 text-brand-green" /> : <Copy className="h-4 w-4" />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <div className="flex justify-end">
          <button type="button" onClick={onClose} className={btnPrimary}>Done</button>
        </div>
      </div>
    </DialogShell>
  );
}

// ---- shared dialog shell ----------------------------------------------------

function DialogShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-xl border border-border bg-white p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <h3 className="text-base font-semibold text-brand-navy">{title}</h3>
        {children}
      </div>
    </div>
  );
}
