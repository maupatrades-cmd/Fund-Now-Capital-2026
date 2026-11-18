import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Field, card, errorText, primaryButton } from "@/components/staff/StaffShell";
import { useStaffRole } from "@/hooks/useStaffDesk";
import { useInviteUser } from "@/hooks/useTeam";

// The Field Supervisor adds field agents (field consultants) here. The same rules as the
// Director's Team page invite; the admin-invite-user Edge Function decides the caller's role
// server-side and refuses any role other than field_consultant for the Field Supervisor.
const schema = z
  .object({
    // At least 2 characters, matching the Team page invite.
    full_name: z.string().trim().min(2, "Enter the full name (at least 2 characters)."),
    email: z.string().trim().email("Enter a valid email address."),
    phone: z.string().trim().min(1, "Cell number is required."),
    invite_method: z.enum(["magic_link", "temp_password"]),
    temp_password: z.string(),
  })
  .superRefine((v, ctx) => {
    if (v.invite_method !== "temp_password") return;
    const p = v.temp_password.trim();
    if (p.length < 12 || !/[a-z]/.test(p) || !/[A-Z]/.test(p) || !/\d/.test(p) || !/[^A-Za-z0-9]/.test(p)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["temp_password"], message: "Use at least 12 characters with uppercase, lowercase, a number and a symbol." });
    }
  });
type Values = z.infer<typeof schema>;

export default function StaffAddFieldAgentPage() {
  const { data: role, isLoading } = useStaffRole();
  const invite = useInviteUser();
  const [done, setDone] = useState<{ name: string; tempPassword: string | null; existing: boolean; emailSent: boolean | undefined } | null>(null);
  const { register, handleSubmit, watch, reset, formState: { errors } } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { full_name: "", email: "", phone: "", invite_method: "magic_link", temp_password: "" },
  });
  const method = watch("invite_method");

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (role !== "field_supervisor") {
    return <div className={card}><p className="text-sm text-muted-foreground">Only the Field Supervisor adds field agents here. The Director adds everyone else on the Team page.</p></div>;
  }

  const onSubmit = async (v: Values) => {
    try {
      const res = await invite.mutateAsync({
        email: v.email.trim(),
        full_name: v.full_name.trim(),
        phone: v.phone.trim(),
        role: "field_consultant",
        invite_method: v.invite_method,
        temp_password: v.invite_method === "temp_password" ? v.temp_password.trim() : undefined,
      });
      setDone({ name: v.full_name.trim(), tempPassword: res.temp_password ?? null, existing: res.status === "existing", emailSent: res.email_sent });
      if (res.phone_saved === false) toast.warning("The account was made, but the cell number could not be saved. Ask the Director to add it.");
      toast.success(res.status === "existing" ? `${v.full_name.trim()} already has an account.` : `${v.full_name.trim()} added as a field agent.`);
      reset();
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-brand-navy">Add field agent</h1>
        <p className="text-sm text-muted-foreground">
          Add a new field consultant to your team. They get a sign-in link or a temporary password. They can only start working once the Director switches on their staff access.
        </p>
      </div>

      {done && (
        <div className={card} role="status">
          <p className="font-semibold text-brand-navy">{done.existing ? `${done.name} already has a field agent account.` : `${done.name} has been added.`}</p>
          {done.tempPassword && (
            <p className="mt-2 text-sm">
              Temporary password (shown once — give it to them privately): <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono">{done.tempPassword}</code>
            </p>
          )}
          {done.emailSent === false && <p className="mt-2 text-sm text-amber-700">The email could not be sent. Ask the Director to resend it from the Team page.</p>}
          <p className="mt-2 text-sm text-muted-foreground">The Director and the Administrators have been told. Their staff access stays off until the Director switches it on.</p>
        </div>
      )}

      <form className={`${card} space-y-4`} onSubmit={handleSubmit(onSubmit)} noValidate>
        <Field label="Full name">
          <Input aria-label="Full name" {...register("full_name")} />
          {errors.full_name && <p className="text-xs text-red-600">{errors.full_name.message}</p>}
        </Field>
        <Field label="Email">
          <Input type="email" aria-label="Email" {...register("email")} />
          {errors.email && <p className="text-xs text-red-600">{errors.email.message}</p>}
        </Field>
        <Field label="Cell number">
          <Input aria-label="Cell number" placeholder="e.g. 082 123 4567" {...register("phone")} />
          {errors.phone && <p className="text-xs text-red-600">{errors.phone.message}</p>}
        </Field>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">How they sign in</legend>
          <label className="flex items-start gap-2 text-sm">
            <input type="radio" value="magic_link" className="mt-0.5 accent-brand-teal" {...register("invite_method")} />
            Email them a sign-in link
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="radio" value="temp_password" className="mt-0.5 accent-brand-teal" {...register("invite_method")} />
            Set a temporary password
          </label>
        </fieldset>
        {method === "temp_password" && (
          <Field label="Temporary password" hint="At least 12 characters with uppercase, lowercase, a number and a symbol.">
            <Input type="text" autoComplete="new-password" aria-label="Temporary password" {...register("temp_password")} />
            {errors.temp_password && <p className="text-xs text-red-600">{errors.temp_password.message}</p>}
          </Field>
        )}
        <button type="submit" className={primaryButton} disabled={invite.isPending}>
          {invite.isPending ? "Adding…" : "Add field agent"}
        </button>
      </form>
    </div>
  );
}
