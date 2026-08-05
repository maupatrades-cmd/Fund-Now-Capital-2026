import { Navigate, useParams } from "react-router-dom";
import PortalShell from "@/components/portal/PortalShell";
import TrainingModuleView from "@/components/training/TrainingModuleView";

export default function ContractorTrainingModulePage() {
  const { moduleId } = useParams<{ moduleId: string }>();

  // No module id in the path → back to the training list.
  if (!moduleId) {
    return <Navigate to="/contractor/training" replace />;
  }

  return (
    <PortalShell portal="contractor">
      <TrainingModuleView moduleId={moduleId} />
    </PortalShell>
  );
}
