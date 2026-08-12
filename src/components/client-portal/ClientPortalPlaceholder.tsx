import type { LucideIcon } from "lucide-react";
import ClientPortalShell from "@/components/client-portal/ClientPortalShell";

export default function ClientPortalPlaceholder({
  eyebrow,
  title,
  description,
  icon: Icon,
}: {
  eyebrow: string;
  title: string;
  description: string;
  icon: LucideIcon;
}) {
  return (
    <ClientPortalShell>
      <section className="client-glass rounded-[28px] p-6 sm:p-10">
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[#6ec144]/15 text-[#9ee67d]">
          <Icon className="h-6 w-6" aria-hidden="true" />
        </span>
        <p className="mt-6 text-[10px] font-extrabold uppercase tracking-[0.2em] text-[#86d4cf]">
          {eyebrow}
        </p>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">{title}</h1>
        <p className="mt-4 max-w-2xl text-sm leading-7 text-white/55">{description}</p>
        <div className="mt-8 rounded-2xl border border-white/10 bg-white/[0.035] p-5 text-sm text-white/55">
          This secure workspace is being connected to your Fund Now Capital record. Your information remains saved and private.
        </div>
      </section>
    </ClientPortalShell>
  );
}
