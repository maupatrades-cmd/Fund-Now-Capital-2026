import { usePersistedYearMonth } from "@/hooks/usePersistedYearMonth";
import { OwnerStatementView } from "@/components/statements/OwnerStatementView";

// Owner statements — rendered inside OwnerGate's shared AppLayout (sidebar + top
// bar), same as ReportsPage. Owner sees every commission + bonus across all
// funders, partners, and contractors with REAL names.
export default function StatementsPage() {
  const [ym, setYm] = usePersistedYearMonth("statements:owner");
  return <OwnerStatementView ym={ym} onMonth={setYm} />;
}
