import { useMemo, useState } from "react";
import { DocumentRowItem } from "@/components/documents/DocumentList";
import { DocumentsEmptyState } from "@/components/documents/DocumentsEmptyState";
import { openDocument, type DocumentRow } from "@/hooks/useClientDocuments";
import { useAllDocuments, owningEntityName, type AllDocumentRow } from "@/hooks/useDocuments";
import {
  DOCUMENT_CATEGORIES,
  expiryStatus,
  typesInCategory,
  type DocumentCategory,
} from "@/lib/documents";

const ctl =
  "rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:border-brand-teal focus:ring-2 focus:ring-brand-teal/20";

type ExpiryFilter = "all" | "expired" | "expiring" | "valid" | "none";

const EXPIRY_OPTIONS: { value: ExpiryFilter; label: string }[] = [
  { value: "all", label: "Any expiry" },
  { value: "expired", label: "Expired" },
  { value: "expiring", label: "Expiring (≤30 days)" },
  { value: "valid", label: "Valid" },
  { value: "none", label: "No expiry" },
];

function matchesExpiry(d: DocumentRow, filter: ExpiryFilter): boolean {
  if (filter === "all") return true;
  const s = expiryStatus(d.expiry_date);
  switch (filter) {
    case "expired":
      return s === "expired";
    case "expiring":
      return s === "urgent" || s === "soon";
    case "valid":
      return s === "ok";
    case "none":
      return s === "none";
  }
}

export default function DocumentsPage() {
  const { data: docs, isLoading, error } = useAllDocuments();

  const [category, setCategory] = useState<DocumentCategory | "all">("all");
  const [clientId, setClientId] = useState("");
  const [docType, setDocType] = useState("");
  const [expiry, setExpiry] = useState<ExpiryFilter>("all");
  const [tag, setTag] = useState("");

  // Owning-entity options derived from the fetched rows (no extra query).
  const entityOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of docs ?? []) {
      const id = d.client_id ?? d.lead_id;
      if (id) map.set(id, owningEntityName(d));
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [docs]);

  const filtered = useMemo(() => {
    const q = tag.trim().toLowerCase();
    return (docs ?? []).filter((d) => {
      if (category !== "all" && d.category !== category) return false;
      if (clientId && d.client_id !== clientId && d.lead_id !== clientId) return false;
      if (docType && d.document_type !== docType) return false;
      if (!matchesExpiry(d, expiry)) return false;
      if (q && !(d.tags ?? []).some((t) => t.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [docs, category, clientId, docType, expiry, tag]);

  const clearFilters = () => {
    setCategory("all");
    setClientId("");
    setDocType("");
    setExpiry("all");
    setTag("");
  };
  const anyFilter = category !== "all" || clientId || docType || expiry !== "all" || tag;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-brand-navy">Documents</h1>
          <p className="text-sm text-muted-foreground">
            {docs ? `${docs.length} current document${docs.length === 1 ? "" : "s"} across the CRM` : "—"}
          </p>
        </div>
      </div>

      {/* Category chips (8 + All) */}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setCategory("all")}
          className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset ${
            category === "all"
              ? "bg-brand-navy text-white ring-brand-navy"
              : "bg-white text-muted-foreground ring-border hover:text-brand-navy"
          }`}
        >
          All
        </button>
        {DOCUMENT_CATEGORIES.map((c) => (
          <button
            key={c.value}
            type="button"
            onClick={() => setCategory(c.value)}
            className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset ${
              category === c.value
                ? "bg-brand-teal text-white ring-brand-teal"
                : "bg-white text-muted-foreground ring-border hover:text-brand-navy"
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 gap-3 rounded-xl border border-border bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-4">
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          Client / lead
          <select className={ctl} value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">All</option>
            {entityOptions.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          Type
          <select className={ctl} value={docType} onChange={(e) => setDocType(e.target.value)}>
            <option value="">All types</option>
            {DOCUMENT_CATEGORIES.map((cat) => (
              <optgroup key={cat.value} label={cat.label}>
                {typesInCategory(cat.value).map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          Expiry
          <select
            className={ctl}
            value={expiry}
            onChange={(e) => setExpiry(e.target.value as ExpiryFilter)}
          >
            {EXPIRY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          Tag
          <input
            type="search"
            className={ctl}
            placeholder="Filter by tag…"
            value={tag}
            onChange={(e) => setTag(e.target.value)}
          />
        </label>
        {anyFilter && (
          <button
            type="button"
            onClick={clearFilters}
            className="justify-self-start text-xs font-medium text-brand-teal hover:underline"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* List */}
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading documents…</p>
      ) : error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {(error as Error).message}
        </div>
      ) : filtered.length > 0 ? (
        <ul className="divide-y divide-border rounded-xl border border-border bg-white shadow-sm">
          {filtered.map((d: AllDocumentRow) => (
            <DocumentRowItem
              key={d.id}
              doc={d}
              onDownload={(row) => openDocument(row.storage_path)}
              clientName={owningEntityName(d)}
            />
          ))}
        </ul>
      ) : docs && docs.length > 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          No documents match these filters.
        </p>
      ) : (
        <DocumentsEmptyState cta />
      )}
    </div>
  );
}
