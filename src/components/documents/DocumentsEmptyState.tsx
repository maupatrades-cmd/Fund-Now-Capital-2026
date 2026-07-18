import { FolderOpen } from "lucide-react";

// Friendly empty state (Gap 3). `cta` is shown on the global page; the client
// tab omits it (the upload control is right there).
export function DocumentsEmptyState({ cta }: { cta?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center">
      <FolderOpen className="h-8 w-8 text-slate-300" />
      <p className="text-sm font-medium text-brand-navy">No documents yet.</p>
      {cta && (
        <p className="text-sm text-muted-foreground">
          Upload your first document from a client's Documents tab.
        </p>
      )}
    </div>
  );
}
