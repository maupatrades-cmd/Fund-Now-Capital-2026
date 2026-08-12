import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, LockKeyhole, Save, UserRound } from "lucide-react";
import { toast } from "sonner";
import ClientPortalShell from "@/components/client-portal/ClientPortalShell";
import { supabase } from "@/lib/supabase";

type Workspace = {
  client_id: string; business_name: string; cipc_number: string | null; sector: string | null; address: string | null;
  contact: { full_name?: string; email?: string; phone?: string; position?: string };
};
type FormState = { businessName: string; sector: string; address: string; contactName: string; contactPhone: string; contactEmail: string; contactPosition: string };
const empty: FormState = { businessName: "", sector: "", address: "", contactName: "", contactPhone: "", contactEmail: "", contactPosition: "" };
const inputClass = "mt-2 min-h-12 w-full rounded-2xl border border-white/10 bg-white/[0.055] px-4 text-sm text-white outline-none transition placeholder:text-white/25 focus:border-[#6ec144]/70 focus:ring-4 focus:ring-[#6ec144]/10";

export default function ClientProfilePage() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(empty);
  const workspace = useQuery({
    queryKey: ["client-profile-workspace"],
    queryFn: async (): Promise<Workspace> => {
      const { data, error } = await supabase.rpc("client_portal_profile_workspace");
      if (error) throw error;
      return data as Workspace;
    },
  });
  useEffect(() => {
    if (!workspace.data) return;
    setForm({ businessName: workspace.data.business_name ?? "", sector: workspace.data.sector ?? "", address: workspace.data.address ?? "",
      contactName: workspace.data.contact?.full_name ?? "", contactPhone: workspace.data.contact?.phone ?? "",
      contactEmail: workspace.data.contact?.email ?? "", contactPosition: workspace.data.contact?.position ?? "" });
  }, [workspace.data]);
  const save = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("update_client_portal_profile", {
        p_business_name: form.businessName, p_sector: form.sector, p_address: form.address, p_contact_name: form.contactName,
        p_contact_phone: form.contactPhone, p_contact_email: form.contactEmail, p_contact_position: form.contactPosition,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: async () => { toast.success("Profile updated and recorded in your activity history."); await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["client-profile-workspace"] }), queryClient.invalidateQueries({ queryKey: ["client-portal-identity"] })]); },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Profile could not be updated."),
  });
  const set = (key: keyof FormState, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const Field = ({ label, field, type = "text" }: { label: string; field: keyof FormState; type?: string }) => <label className="block text-sm font-semibold text-white/75">{label}<input className={inputClass} type={type} value={form[field]} onChange={(event) => set(field, event.target.value)} /></label>;

  return <ClientPortalShell><div className="mx-auto max-w-5xl space-y-6">
    <header><p className="text-[10px] font-extrabold uppercase tracking-[0.22em] text-[#86d4cf]">Secure profile</p><h1 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">Business and contact details</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-white/50">Keep the contact information used by Fund Now Capital accurate. Sensitive authority and funding controls remain Owner-managed.</p></header>
    {workspace.isLoading ? <p className="client-glass rounded-3xl p-8 text-sm text-white/50">Loading your profile...</p> : null}
    {workspace.error ? <p className="rounded-2xl border border-red-300/20 bg-red-400/10 p-4 text-sm text-red-100">We could not load your linked client profile.</p> : null}
    {workspace.data ? <form className="space-y-6" onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
      <section className="client-glass rounded-[28px] p-5 sm:p-8"><div className="flex items-center gap-3"><Building2 className="h-5 w-5 text-[#9ee67d]"/><h2 className="text-xl font-extrabold">Business details</h2></div><div className="mt-6 grid gap-5 sm:grid-cols-2"><Field label="Business name" field="businessName"/><Field label="Industry or sector" field="sector"/><div className="sm:col-span-2"><Field label="Business address" field="address"/></div><label className="block text-sm font-semibold text-white/45">CIPC registration number<input className={`${inputClass} cursor-not-allowed opacity-55`} value={workspace.data.cipc_number ?? "Not recorded"} disabled /></label></div></section>
      <section className="client-glass rounded-[28px] p-5 sm:p-8"><div className="flex items-center gap-3"><UserRound className="h-5 w-5 text-[#7fd4e8]"/><h2 className="text-xl font-extrabold">Primary contact</h2></div><div className="mt-6 grid gap-5 sm:grid-cols-2"><Field label="Full name" field="contactName"/><Field label="Position" field="contactPosition"/><Field label="Mobile number" field="contactPhone" type="tel"/><Field label="Email address" field="contactEmail" type="email"/></div></section>
      <div className="flex flex-col gap-4 rounded-3xl border border-white/10 bg-white/[0.035] p-5 sm:flex-row sm:items-center"><LockKeyhole className="h-5 w-5 shrink-0 text-[#86d4cf]"/><p className="text-xs leading-5 text-white/50">Registration identity, roles, referral attribution, applications, banking and financial values cannot be changed here. Contact Fund Now Capital for verified corrections.</p><button type="submit" disabled={save.isPending || !form.businessName.trim() || !form.contactName.trim()} className="inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#6ec144] to-[#2ca8a8] px-5 text-sm font-extrabold text-[#06131d] disabled:opacity-45"><Save className="h-4 w-4"/>{save.isPending ? "Saving..." : "Save profile"}</button></div>
    </form> : null}
  </div></ClientPortalShell>;
}
