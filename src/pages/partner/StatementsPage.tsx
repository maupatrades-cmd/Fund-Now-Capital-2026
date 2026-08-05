import PortalShell from "@/components/portal/PortalShell";
import { usePersistedYearMonth } from "@/hooks/usePersistedYearMonth";
import { PartnerStatementView } from "@/components/statements/PartnerStatementView";

// Partner (Doctor / Bright Destiny) statements — his own monthly earnings only,
// fictional funder names, 50/50 framing (S7C). Wrapped in the partner PortalShell.
export default function PartnerStatementsPage() {
  const [ym, setYm] = usePersistedYearMonth("statements:partner");
  return (
    <PortalShell portal="partner">
      <PartnerStatementView ym={ym} onMonth={setYm} />
    </PortalShell>
  );
}
