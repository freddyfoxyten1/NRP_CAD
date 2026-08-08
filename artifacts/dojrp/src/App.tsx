// ─────────────────────────────────────────────────────────────────────────────
// App.tsx  —  Application root
//
// Sets up React Query, the Tooltip provider, toast renderers, and React Router.
// All routes are defined here — one <Route> per page.
// Add new routes ABOVE the "*" catch-all at the bottom of the <Routes> block.
// ─────────────────────────────────────────────────────────────────────────────
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import RequireAuth from "./components/auth/RequireAuth";
import MemberPortal from "./pages/MemberPortal";
import AdminPortal from "./pages/AdminPortal";
import DepartmentOfPublicSafety from "./pages/DepartmentOfPublicSafety";
import DepartmentOfCommunications from "./pages/DepartmentOfCommunications";
import DepartmentOfPublicHealth from "./pages/DepartmentOfPublicHealth";
import DpsInternalAffairs from "./pages/DpsInternalAffairs";
import DphInternalAffairs from "./pages/DphInternalAffairs";
import StaffPortal from "./pages/StaffPortal";
import DiscordCallback from "./pages/DiscordCallback";
import PublicView from "./pages/PublicView";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '') || undefined} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="/" element={<PublicView />} />
          <Route path="/discord-callback" element={<DiscordCallback />} />
          {/* Alias matching the redirect URI registered in the Discord Developer Portal */}
          <Route path="/dojcad/discord-callback" element={<DiscordCallback />} />

          <Route path="/portal" element={<RequireAuth><MemberPortal /></RequireAuth>} />
          <Route path="/admin" element={<RequireAuth><AdminPortal /></RequireAuth>} />
          <Route path="/civilian" element={<Navigate to="/portal" replace />} />
          <Route path="/dps" element={<RequireAuth><DepartmentOfPublicSafety /></RequireAuth>} />
          <Route path="/dps/internal-affairs" element={<RequireAuth><DpsInternalAffairs /></RequireAuth>} />
          <Route path="/doc" element={<RequireAuth><DepartmentOfCommunications /></RequireAuth>} />
          <Route path="/dph" element={<RequireAuth><DepartmentOfPublicHealth /></RequireAuth>} />
          <Route path="/dph/internal-affairs" element={<RequireAuth><DphInternalAffairs /></RequireAuth>} />
          <Route path="/staff" element={<RequireAuth><StaffPortal /></RequireAuth>} />
          <Route path="/doc_cad" element={<Navigate to="/doc" replace />} />
          <Route path="/dps_cad" element={<Navigate to="/dps" replace />} />
          <Route path="/dph_cad" element={<Navigate to="/dph" replace />} />

          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
