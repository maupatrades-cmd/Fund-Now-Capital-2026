import PortalShell from "@/components/portal/PortalShell";
import { usePersistedYearMonth } from "@/hooks/usePersistedYearMonth";
import { ContractorStatementView } from "@/components/statements/ContractorStatementView";

// Contractor statements — his own monthly commission earnings + reimbursements
// (reimbursements land with the PROGRESSION lane). Fictional funder names.
export default function ContractorStatementsPage() {
  const [ym, setYm] = usePersistedYearMonth("statements:contractor");
  return (
    <PortalShell portal="contractor">
      <ContractorStatementView ym={ym} onMonth={setYm} />
    </PortalShell>
  );
}
