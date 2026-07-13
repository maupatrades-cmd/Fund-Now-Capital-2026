import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, Pencil, Trash2, Mail, Phone, BadgeCheck } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import {
  useClientContacts,
  useSaveClientContact,
  useDeleteClientContact,
  type ClientContact,
  type ContactInput,
} from "@/hooks/useClients";
import { isValidSACell, isValidSAIdNumber } from "@/lib/clients";

const contactSchema = z
  .object({
    full_name: z.string().trim().min(1, "Name is required"),
    position: z.string().optional().default(""),
    phone: z.string().optional().default(""),
    email: z.string().optional().default(""),
    id_number: z.string().optional().default(""),
    is_primary_director: z.boolean(),
  })
  .superRefine((val, ctx) => {
    if (val.phone && !isValidSACell(val.phone))
      ctx.addIssue({ code: "custom", path: ["phone"], message: "Enter a valid SA cell number" });
    if (val.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(val.email))
      ctx.addIssue({ code: "custom", path: ["email"], message: "Enter a valid email" });
    if (val.id_number && !isValidSAIdNumber(val.id_number))
      ctx.addIssue({ code: "custom", path: ["id_number"], message: "SA ID must be 13 digits" });
  });

type ContactValues = z.input<typeof contactSchema>;

const fieldCls =
  "w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-brand-teal focus:ring-2 focus:ring-brand-teal/20";
const errCls = "mt-1 text-xs text-red-600";

export function ContactsManager({ clientId }: { clientId: string }) {
  const { data: contacts, isLoading } = useClientContacts(clientId);
  const del = useDeleteClientContact();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<ClientContact | null>(null);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-brand-navy">Contacts</h3>
        {!adding && !editing && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-teal hover:underline"
          >
            <Plus className="h-4 w-4" /> Add contact
          </button>
        )}
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : contacts && contacts.length > 0 ? (
        <ul className="space-y-2">
          {contacts.map((c) =>
            editing?.id === c.id ? (
              <li key={c.id}>
                <ContactForm
                  clientId={clientId}
                  contact={c}
                  onDone={() => setEditing(null)}
                  onCancel={() => setEditing(null)}
                />
              </li>
            ) : (
              <li
                key={c.id}
                className="flex items-start justify-between gap-3 rounded-lg border border-border p-3"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-brand-navy">
                    {c.full_name}
                    {c.position && (
                      <span className="font-normal text-muted-foreground">· {c.position}</span>
                    )}
                    {c.is_primary_director && (
                      <Badge className="bg-brand-teal/10 text-brand-teal ring-brand-teal/20">
                        <BadgeCheck className="mr-1 h-3 w-3" /> Primary director
                      </Badge>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                    {c.phone && (
                      <span className="inline-flex items-center gap-1">
                        <Phone className="h-3 w-3" /> {c.phone}
                      </span>
                    )}
                    {c.email && (
                      <span className="inline-flex items-center gap-1">
                        <Mail className="h-3 w-3" /> {c.email}
                      </span>
                    )}
                    {c.id_number && <span>ID {c.id_number}</span>}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setAdding(false);
                      setEditing(c);
                    }}
                    className="text-muted-foreground hover:text-brand-navy"
                    aria-label={`Edit ${c.full_name}`}
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => del.mutate({ id: c.id, clientId })}
                    className="text-muted-foreground hover:text-red-600"
                    aria-label={`Delete ${c.full_name}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ),
          )}
        </ul>
      ) : (
        !adding && <p className="text-sm text-muted-foreground">No contacts yet.</p>
      )}

      {adding && (
        <div className="mt-2">
          <ContactForm
            clientId={clientId}
            onDone={() => setAdding(false)}
            onCancel={() => setAdding(false)}
          />
        </div>
      )}
    </div>
  );
}

function ContactForm({
  clientId,
  contact,
  onDone,
  onCancel,
}: {
  clientId: string;
  contact?: ClientContact;
  onDone: () => void;
  onCancel: () => void;
}) {
  const save = useSaveClientContact();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ContactValues>({
    resolver: zodResolver(contactSchema),
    defaultValues: {
      full_name: contact?.full_name ?? "",
      position: contact?.position ?? "",
      phone: contact?.phone ?? "",
      email: contact?.email ?? "",
      id_number: contact?.id_number ?? "",
      is_primary_director: contact?.is_primary_director ?? false,
    },
  });

  const onSubmit = async (v: ContactValues) => {
    const input: ContactInput = {
      full_name: v.full_name!.trim(),
      position: v.position ? v.position : null,
      phone: v.phone ? v.phone : null,
      email: v.email ? v.email : null,
      id_number: v.id_number ? v.id_number : null,
      is_primary_director: v.is_primary_director!,
    };
    try {
      await save.mutateAsync({ clientId, contactId: contact?.id, input });
      toast.success(contact ? "Contact updated" : "Contact added");
      onDone();
    } catch (e) {
      toast.error((e as Error).message || "Could not save contact");
    }
  };

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="space-y-2 rounded-lg border border-brand-teal/40 bg-slate-50 p-3"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <input className={fieldCls} placeholder="Full name *" {...register("full_name")} />
          {errors.full_name && <p className={errCls}>{errors.full_name.message}</p>}
        </div>
        <input className={fieldCls} placeholder="Role" {...register("position")} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <input className={fieldCls} placeholder="Cell (e.g. 082 123 4567)" {...register("phone")} />
          {errors.phone && <p className={errCls}>{errors.phone.message}</p>}
        </div>
        <div>
          <input className={fieldCls} placeholder="Email" {...register("email")} />
          {errors.email && <p className={errCls}>{errors.email.message}</p>}
        </div>
      </div>
      <div>
        <input className={fieldCls} placeholder="ID number (13 digits)" {...register("id_number")} />
        {errors.id_number && <p className={errCls}>{errors.id_number.message}</p>}
      </div>
      <label className="flex items-center gap-2 text-sm text-brand-navy">
        <input type="checkbox" className="h-4 w-4 accent-brand-teal" {...register("is_primary_director")} />
        Primary director
      </label>
      <div className="flex items-center gap-2 pt-1">
        <button
          type="submit"
          disabled={save.isPending}
          className="rounded-lg bg-brand-teal px-4 py-2 text-sm font-semibold text-white hover:bg-brand-teal/90 disabled:opacity-60"
        >
          {save.isPending ? "Saving…" : contact ? "Save" : "Add"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-border px-4 py-2 text-sm text-brand-navy hover:bg-white"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
