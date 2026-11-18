import { useState } from "react";
import { Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Field, card, errorText, primaryButton, selectClass } from "@/components/staff/StaffShell";
import { useInviteUser } from "@/hooks/useTeam";
import { supabase } from "@/lib/supabase";

// Add an agent from the Onboarding page (owner, 18 Nov 2026): the Office Administrator (and the Director) create the
// agent's account so their file and onboarding checklist exist. The admin-invite-user Edge Function decides the
// caller's role server-side: the Administrator may add only Team Leaders, Direct agents and Sub-agents, and only by an
// emailed sign-in link (no temporary passwords handed out by staff).
const TYPES = [
  { value: "contractor", label: "Direct agent" },
  { value: "partner", label: "Team Leader" },
  { value: "sub_agent", label: "Sub-agent (under a Team Leader)" },
] as const;

const schema = z
  .object({
    full_name: z.string().trim().min(2, "Enter the full name (at least 2 characters)."),
    email: z.string().trim().email("Enter a valid email address."),
    phone: z.string().trim().min(1, "Cell number is required."),
    role: z.enum(["contractor", "partner", "sub_agent"]),
    parent_partner_id: z.string(),
  })
  .superRefine((v, ctx) => {
    if (v.role === "sub_agent" && !v.parent_partner_id) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["parent_partner_id"], message: "Choose the Team Leader this sub-agent works under." });
    }
  });
type Values = z.infer<typeof schema>;

// Active Team Leaders (id + name only). referral_partners is owner-only under RLS, so this goes through an RPC that
// the Director and the Office Administrator may call.
function useTeamLeaderOptions(enabled: boolean) {
  return useQuery({
    queryKey: ["staff-team-leader-options"],
    enabled,
    queryFn: async (): Promise<{ id: string; name: string }[]> => {
      const { data, error } = await supabase.rpc("staff_team_leader_options");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
  });
}

export function AddAgentForm({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const invite = useInviteUser();
  const [added, setAdded] = useState<{ id: string; name: string; existing: boolean; emailSent: boolean | undefined } | null>(null);
  const { register, handleSubmit, watch, reset, formState: { errors } } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { full_name: "", email: "", phone: "", role: "contractor", parent_partner_id: "" },
  });
  const type = watch("role");
  const leaders = useTeamLeaderOptions(type === "sub_agent");

  const onSubmit = async (v: Values) => {
    try {
      const res = await invite.mutateAsync({
        email: v.email.trim(),
        full_name: v.full_name.trim(),
        phone: v.phone.trim(),
        role: v.role,
        parent_partner_id: v.role === "sub_agent" ? v.parent_partner_id : null,
        invite_method: "magic_link",
      });
      setAdded({ id: res.user_id, name: v.full_name.trim(), existing: res.status === "existing", emailSent: res.email_sent });
      if (res.phone_saved === false) toast.warning("The account was made, but the cell number could not be saved. Ask the Director to add it.");
      toast.success(res.status === "existing" ? `${v.full_name.trim()} already has an account — sign-in link sent again.` : "Agent added — welcome email sent");
      qc.invalidateQueries({ queryKey: ["agent-onboarding"] });
      reset();
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  return (
    <section className={`${card} space-y-4`} aria-label="Add agent">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-brand-navy">Add agent</h2>
          <p className="text-sm text-muted-foreground">
            Creates the agent's account, their agent file and their onboarding checklist. They get a welcome email with a link to choose their password.
          </p>
        </div>
        <button type="button" onClick={onClose} className="text-sm font-semibold text-brand-navy hover:underline">Close</button>
      </div>

      {added ? (
        <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm">
          <p className="font-semibold text-brand-navy">{added.existing ? `${added.name} already had an account.` : `${added.name} has been added.`}</p>
          {added.emailSent === false ? <p className="mt-1 text-amber-700">The email could not be sent. Ask the Director to resend it from the Team page.</p> : null}
          <Link to={`/staff/agents/${added.id}`} className="mt-2 inline-block font-semibold text-brand-teal hover:underline">Open agent file</Link>
        </div>
      ) : null}

      <form className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
        <Field label="Type of agent">
          <select className={selectClass} aria-label="Type of agent" {...register("role")}>
            {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </Field>
        {type === "sub_agent" ? (
          <Field label="Team Leader">
            <select className={selectClass} aria-label="Team Leader" {...register("parent_partner_id")}>
              <option value="">Choose…</option>
              {(leaders.data ?? []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
            {leaders.error ? <p className="text-xs text-red-600">{errorText(leaders.error)}</p> : null}
            {leaders.data && leaders.data.length === 0 ? <p className="text-xs text-muted-foreground">No active Team Leaders yet.</p> : null}
            {errors.parent_partner_id ? <p className="text-xs text-red-600">{errors.parent_partner_id.message}</p> : null}
          </Field>
        ) : null}
        <Field label="Full name">
          <Input aria-label="Full name" {...register("full_name")} />
          {errors.full_name ? <p className="text-xs text-red-600">{errors.full_name.message}</p> : null}
        </Field>
        <Field label="Email">
          <Input type="email" aria-label="Email" {...register("email")} />
          {errors.email ? <p className="text-xs text-red-600">{errors.email.message}</p> : null}
        </Field>
        <Field label="Cell number">
          <Input aria-label="Cell number" placeholder="e.g. 082 123 4567" {...register("phone")} />
          {errors.phone ? <p className="text-xs text-red-600">{errors.phone.message}</p> : null}
        </Field>
        <button type="submit" className={primaryButton} disabled={invite.isPending}>
          {invite.isPending ? "Adding…" : "Add agent"}
        </button>
      </form>
    </section>
  );
}
