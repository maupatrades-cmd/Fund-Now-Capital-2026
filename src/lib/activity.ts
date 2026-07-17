// Activity-log presentation helpers (A10 / SPEC S5).

export type ActivityLog = {
  id: string;
  occurred_at: string;
  user_id: string | null;
  user_email: string | null;
  user_role: string | null;
  event_type: string;
  entity_type: string;
  entity_id: string | null;
  description: string | null;
  changed_fields: string[] | null;
  before_values: Record<string, unknown> | null;
  after_values: Record<string, unknown> | null;
  related_entity_ids: string[] | null;
  notes: string | null;
};

// Full S5 event enum (data-change events are produced now; the rest are
// reserved for app-layer auth/export events in later phases).
export const ACTIVITY_EVENT_TYPES = [
  { value: "CREATE", label: "Created" },
  { value: "UPDATE", label: "Updated" },
  { value: "DELETE", label: "Deleted" },
  { value: "STAGE_CHANGE", label: "Stage change" },
  { value: "SUBMISSION", label: "Submission" },
  { value: "QUALIFICATION", label: "Qualification" },
  { value: "COMMISSION_CALC", label: "Commission calc" },
  { value: "INVOICE", label: "Invoice" },
  { value: "PAYMENT", label: "Payment" },
  { value: "NOTIFICATION_SENT", label: "Notification sent" },
  { value: "READ", label: "Read" },
  { value: "LOGIN", label: "Login" },
  { value: "LOGOUT", label: "Logout" },
  { value: "LOGIN_FAILED", label: "Login failed" },
  { value: "PERMISSION_CHANGE", label: "Permission change" },
  { value: "EXPORT", label: "Export" },
] as const;

export const ACTIVITY_ENTITY_TYPES = [
  { value: "deal", label: "Deal" },
  { value: "deal_funder_submission", label: "Submission" },
  { value: "client", label: "Client" },
  { value: "client_contact", label: "Contact" },
  { value: "commission_record", label: "Commission" },
  { value: "lead", label: "Lead" },
] as const;

const EVENT_LABEL = new Map<string, string>(ACTIVITY_EVENT_TYPES.map((e) => [e.value, e.label]));
const ENTITY_LABEL = new Map<string, string>(ACTIVITY_ENTITY_TYPES.map((e) => [e.value, e.label]));

export function eventTypeLabel(value: string): string {
  return EVENT_LABEL.get(value) ?? value;
}

export function entityTypeLabel(value: string): string {
  return ENTITY_LABEL.get(value) ?? value;
}

export const EVENT_BADGE: Record<string, string> = {
  CREATE: "bg-green-100 text-green-800 ring-green-600/20",
  UPDATE: "bg-brand-teal/10 text-brand-teal ring-brand-teal/20",
  DELETE: "bg-red-100 text-red-700 ring-red-600/20",
  STAGE_CHANGE: "bg-amber-100 text-amber-800 ring-amber-600/20",
  SUBMISSION: "bg-brand-navy/10 text-brand-navy ring-brand-navy/20",
  QUALIFICATION: "bg-brand-teal/10 text-brand-teal ring-brand-teal/20",
};

export function eventBadge(value: string): string {
  return EVENT_BADGE[value] ?? "bg-slate-100 text-slate-600 ring-slate-500/20";
}

// snake_case column -> "Title Case" for change diffs.
export function fieldLabel(field: string): string {
  return field
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// Render a jsonb value from a change diff in a compact, readable way.
export function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

// Absolute timestamp for the audit trail (the feed itself shows relative time).
export function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString("en-ZA", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ---- CSV export ----------------------------------------------------------
const CSV_COLUMNS: { key: keyof ActivityLog; header: string }[] = [
  { key: "occurred_at", header: "Timestamp" },
  { key: "user_email", header: "User" },
  { key: "user_role", header: "Role" },
  { key: "event_type", header: "Event" },
  { key: "entity_type", header: "Entity" },
  { key: "entity_id", header: "Entity ID" },
  { key: "description", header: "Description" },
  { key: "changed_fields", header: "Changed fields" },
];

function csvCell(value: unknown): string {
  const s =
    value == null ? "" : Array.isArray(value) ? value.join("; ") : String(value);
  // Escape per RFC 4180 and neutralise spreadsheet formula injection.
  const safe = /^[=+\-@]/.test(s) ? "'" + s : s;
  return '"' + safe.replace(/"/g, '""') + '"';
}

export function activityToCsv(rows: ActivityLog[]): string {
  const head = CSV_COLUMNS.map((c) => csvCell(c.header)).join(",");
  const body = rows
    .map((r) => CSV_COLUMNS.map((c) => csvCell(r[c.key])).join(","))
    .join("\r\n");
  return head + "\r\n" + body;
}

export function downloadActivityCsv(rows: ActivityLog[]): void {
  const csv = activityToCsv(rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `activity-log-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
