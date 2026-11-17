import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { FilePlus2 } from "lucide-react";
import { Field, card, errorText, selectClass } from "@/components/staff/StaffShell";
import { useStaffRole } from "@/hooks/useStaffDesk";
import { CATEGORY_LABEL, useFormCatalogue, useScannedForms, type FormCategory } from "@/hooks/useScannedForms";
import { ScannedFormsList } from "@/components/forms/ScannedFormsList";
import { UploadScannedFormDialog } from "@/components/forms/UploadScannedFormDialog";

const inputClass = "flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm";

// Forms library: every scanned form this person may see, filterable by form, category, period, person, client and
// uploader. ?person=<profile id> or ?client=<client id> opens it filtered (used from the Team and onboarding pages).
export default function StaffFormsLibraryPage() {
  const { data: role } = useStaffRole();
  const [params, setParams] = useSearchParams();
  const catalogue = useFormCatalogue();
  const [category, setCategory] = useState<FormCategory | "">("");
  const [formCode, setFormCode] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [text, setText] = useState("");
  const [uploader, setUploader] = useState("");
  const [open, setOpen] = useState(false);
  const person = params.get("person");
  const client = params.get("client");

  const list = useScannedForms({
    category: category || null, formCode: formCode || null, from: from || null, to: to || null,
    subjectProfileId: person, clientId: client,
  });
  const categories = useMemo(() => [...new Set((catalogue.data ?? []).map((f) => f.category))], [catalogue.data]);
  const uploaders = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of list.data ?? []) m.set(f.created_by, f.created_by_name ?? "Unnamed");
    return [...m.entries()];
  }, [list.data]);
  const rows = (list.data ?? []).filter((f) => {
    if (uploader && f.created_by !== uploader) return false;
    const t = text.trim().toLowerCase();
    if (!t) return true;
    return [f.client_name, f.subject_name, f.deal_reference, f.signed_by, f.title, f.form_code].some((v) => v?.toLowerCase().includes(t));
  });
  const canUpload = (catalogue.data ?? []).some((f) => f.can_upload);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-brand-navy">Forms library</h1>
          <p className="text-sm text-muted-foreground">Scanned paper forms you may see. Every view and download is logged.</p>
        </div>
        {canUpload ? (
          <button type="button" onClick={() => setOpen(true)} className="inline-flex h-11 items-center gap-2 rounded-lg bg-brand-teal px-5 text-sm font-semibold text-white hover:opacity-90">
            <FilePlus2 className="h-4 w-4" aria-hidden="true" /> Upload scanned form
          </button>
        ) : null}
      </div>
      {person || client ? (
        <p className="text-sm text-brand-navy">
          Showing forms for one {person ? "person" : "client"}.{" "}
          <button type="button" className="font-semibold text-brand-teal underline" onClick={() => setParams({})}>Show all</button>
        </p>
      ) : null}
      <section className={`${card} grid gap-3 sm:grid-cols-2 lg:grid-cols-3`}>
        <Field label="Category">
          <select className={selectClass} value={category} onChange={(e) => { setCategory(e.target.value as FormCategory | ""); setFormCode(""); }}>
            <option value="">All categories</option>
            {categories.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
          </select>
        </Field>
        <Field label="Form">
          <select className={selectClass} value={formCode} onChange={(e) => setFormCode(e.target.value)}>
            <option value="">All forms</option>
            {(catalogue.data ?? []).filter((f) => !category || f.category === category).map((f) => <option key={f.code} value={f.code}>{f.code} · {f.title}</option>)}
          </select>
        </Field>
        <Field label="Person, client or signer">
          <input className={inputClass} value={text} onChange={(e) => setText(e.target.value)} placeholder="Search by name" />
        </Field>
        <Field label="From"><input type="date" className={inputClass} value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><input type="date" className={inputClass} value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <Field label="Uploaded by">
          <select className={selectClass} value={uploader} onChange={(e) => setUploader(e.target.value)}>
            <option value="">Anyone</option>
            {uploaders.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </Field>
      </section>
      <section className={card}>
        {list.error ? <p role="alert" className="text-sm text-red-600">{errorText(list.error)}</p> : null}
        {list.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : <ScannedFormsList forms={rows} isOwner={role === "owner"} />}
      </section>
      {open ? <UploadScannedFormDialog preset={null} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
