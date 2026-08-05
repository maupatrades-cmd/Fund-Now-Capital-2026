import PortalShell from "@/components/portal/PortalShell";
import TrainingListView from "@/components/training/TrainingListView";

export default function ContractorTrainingPage() {
  return (
    <PortalShell portal="contractor">
      <TrainingListView />
    </PortalShell>
  );
}
