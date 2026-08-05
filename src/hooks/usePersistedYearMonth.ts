import { useCallback, useState } from "react";
import { currentYearMonth, type YearMonth } from "@/lib/statements";

/*
 * Keeps the statement month a user selected across a page unmount/remount — e.g.
 * they pick July, navigate to their home, then return to Statements. Each page
 * seeds its own `useState(currentYearMonth())`, so a plain remount would snap
 * back to the current month (Ito QA ROLE-3). Backing the selection with
 * sessionStorage makes it survive the round-trip (and a reload) while staying
 * per-tab; a fresh tab/session starts at the current month.
 *
 * Scoped per `storageKey` (one per role surface). The stored value is only a
 * year+month integer pair — no private data — so it needs no cross-user
 * clearing beyond the natural per-tab lifetime of sessionStorage.
 */
export function usePersistedYearMonth(
  storageKey: string,
): [YearMonth, (next: YearMonth) => void] {
  const [ym, setYmState] = useState<YearMonth>(() => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<YearMonth>;
        if (
          typeof parsed?.year === "number" &&
          typeof parsed?.month === "number" &&
          parsed.month >= 1 &&
          parsed.month <= 12
        ) {
          return { year: parsed.year, month: parsed.month };
        }
      }
    } catch {
      // Malformed JSON or storage unavailable (private mode) → current month.
    }
    return currentYearMonth();
  });

  const setYm = useCallback(
    (next: YearMonth) => {
      setYmState(next);
      try {
        sessionStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        // Storage write blocked (private mode / quota) — the in-memory state
        // still updates, so the picker works for the current mount.
      }
    },
    [storageKey],
  );

  return [ym, setYm];
}
