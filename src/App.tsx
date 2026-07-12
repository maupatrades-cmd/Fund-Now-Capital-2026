function App() {
  return (
    <main className="min-h-screen bg-background text-foreground flex items-center justify-center px-6">
      <div className="max-w-xl text-center space-y-6">
        <div className="flex items-center justify-center gap-3">
          <span className="inline-block h-3 w-3 rounded-full bg-brand-navy" />
          <span className="inline-block h-3 w-3 rounded-full bg-brand-teal" />
          <span className="inline-block h-3 w-3 rounded-full bg-brand-green" />
        </div>
        <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight text-brand-navy">
          Fund Now Capital
        </h1>
        <p className="text-lg text-brand-teal font-medium">
          Many funders. More approvals.
        </p>
        <p className="text-sm text-muted-foreground">
          Internal CRM shell — Vite + React + TypeScript + Tailwind + shadcn/ui.
          Screens and schema come next.
        </p>
      </div>
    </main>
  );
}

export default App;
