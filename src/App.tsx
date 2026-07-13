import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import AuthPage from "@/pages/AuthPage";
import AppLayout from "@/components/layout/AppLayout";
import DashboardPage from "@/pages/DashboardPage";
import PipelinePage from "@/pages/PipelinePage";
import ClientsPage from "@/pages/ClientsPage";
import ClientDetailPage from "@/pages/ClientDetailPage";
import ClientFormPage from "@/pages/ClientFormPage";
import FundersPage from "@/pages/FundersPage";
import FunderDetailPage from "@/pages/FunderDetailPage";
import FunderFormPage from "@/pages/FunderFormPage";
import CalculatorPage from "@/pages/CalculatorPage";
import { useSession } from "@/lib/useSession";
import { queryClient } from "@/lib/queryClient";

function AppRoutes() {
  const session = useSession();

  // Brief loading state while we read the persisted session.
  if (session === undefined) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  return (
    <Routes>
      <Route
        path="/"
        element={session ? <Navigate to="/dashboard" replace /> : <AuthPage />}
      />

      {/* Authenticated app — shared sidebar/top-bar layout. */}
      <Route element={session ? <AppLayout /> : <Navigate to="/" replace />}>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/pipeline" element={<PipelinePage />} />
        <Route path="/clients" element={<ClientsPage />} />
        <Route path="/clients/new" element={<ClientFormPage />} />
        <Route path="/clients/:id" element={<ClientDetailPage />} />
        <Route path="/clients/:id/edit" element={<ClientFormPage />} />
        <Route path="/funders" element={<FundersPage />} />
        <Route path="/funders/new" element={<FunderFormPage />} />
        <Route path="/funders/:id" element={<FunderDetailPage />} />
        <Route path="/funders/:id/edit" element={<FunderFormPage />} />
        <Route path="/calculator" element={<CalculatorPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppRoutes />
        <Toaster position="top-center" richColors />
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;
