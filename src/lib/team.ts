// Team Management shared types + label/badge helpers. Mirrors the live
// public.user_role enum on profiles.role and the profiles/referral_partners
// shapes verified against the live schema (2026-08-02).

import type { UserRole } from "@/lib/roles";

export type { UserRole };

export type InviteMethod = "magic_link" | "temp_password";

// A person in the CRM (a profiles row), with the referral partner name resolved
// for display.
export type TeamMember = {
  id: string;
  email: string | null;
  full_name: string | null;
  role: UserRole;
  referral_partner_id: string | null;
  referral_partner_name: string | null;
  is_active: boolean;
  phone_number: string | null;
  created_at: string;
};

export type ReferralPartnerOption = { id: string; name: string };

export type TeamFilter = "all" | "owner" | "partner" | "contractor" | "deactivated";

// Roles the owner may assign through the UI. The owner role is deliberately
// absent — owner accounts are provisioned out-of-band, not created here.
export const ASSIGNABLE_ROLES: { value: Exclude<UserRole, "owner">; label: string }[] = [
  { value: "partner", label: "Partner" },
  { value: "contractor", label: "Contractor" },
];

export const ROLE_LABEL: Record<string, string> = {
  owner: "Owner",
  partner: "Partner",
  contractor: "Contractor",
};

export function roleLabel(role: string): string {
  return ROLE_LABEL[role] ?? role;
}

// Role badge colours (ring-1 inset pill; matches the Badge component API).
export function roleBadgeClass(role: string): string {
  switch (role) {
    case "owner":
      return "bg-brand-navy/10 text-brand-navy ring-brand-navy/20";
    case "partner":
      return "bg-brand-teal/10 text-brand-teal ring-brand-teal/20";
    case "contractor":
      return "bg-brand-green/10 text-brand-green ring-brand-green/20";
    default:
      return "bg-slate-100 text-slate-600 ring-slate-200";
  }
}

export function statusBadgeClass(isActive: boolean): string {
  return isActive
    ? "bg-brand-green/10 text-brand-green ring-brand-green/20"
    : "bg-slate-100 text-slate-500 ring-slate-200";
}

// Short en-ZA joined date, e.g. "13 Jul 2026".
export function formatJoined(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric" });
}
