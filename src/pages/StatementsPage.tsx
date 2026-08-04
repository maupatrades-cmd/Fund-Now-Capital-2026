import { useState } from "react";
import { currentYearMonth, type YearMonth } from "@/lib/statements";
import { OwnerStatementView } from "@/components/statements/OwnerStatementView";

// Owner statements — rendered inside OwnerGate's shared AppLayout (sidebar + top
// bar), same as ReportsPage. Owner sees every commission + bonus across all
// funders, partners, and contractors with REAL names.
export default function StatementsPage() {
  const [ym, setYm] = useState<YearMonth>(() => currentYearMonth());
  return <OwnerStatementView ym={ym} onMonth={setYm} />;
}
