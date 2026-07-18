import { useState } from "react";
import { Download, Trash2, FileText, Layers, ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ExpiryPill, UploadedByBadge, OwnerOnlyBadge } from "./DocumentBadges";
import type { DocumentRow } from "@/hooks/useClientDocuments";
import {
  docTypeLabel,
  formatDocDate,
  formatFileSize,
  isPeriodScoped,
  packCoverage,
} from "@/lib/documents";

export type DocActions = {
  onDownload: (d: DocumentRow) => void;
  onDelete?: (d: DocumentRow) => void;
};

function periodRange(d: DocumentRow): string | null {
  if (!d.period_start || !d.period_end) return null;
  return `${formatDocDate(d.period_start)} – ${formatDocDate(d.period_end)}`;
}

// One document row. Used across the client tab, deal view, and pack lists.
export function DocumentRowItem({
  doc,
  onDownload,
  onDelete,
  clientName,
  dimmed,
}: DocActions & { doc: DocumentRow; clientName?: string; dimmed?: boolean }) {
  const range = periodRange(doc);
  return (
    <li className={`flex items-center gap-3 p-3 ${dimmed ? "opacity-60" : ""}`}>
      <FileText className="h-5 w-5 shrink-0 text-brand-teal" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium text-brand-navy">{doc.filename}</span>
          {clientName && (
            <span className="text-xs text-muted-foreground">· {clientName}</span>
          )}
          <Badge className="bg-slate-100 text-slate-600 ring-slate-500/20">
            {docTypeLabel(doc.document_type)}
          </Badge>
          {doc.version_number > 1 && (
            <Badge className="bg-slate-100 text-slate-500 ring-slate-400/20">
              v{doc.version_number}
            </Badge>
          )}
          <ExpiryPill expiryDate={doc.expiry_date} />
          <OwnerOnlyBadge documentType={doc.document_type} />
          <UploadedByBadge source={doc.upload_source} />
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          {range && <span>{range} · </span>}
          {formatFileSize(doc.file_size_bytes)}
          {doc.file_size_bytes ? " · " : ""}
          {formatDocDate(doc.created_at)}
        </div>
        {doc.tags && doc.tags.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {doc.tags.map((t) => (
              <Badge key={t} className="bg-brand-teal/10 text-brand-teal ring-brand-teal/20">
                #{t}
              </Badge>
            ))}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={() => onDownload(doc)}
        className="text-muted-foreground hover:text-brand-teal"
        aria-label={`Download ${doc.filename}`}
      >
        <Download className="h-4 w-4" />
      </button>
      {onDelete && (
        <button
          type="button"
          onClick={() => onDelete(doc)}
          className="text-muted-foreground hover:text-red-600"
          aria-label={`Delete ${doc.filename}`}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      )}
    </li>
  );
}

// A period-scoped "pack" (bank statements etc.) — coverage indicator with a
// toggle to reveal the individual period documents. Default view is the pack.
function PackCard({
  documentType,
  docs,
  onDownload,
  onDelete,
}: DocActions & { documentType: string; docs: DocumentRow[] }) {
  const [showIndividual, setShowIndividual] = useState(false);
  const { start, end, months } = packCoverage(docs);
  // Earliest period end drives the "next refresh" hint.
  const earliest = [...docs]
    .filter((d) => d.period_end)
    .sort((a, b) => (a.period_end! < b.period_end! ? -1 : 1))[0];

  return (
    <div className="rounded-lg border border-border">
      <div className="flex items-start gap-3 p-3">
        <Layers className="mt-0.5 h-5 w-5 shrink-0 text-brand-teal" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-brand-navy">
              {docTypeLabel(documentType)} pack
            </span>
            <Badge className="bg-brand-teal/10 text-brand-teal ring-brand-teal/20">
              {months} {months === 1 ? "document" : "documents"}
            </Badge>
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {start && end ? (
              <>Currently covering {formatDocDate(start)} – {formatDocDate(end)}</>
            ) : (
              <>No coverage window set</>
            )}
            {earliest?.period_end && (
              <> · earliest ends {formatDocDate(earliest.period_end)}</>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setShowIndividual((v) => !v)}
          className="inline-flex items-center gap-1 text-xs font-medium text-brand-teal hover:underline"
        >
          {showIndividual ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          {showIndividual ? "Hide" : "Show individual documents"}
        </button>
      </div>
      {showIndividual && (
        <ul className="divide-y divide-border border-t border-border">
          {docs.map((d) => (
            <DocumentRowItem
              key={d.id}
              doc={d}
              onDownload={onDownload}
              onDelete={onDelete}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

// Full document list for a single entity (client tab / deal view). Groups
// current versions by type — period-scoped types render as packs, everything
// else as rows — and hides superseded versions behind a toggle.
export function DocumentList({ docs, onDownload, onDelete }: DocActions & { docs: DocumentRow[] }) {
  const [showHistory, setShowHistory] = useState(false);

  const current = docs.filter((d) => d.is_current_version);
  const historical = docs.filter((d) => !d.is_current_version);

  // Group current docs by type, preserving taxonomy order via first appearance.
  const byType = new Map<string, DocumentRow[]>();
  for (const d of current) {
    const arr = byType.get(d.document_type) ?? [];
    arr.push(d);
    byType.set(d.document_type, arr);
  }

  if (current.length === 0 && historical.length === 0) {
    return null; // caller renders the empty state
  }

  return (
    <div className="space-y-3">
      {[...byType.entries()].map(([type, group]) =>
        isPeriodScoped(type) ? (
          <PackCard
            key={type}
            documentType={type}
            docs={group}
            onDownload={onDownload}
            onDelete={onDelete}
          />
        ) : (
          <ul key={type} className="divide-y divide-border rounded-lg border border-border">
            {group.map((d) => (
              <DocumentRowItem key={d.id} doc={d} onDownload={onDownload} onDelete={onDelete} />
            ))}
          </ul>
        ),
      )}

      {historical.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            className="inline-flex items-center gap-1 text-xs font-medium text-brand-teal hover:underline"
          >
            {showHistory ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            {showHistory ? "Hide" : "Show"} older versions ({historical.length})
          </button>
          {showHistory && (
            <ul className="mt-2 divide-y divide-border rounded-lg border border-border bg-slate-50">
              {historical.map((d) => (
                <DocumentRowItem key={d.id} doc={d} onDownload={onDownload} dimmed />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
