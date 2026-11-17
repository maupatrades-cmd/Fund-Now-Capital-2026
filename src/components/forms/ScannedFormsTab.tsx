import { useState } from "react";
import { FilePlus2 } from "lucide-react";
import { errorText } from "@/components/staff/StaffShell";
import { useStaffRole } from "@/hooks/useStaffDesk";
import { useFormCatalogue, useScannedForms } from "@/hooks/useScannedForms";
import { ScannedFormsList } from "@/components/forms/ScannedFormsList";
import { UploadScannedFormDialog, type UploadPreset } from "@/components/forms/UploadScannedFormDialog";

// The "Scanned forms" tab for a client, a deal, or a person (staff member, agent, field contractor). The list only
// ever holds what the database lets this viewer see.
export type ScannedFormsSubject =
  | { kind: "client"; id: string; name?: string }
  | { kind: "deal"; id: string; clientId: string; name?: string }
  | { kind: "person"; id: string; name?: string };

export function ScannedFormsTab({ subject }: { subject: ScannedFormsSubject }) {
  const { data: role } = useStaffRole();
  const catalogue = useFormCatalogue();
  const list = useScannedForms(
    subject.kind === "client" ? { clientId: subject.id }
      : subject.kind === "deal" ? { dealId: subject.id }
      : { subjectProfileId: subject.id },
  );
  const [open, setOpen] = useState(false);
  const preset: UploadPreset = subject.kind === "person"
    ? { kind: "person", profileId: subject.id, name: subject.name }
    : { kind: "client", clientId: subject.kind === "deal" ? subject.clientId : subject.id, clientName: subject.name, dealId: subject.kind === "deal" ? subject.id : null };
  const linkFits = (k: string) => (subject.kind === "person" ? ["staff", "agent", "person", "field_contractor"].includes(k) : k === "client");
  const canUpload = (catalogue.data ?? []).some((f) => f.can_upload && linkFits(f.link_kind));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-bold text-brand-navy">Scanned forms</h2>
        {canUpload ? (
          <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-2 rounded-lg bg-brand-teal px-3 py-2 text-sm font-semibold text-white hover:opacity-90">
            <FilePlus2 className="h-4 w-4" aria-hidden="true" /> Upload scanned form
          </button>
        ) : null}
      </div>
      {list.error ? <p role="alert" className="text-sm text-red-600">{errorText(list.error)}</p> : null}
      {list.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {list.data ? <ScannedFormsList forms={list.data} isOwner={role === "owner"} /> : null}
      {open ? <UploadScannedFormDialog preset={preset} onClose={() => setOpen(false)} /> : null}
    </div>
  );
}
