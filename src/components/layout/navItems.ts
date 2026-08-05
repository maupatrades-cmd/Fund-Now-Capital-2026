import {
  LayoutDashboard,
  GitBranch,
  Users,
  Landmark,
  Calculator,
  Activity,
  BarChart3,
  Factory,
  ClipboardList,
  FolderOpen,
  Percent,
  Receipt,
  ReceiptText,
  Wallet,
  FileText,
  UserCog,
  Bell,
  ScrollText,
  ListTodo,
  HandCoins,
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
  { to: "/tasks", label: "Tasks", icon: ListTodo },
  { to: "/clients", label: "Clients", icon: Users },
  { to: "/documents", label: "Documents", icon: FolderOpen },
  { to: "/funders", label: "Funders", icon: Landmark },
  { to: "/invoices", label: "Invoices", icon: Receipt },
  { to: "/repayments", label: "Repayments", icon: HandCoins },
  { to: "/invoices/partner-approvals", label: "Partner Invoices", icon: ReceiptText },
  { to: "/partner-earnings", label: "Partner Earnings", icon: Wallet },
  { to: "/statements", label: "Statements", icon: FileText },
  { to: "/calculator", label: "Calculator", icon: Calculator },
  { to: "/activity", label: "Activity", icon: Activity },
  { to: "/reports", label: "Reports", icon: BarChart3 },
  { to: "/team", label: "Team", icon: UserCog },
  { to: "/settings/notifications", label: "Notifications", icon: Bell },
  { to: "/settings/industries", label: "Industries", icon: Factory },
  { to: "/settings/funders", label: "Funder rates", icon: Percent },
  { to: "/settings/terms", label: "Terms", icon: ScrollText },
];
