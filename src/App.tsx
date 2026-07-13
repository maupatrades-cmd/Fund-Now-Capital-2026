import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster } from "sonner";
import AuthPage from "@/pages/AuthPage";
import DashboardPage from "@/pages/DashboardPage";
import { useSession } from "@/lib/useSession";

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
      <Route
        path="/dashboard"
        element={session ? <DashboardPage /> : <Navigate to="/" replace />}
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
      <Toaster position="top-center" richColors />
    </BrowserRouter>
  );
}

export default App;
