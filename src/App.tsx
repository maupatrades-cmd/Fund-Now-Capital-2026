import { Toaster } from "sonner";
import AuthPage from "@/pages/AuthPage";

function App() {
  return (
    <>
      <AuthPage />
      <Toaster position="top-center" richColors />
    </>
  );
}

export default App;
