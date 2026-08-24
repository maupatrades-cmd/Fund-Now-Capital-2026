import PortalShell, { type PortalKind } from "@/components/portal/PortalShell";
import { RoleDocumentTaskWorkspace } from "@/components/tasks/RoleDocumentTaskWorkspace";

export default function RoleDocumentTasksPage({ portal }: { portal: PortalKind }) {
  return <PortalShell portal={portal}><RoleDocumentTaskWorkspace /></PortalShell>;
}
