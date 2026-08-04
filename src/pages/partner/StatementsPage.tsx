import { useState } from "react";
import PortalShell from "@/components/portal/PortalShell";
import { currentYearMonth, type YearMonth } from "@/lib/statements";
import { PartnerStatementView } from "@/components/statements/PartnerStatementView";

// Partner (Doctor / Bright Destiny) statements — his own monthly earnings only,
// fictional funder names, 50/50 framing (S7C). Wrapped in the partner PortalShell.
export default function PartnerStatementsPage() {
  const [ym, setYm] = useState<YearMonth>(() => currentYearMonth());
  return (
    <PortalShell portal="partner">
      <PartnerStatementView ym={ym} onMonth={setYm} />
    </PortalShell>
  );
}
