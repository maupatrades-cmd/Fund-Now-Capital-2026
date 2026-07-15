// Notification presentation helpers (A11 / SPEC S4).
import {
  Bell,
  CheckCircle2,
  PartyPopper,
  Banknote,
  UserPlus,
  FileText,
  Send,
  XCircle,
  Award,
  Clock,
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

// Full S4 event list. Only a handful are emitted in Phase A, but the filter and
// preferences matrix cover them all.
export const NOTIFICATION_EVENT_TYPES = [
  { value: "LEAD_CREATED_FOR_YOU", label: "Lead created for you" },
  { value: "LEAD_SUBMITTED_BY_PARTNER", label: "Lead submitted by partner" },
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
] as const;

const EVENT_LABEL = new Map<string, string>(
  NOTIFICATION_EVENT_TYPES.map((e) => [e.value, e.label]),
);

export function eventLabel(value: string): string {
  return EVENT_LABEL.get(value) ?? value;
}

const EVENT_ICON: Record<string, LucideIcon> = {
  DEAL_APPROVED: CheckCircle2,
  DEAL_FUNDED: PartyPopper,
  DEAL_DECLINED: XCircle,
  COMMISSION_PAID: Banknote,
  LEAD_CREATED_FOR_YOU: UserPlus,
  DEAL_SUBMITTED_TO_FUNDER: Send,
  DOCUMENT_UPLOADED: FileText,
  BADGE_EARNED: Award,
  FOLLOW_UP_DUE: Clock,
};

export function eventIcon(value: string): LucideIcon {
  return EVENT_ICON[value] ?? Bell;
}

export function eventIconClass(value: string): string {
  switch (value) {
    case "DEAL_FUNDED":
    case "COMMISSION_PAID":
      return "text-brand-green";
    case "DEAL_APPROVED":
      return "text-brand-teal";
    case "DEAL_DECLINED":
      return "text-red-600";
    default:
      return "text-brand-navy";
  }
}

// The channels shown in the preferences matrix. Only in_app is live in Phase A.
export const NOTIFICATION_CHANNELS = [
  { key: "in_app_enabled", label: "In-app", live: true },
  { key: "email_enabled", label: "Email", live: false },
  { key: "whatsapp_enabled", label: "WhatsApp", live: false },
  { key: "sms_enabled", label: "SMS", live: false },
] as const;
