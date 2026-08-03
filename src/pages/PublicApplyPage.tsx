import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { CheckCircle2, Loader2 } from "lucide-react";
import { useSubmitApplication } from "@/hooks/useApplications";
import { REFERRAL_SOURCES, type PublicApplicationInput } from "@/lib/applications";

/*
 * PUBLIC, unauthenticated contractor application form (ONBOARDING.md Stage 1).
 * Lives at /apply with NO gate. Mirrors LEAD-SUBMIT's react-hook-form + zod
 * shape (incl. the synchronous useRef in-flight guard, FIX #4) and posts to the
 * apply-submit-application Edge Function via useSubmitApplication. Mobile-first —
 * applicants often apply from a phone.
 */

const schema = z
  .object({
    full_name: z.string().trim().min(1, "Your full name is required"),
    email: z
      .string()
      .trim()
      .min(1, "Email is required")
      .refine((v) => z.string().email().safeParse(v).success, "Enter a valid email"),
    phone: z.string().trim().min(1, "Phone is required"),
    id_number: z.string().optional().default(""),
    physical_address: z.string().trim().min(1, "Your physical address is required"),
    experience_years: z
      .string()
      .trim()
      .min(1, "Years of experience is required")
      .refine((v) => /^\d{1,3}$/.test(v), "Enter a whole number of years")
      .refine((v) => Number(v) >= 0 && Number(v) <= 80, "Enter a realistic number of years (0–80)"),
    motivation_text: z.string().trim().min(50, "Please write at least 50 characters"),
    referral_source: z.string().trim().min(1, "Please tell us how you heard about us"),
    referral_source_other: z.string().optional().default(""),
  })
  .superRefine((v, ctx) => {
    if (v.referral_source === "other" && !v.referral_source_other.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["referral_source_other"],
        message: "Please tell us where",
      });
    }
  });

type FormValues = z.input<typeof schema>;

const inputCls =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-brand-navy outline-none focus:border-brand-teal focus:ring-2 focus:ring-brand-teal/20";
const labelCls = "block text-sm font-medium text-brand-navy mb-1.5";
const errCls = "mt-1 text-xs text-red-600";

export default function PublicApplyPage() {
  const submit = useSubmitApplication();
  const [done, setDone] = useState<{ emailSent: boolean } | null>(null);
  const [serverErr, setServerErr] = useState<string | null>(null);
  const submittingRef = useRef(false);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { referral_source: "" },
  });

  const referral = watch("referral_source");

  const onSubmit = async (v: FormValues) => {
    if (submittingRef.current) return; // ignore a fast double-click already in flight
    submittingRef.current = true;
    setServerErr(null);
    const input: PublicApplicationInput = {
      full_name: v.full_name!.trim(),
      email: v.email!.trim(),
      phone: v.phone!.trim(),
      id_number: v.id_number?.trim() || null,
      physical_address: v.physical_address!.trim(),
      experience_years: Number(v.experience_years),
      motivation_text: v.motivation_text!.trim(),
      referral_source: v.referral_source || null,
      referral_source_other: v.referral_source === "other" ? v.referral_source_other?.trim() || null : null,
    };
    try {
      const res = await submit.mutateAsync(input);
      setDone({ emailSent: res.email_sent === true });
    } catch (e) {
      setServerErr((e as Error).message || "Could not submit your application. Please try again.");
    } finally {
      submittingRef.current = false;
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Brand header */}
      <header className="bg-brand-navy">
        <div className="mx-auto flex max-w-3xl items-center px-4 py-4 sm:px-6">
          <div>
            <div className="text-lg font-bold text-white">
              Fund Now <span className="text-brand-teal">Capital</span>
            </div>
            <div className="text-xs text-white/60">Many funders. More approvals.</div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
        {done ? (
          <SuccessCard emailSent={done.emailSent} />
        ) : (
          <>
            <div className="space-y-2">
              <h1 className="text-2xl font-bold text-brand-navy sm:text-3xl">
                Apply to be a Fund Now Capital Contractor
              </h1>
              <p className="text-sm leading-relaxed text-slate-600">
                Fund Now Capital contractors help South African businesses access funding — sourcing leads,
                guiding owners through the process, and earning commission on funded deals. If you have a
                background in sales, broking, or finance and a heart for helping SMEs grow, we'd love to hear
                from you.
              </p>
              <p className="text-sm leading-relaxed text-slate-600">
                Fill in the short form below. We review every application and will be in touch within{" "}
                <strong>5 business days</strong> about the next step.
              </p>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-6">
              {/* About you */}
              <fieldset className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
                <legend className="px-1 text-sm font-semibold text-brand-navy">About you</legend>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <label className={labelCls} htmlFor="full_name">Full name</label>
                    <input id="full_name" className={inputCls} autoComplete="name" {...register("full_name")} />
                    {errors.full_name && <p className={errCls}>{errors.full_name.message}</p>}
                  </div>
                  <div>
                    <label className={labelCls} htmlFor="email">Email</label>
                    <input id="email" type="email" className={inputCls} autoComplete="email" placeholder="you@example.com" {...register("email")} />
                    {errors.email && <p className={errCls}>{errors.email.message}</p>}
                  </div>
                  <div>
                    <label className={labelCls} htmlFor="phone">Phone</label>
                    <input id="phone" className={inputCls} autoComplete="tel" placeholder="082 123 4567" {...register("phone")} />
                    {errors.phone && <p className={errCls}>{errors.phone.message}</p>}
                  </div>
                  <div>
                    <label className={labelCls} htmlFor="id_number">SA ID number <span className="font-normal text-slate-400">(optional)</span></label>
                    <input id="id_number" className={inputCls} inputMode="numeric" {...register("id_number")} />
                    {errors.id_number && <p className={errCls}>{errors.id_number.message}</p>}
                  </div>
                  <div>
                    <label className={labelCls} htmlFor="experience_years">Years of relevant experience</label>
                    <input id="experience_years" type="number" min="0" max="80" className={inputCls} {...register("experience_years")} />
                    {errors.experience_years && <p className={errCls}>{errors.experience_years.message}</p>}
                  </div>
                  <div className="sm:col-span-2">
                    <label className={labelCls} htmlFor="physical_address">Physical address</label>
                    <textarea id="physical_address" rows={2} className={inputCls} autoComplete="street-address" {...register("physical_address")} />
                    {errors.physical_address && <p className={errCls}>{errors.physical_address.message}</p>}
                  </div>
                </div>
              </fieldset>

              {/* Motivation + referral */}
              <fieldset className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
                <legend className="px-1 text-sm font-semibold text-brand-navy">Tell us more</legend>
                <div>
                  <label className={labelCls} htmlFor="motivation_text">Why do you want to join Fund Now Capital?</label>
                  <textarea
                    id="motivation_text"
                    rows={5}
                    className={inputCls}
                    placeholder="Tell us about your experience and why you'd be a great fit…"
                    {...register("motivation_text")}
                  />
                  {errors.motivation_text && <p className={errCls}>{errors.motivation_text.message}</p>}
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className={labelCls} htmlFor="referral_source">How did you hear about us?</label>
                    <select id="referral_source" className={inputCls} defaultValue="" {...register("referral_source")}>
                      <option value="" disabled>Select one…</option>
                      {REFERRAL_SOURCES.map((r) => (
                        <option key={r.value} value={r.value}>{r.label}</option>
                      ))}
                    </select>
                    {errors.referral_source && <p className={errCls}>{errors.referral_source.message}</p>}
                  </div>
                  {referral === "other" && (
                    <div>
                      <label className={labelCls} htmlFor="referral_source_other">Where exactly?</label>
                      <input id="referral_source_other" className={inputCls} {...register("referral_source_other")} />
                      {errors.referral_source_other && <p className={errCls}>{errors.referral_source_other.message}</p>}
                    </div>
                  )}
                </div>
              </fieldset>

              {serverErr && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {serverErr}
                </div>
              )}

              <div className="flex items-center gap-3">
                <button
                  type="submit"
                  disabled={submit.isPending}
                  className="inline-flex items-center gap-2 rounded-lg bg-brand-teal px-6 py-2.5 text-sm font-semibold text-white hover:bg-brand-teal/90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submit.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  {submit.isPending ? "Submitting…" : "Submit application"}
                </button>
              </div>
              <p className="text-xs text-slate-400">
                By submitting, you consent to Fund Now Capital storing the details above to assess your
                application (POPIA).
              </p>
            </form>
          </>
        )}
      </main>
    </div>
  );
}

function SuccessCard({ emailSent }: { emailSent: boolean }) {
  return (
    <div className="mx-auto max-w-xl rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
      <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-brand-green/10 text-brand-green">
        <CheckCircle2 className="h-9 w-9" strokeWidth={1.75} />
      </span>
      <h2 className="mt-5 text-xl font-bold text-brand-navy">Thank you!</h2>
      <p className="mt-2 text-sm leading-relaxed text-slate-600">
        We've received your application and our team will be in touch within{" "}
        <strong>5 business days</strong>.
      </p>
      {emailSent && (
        <p className="mt-2 text-sm text-slate-500">
          A confirmation email is on its way to your inbox.
        </p>
      )}
      <p className="mt-6 text-xs text-slate-400">You can safely close this page.</p>
    </div>
  );
}
