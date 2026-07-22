import {
  LayoutDashboard,
  GitBranch,
  Users,
  Landmark,
  Calculator,
  Activity,
  Factory,
  ClipboardList,
  FolderOpen,
  Percent,
  Receipt,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
};

// Primary navigation, shared by the sidebar across all screens.
export const NAV_ITEMS: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/leads", label: "Leads", icon: ClipboardList },
  { to: "/pipeline", label: "Pipeline", icon: GitBranch },
  { to: "/clients", label: "Clients", icon: Users },
  { to: "/documents", label: "Documents", icon: FolderOpen },
  { to: "/funders", label: "Funders", icon: Landmark },
  { to: "/invoices", label: "Invoices", icon: Receipt },
  { to: "/calculator", label: "Calculator", icon: Calculator },
  { to: "/activity", label: "Activity", icon: Activity },
  { to: "/settings/industries", label: "Industries", icon: Factory },
  { to: "/settings/funders", label: "Funder rates", icon: Percent },
];
