import { Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  EXPIRY_PILL,
  expiryStatus,
  isPartnerExcluded,
  type UploadSource,
} from "@/lib/documents";

// Expiry status pill — green (valid) / amber (≤30d) / red (≤7d or expired) /
// neutral (no expiry). Mirrors the DB expiry-alert cadence.
export function ExpiryPill({ expiryDate }: { expiryDate: string | null }) {
  const status = expiryStatus(expiryDate);
  const pill = EXPIRY_PILL[status];
  return <Badge className={pill.className}>{pill.label(expiryDate)}</Badge>;
}

const SOURCE_META: Record<UploadSource, { label: string; className: string }> = {
  owner: { label: "Owner", className: "bg-brand-navy/10 text-brand-navy ring-brand-navy/20" },
  partner: { label: "Partner", className: "bg-brand-teal/10 text-brand-teal ring-brand-teal/20" },
  client: { label: "Client", className: "bg-green-100 text-green-800 ring-green-600/20" },
  funder: { label: "Funder", className: "bg-amber-100 text-amber-800 ring-amber-600/20" },
};

// Who uploaded the document (audit-truth upload_source), visually differentiated.
export function UploadedByBadge({ source }: { source: UploadSource }) {
  const meta = SOURCE_META[source] ?? SOURCE_META.owner;
  return <Badge className={meta.className}>{meta.label}</Badge>;
}

// Structured-PII types partners can never read (RLS exclusion list).
export function OwnerOnlyBadge({ documentType }: { documentType: string }) {
  if (!isPartnerExcluded(documentType)) return null;
  return (
    <Badge className="bg-amber-100 text-amber-800 ring-amber-600/20">
      <Lock className="mr-1 h-3 w-3" /> Owner-only
    </Badge>
  );
}
