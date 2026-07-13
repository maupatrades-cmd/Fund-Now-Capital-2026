import {
  LayoutDashboard,
  GitBranch,
  Users,
  Landmark,
  Calculator,
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
  { to: "/pipeline", label: "Pipeline", icon: GitBranch },
  { to: "/clients", label: "Clients", icon: Users },
  { to: "/funders", label: "Funders", icon: Landmark },
  { to: "/calculator", label: "Calculator", icon: Calculator },
];
