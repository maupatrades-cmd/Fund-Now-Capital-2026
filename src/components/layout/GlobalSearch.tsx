import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, Search } from "lucide-react";
import { useGlobalSearch } from "@/hooks/useGlobalSearch";

export function GlobalSearch() {
  const [term, setTerm] = useState("");
  const [debouncedTerm, setDebouncedTerm] = useState("");
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const query = useGlobalSearch(debouncedTerm);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedTerm(term), 300);
    return () => window.clearTimeout(timer);
  }, [term]);

  useEffect(() => {
    const close = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  return <div ref={root} className="relative hidden w-full max-w-sm md:block">
    <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
    <input value={term} onFocus={() => setOpen(true)} onChange={(e) => { setTerm(e.target.value); setOpen(true); }} aria-label="Search CRM" placeholder="Search clients, leads, deals..." className="w-full rounded-lg border border-border py-2 pl-9 pr-3 text-sm outline-none focus:border-brand-teal" />
    {open && term.trim().length >= 2 && <div className="absolute left-0 right-0 top-11 z-30 max-h-80 overflow-y-auto rounded-xl border border-border bg-white p-2 shadow-xl">
      {(debouncedTerm !== term || query.isLoading) && <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Searching...</div>}
      {query.isError && <p className="p-3 text-sm text-red-600">Search is temporarily unavailable.</p>}
      {debouncedTerm === term && !query.isLoading && !query.isError && (query.data?.length ?? 0) === 0 && <p className="p-3 text-sm text-muted-foreground">No matches found.</p>}
      {debouncedTerm === term && (query.data ?? []).map((result) => <Link key={`${result.kind}-${result.id}`} to={result.to} onClick={() => { setOpen(false); setTerm(""); setDebouncedTerm(""); }} className="flex items-center justify-between rounded-lg px-3 py-2 text-sm hover:bg-slate-50"><span className="font-medium text-brand-navy">{result.label}</span><span className="text-xs text-muted-foreground">{result.kind}</span></Link>)}
    </div>}
  </div>;
}
