import { Hammer } from "lucide-react";

// Placeholder body for screens that aren't built yet. Rendered inside AppLayout.
export function ComingSoon({ title }: { title: string }) {
  return (
    <div className="grid place-items-center rounded-xl border border-dashed border-border bg-white py-20 text-center">
      <div className="space-y-2">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-brand-teal/10 text-brand-teal">
          <Hammer className="h-5 w-5" />
        </span>
        <h2 className="text-lg font-semibold text-brand-navy">{title}</h2>
        <p className="text-sm text-muted-foreground">This screen is coming soon.</p>
      </div>
    </div>
  );
}
