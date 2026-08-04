import { useState } from "react";
import PortalShell from "@/components/portal/PortalShell";
import { currentYearMonth, type YearMonth } from "@/lib/statements";
import { ContractorStatementView } from "@/components/statements/ContractorStatementView";

// Contractor statements — his own monthly commission earnings + reimbursements
// (reimbursements land with the PROGRESSION lane). Fictional funder names.
export default function ContractorStatementsPage() {
  const [ym, setYm] = useState<YearMonth>(() => currentYearMonth());
  return (
    <PortalShell portal="contractor">
      <ContractorStatementView ym={ym} onMonth={setYm} />
    </PortalShell>
  );
}
