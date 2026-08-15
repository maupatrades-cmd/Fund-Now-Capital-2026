import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { FilePlus2, FileSignature, Loader2 } from "lucide-react";
import { useAgreements } from "@/hooks/useAgreements";
import {
  AGREEMENT_STATE_LABEL,
  agreementStateTone,
  documentTypeLabel,
  isTerminalAgreementState,
  type AgreementListRow,
  type AgreementState,
} from "@/lib/agreements";

/*
 * Build 8.2 — owner agreement register.
 *
 * The counterpart to the signing surface: every agreement FNC has issued, what
 * state it is in, and who still owes a signature.
 */

const TONE_CLASS: Record<ReturnType<typeof agreementStateTone>, string> = {
  ok: "bg-brand-green/10 text-brand-green",
  warn: "bg-amber-100 text-amber-800",
  live: "bg-brand-teal/10 text-brand-teal",
  muted: "bg-slate-100 text-slate-600",
};

export function StatePill({ state }: { state: AgreementState }) {
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${TONE_CLASS[agreementStateTone(state)]}`}
    >
      {AGREEMENT_STATE_LABEL[state] ?? state}
    </span>
  );
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-ZA", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

// Agreements needing the owner's own action come first — a register sorted purely
// by date buries the one thing she has to do today.
const NEEDS_OWNER: AgreementState[] = ["countersign_pending", "draft"];

export default function AgreementsPage() {
  const { data, isLoading, error } = useAgreements();
  const [filter, setFilter] = useState<"open" | "all">("open");

  const rows = useMemo(() => {
    const all = (data ?? []) as AgreementListRow[];
    const visible =
      filter === "all"
        ? all
        : all.filter((a) => !isTerminalAgreementState(a.state));
    return [...visible].sort((a, b) => {
      const aNeeds = NEEDS_OWNER.includes(a.state) ? 0 : 1;
      const bNeeds = NEEDS_OWNER.includes(b.state) ? 0 : 1;
      if (aNeeds !== bNeeds) return aNeeds - bNeeds;
      return b.created_at.localeCompare(a.created_at);
    });
  }, [data, filter]);

  return (
    <div className="p-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-brand-navy">
            <FileSignature className="h-5 w-5 text-brand-teal" />
            Agreements
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Documents sent for electronic signature.
          </p>
        </div>
        <Link
          to="/agreements/new"
          className="inline-flex items-center gap-2 rounded-lg bg-brand-navy px-4 py-2 text-sm font-semibold text-white hover:bg-brand-navy/90"
        >
          <FilePlus2 className="h-4 w-4" />
          Send for signature
        </Link>
      </div>

      <div className="mb-4 flex gap-2">
        {(["open", "all"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              filter === f
                ? "bg-brand-navy text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {f === "open" ? "Open" : "All"}
          </button>
        ))}
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading agreements…
        </div>
      )}

      {error && (
        <p className="text-sm text-red-600">
          {(error as Error).message ?? "Could not load agreements."}
        </p>
      )}

      {!isLoading && !error && rows.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-300 p-10 text-center">
          <p className="text-sm font-medium text-slate-700">
            {filter === "open" ? "No open agreements." : "No agreements yet."}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Publish a template in the Document Studio, then send it for signature.
          </p>
        </div>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Reference</th>
                <th className="px-4 py-3">Document</th>
                <th className="px-4 py-3">State</th>
                <th className="px-4 py-3">Sent</th>
                <th className="px-4 py-3">Executed</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link
                      to={`/agreements/${a.id}`}
                      className="font-medium text-brand-teal hover:underline"
                    >
                      {a.reference}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900">{a.title_snapshot}</div>
                    <div className="text-xs text-slate-500">
                      {documentTypeLabel(a.document_type)}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <StatePill state={a.state} />
                  </td>
                  <td className="px-4 py-3 text-slate-600">{formatDate(a.sent_at)}</td>
                  <td className="px-4 py-3 text-slate-600">{formatDate(a.executed_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
