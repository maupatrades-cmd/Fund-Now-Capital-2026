// Notification presentation helpers (A11 / SPEC S4).
// Labels + icons cover the full `notification_event_type` enum (31 values —
// 30 verified 2026-07-31 + LEAD_SUBMITTED_BY_CONTRACTOR added by the LEAD-SUBMIT
// lane 2026-08-02). Any unknown/future value still
// degrades gracefully: eventLabel() falls back to the raw enum string and
// eventIcon() falls back to the Bell icon.
import {
  Bell,
  CheckCircle2,
  PartyPopper,
  Banknote,
  UserPlus,
  UserCheck,
  UserX,
  UserSearch,
  UserCog,
  PencilLine,
  FileText,
  FileX,
  FileWarning,
  Send,
  XCircle,
  Award,
  Clock,
  BarChart3,
  CalendarClock,
  AlarmClock,
  ReceiptText,
  TriangleAlert,
  CircleDollarSign,
  Gift,
  Handshake,
  Inbox,
  MessageSquare,
  Target,
  TrendingUp,
  BadgeCheck,
  Wrench,
  type LucideIcon,
} from "lucide-react";

export type Notification = {
  id: string;
  user_id: string;
  event_type: string;
  title: string;
  body_text: string | null;
  body_html: string | null;
  link_url: string | null;
  data: Record<string, unknown> | null;
  read_status: boolean;
  created_at: string;
  read_at: string | null;
};

// Full S4 event list — all 31 `notification_event_type` enum values, in enum
// order. The filter and preferences matrix cover them all.
export const NOTIFICATION_EVENT_TYPES = [
  { value: "LEAD_CREATED_FOR_YOU", label: "Lead created for you" },
  { value: "LEAD_SUBMITTED_BY_PARTNER", label: "Lead submitted by partner" },
  { value: "LEAD_SUBMITTED_BY_CONTRACTOR", label: "Lead submitted by contractor" },
  { value: "LEAD_QUALIFICATION_UPDATED", label: "Lead qualification updated" },
  { value: "DEAL_SUBMITTED_TO_FUNDER", label: "Deal submitted to funder" },
  { value: "DEAL_APPROVED", label: "Deal approved" },
  { value: "DEAL_DECLINED", label: "Deal declined" },
  { value: "DEAL_FUNDED", label: "Deal funded" },
  { value: "COMMISSION_PAID", label: "Commission paid" },
  { value: "FUNDER_RESPONSE_RECEIVED", label: "Funder response received" },
  { value: "CLIENT_MESSAGE_RECEIVED", label: "Client message received" },
  { value: "FOLLOW_UP_DUE", label: "Follow-up due" },
  { value: "BADGE_EARNED", label: "Badge earned" },
  { value: "MONTHLY_TARGET_MILESTONE", label: "Monthly target milestone" },
  { value: "TIER_REVIEW_UPCOMING", label: "Tier review upcoming" },
  { value: "FUNDER_RATE_CONFIRMED", label: "Funder rate confirmed" },
  { value: "DOCUMENT_UPLOADED", label: "Document uploaded" },
  { value: "SYSTEM_MAINTENANCE", label: "System maintenance" },
  { value: "WEEKLY_SUMMARY", label: "Weekly summary" },
  { value: "LEAD_QUALIFIED", label: "Lead qualified" },
  { value: "LEAD_NOT_QUALIFIED", label: "Lead not qualified" },
  { value: "LEAD_STARTED_QUALIFICATION", label: "Lead started qualification" },
  { value: "LEAD_UPDATED", label: "Lead updated" },
  { value: "DOCUMENT_EXPIRING_30D", label: "Document expiring (30 days)" },
  { value: "DOCUMENT_EXPIRING_7D", label: "Document expiring (7 days)" },
  { value: "DOCUMENT_EXPIRED", label: "Document expired" },
  { value: "LEAD_DOCUMENT_REJECTED", label: "Document rejected" },
  { value: "FUNDER_INVOICE_ISSUED", label: "Invoice issued" },
  { value: "INVOICE_OVERDUE", label: "Invoice overdue" },
  { value: "INVOICE_MARKED_PAID", label: "Invoice paid" },
  { value: "BONUS_PAID", label: "Bonus paid" },
] as const;

const EVENT_LABEL = new Map<string, string>(
  NOTIFICATION_EVENT_TYPES.map((e) => [e.value, e.label]),
);

export function eventLabel(value: string): string {
  return EVENT_LABEL.get(value) ?? value;
}

// Every enum value maps to a lucide icon; unknown values fall back to Bell.
const EVENT_ICON: Record<string, LucideIcon> = {
  // Leads
  LEAD_CREATED_FOR_YOU: UserPlus,
  LEAD_SUBMITTED_BY_PARTNER: Handshake,
  LEAD_SUBMITTED_BY_CONTRACTOR: Handshake,
  LEAD_QUALIFICATION_UPDATED: UserCog,
  LEAD_STARTED_QUALIFICATION: UserSearch,
  LEAD_QUALIFIED: UserCheck,
  LEAD_NOT_QUALIFIED: UserX,
  LEAD_UPDATED: PencilLine,
  LEAD_DOCUMENT_REJECTED: FileWarning,
  // Deals
  DEAL_SUBMITTED_TO_FUNDER: Send,
  DEAL_APPROVED: CheckCircle2,
  DEAL_DECLINED: XCircle,
  DEAL_FUNDED: PartyPopper,
  FUNDER_RESPONSE_RECEIVED: Inbox,
  // Money
  COMMISSION_PAID: Banknote,
  FUNDER_INVOICE_ISSUED: ReceiptText,
  INVOICE_OVERDUE: TriangleAlert,
  INVOICE_MARKED_PAID: CircleDollarSign,
  BONUS_PAID: Gift,
  FUNDER_RATE_CONFIRMED: BadgeCheck,
  // Documents
  DOCUMENT_UPLOADED: FileText,
  DOCUMENT_EXPIRING_30D: CalendarClock,
  DOCUMENT_EXPIRING_7D: AlarmClock,
  DOCUMENT_EXPIRED: FileX,
  // Engagement / ops
  CLIENT_MESSAGE_RECEIVED: MessageSquare,
  FOLLOW_UP_DUE: Clock,
  BADGE_EARNED: Award,
  MONTHLY_TARGET_MILESTONE: Target,
  TIER_REVIEW_UPCOMING: TrendingUp,
  WEEKLY_SUMMARY: BarChart3,
  SYSTEM_MAINTENANCE: Wrench,
};

export function eventIcon(value: string): LucideIcon {
  return EVENT_ICON[value] ?? Bell;
}

export function eventIconClass(value: string): string {
  switch (value) {
    // Money in / success → brand green
    case "DEAL_FUNDED":
    case "COMMISSION_PAID":
    case "INVOICE_MARKED_PAID":
    case "BONUS_PAID":
      return "text-brand-green";
    // Positive / approval → brand teal
    case "DEAL_APPROVED":
    case "LEAD_QUALIFIED":
    case "FUNDER_INVOICE_ISSUED":
      return "text-brand-teal";
    // Negative / error → red
    case "DEAL_DECLINED":
    case "LEAD_NOT_QUALIFIED":
    case "DOCUMENT_EXPIRED":
    case "LEAD_DOCUMENT_REJECTED":
    case "INVOICE_OVERDUE":
      return "text-red-600";
    // Warning (expiring soon) → amber
    case "DOCUMENT_EXPIRING_30D":
    case "DOCUMENT_EXPIRING_7D":
      return "text-amber-600";
    default:
      return "text-brand-navy";
  }
}

// The channels shown in the preferences matrix. In-app (A11) and email (A12)
// are live; WhatsApp and SMS arrive in Phase D.
export const NOTIFICATION_CHANNELS = [
  { key: "in_app_enabled", label: "In-app", live: true },
  { key: "email_enabled", label: "Email", live: true },
  { key: "whatsapp_enabled", label: "WhatsApp", live: false },
  { key: "sms_enabled", label: "SMS", live: false },
] as const;
