// ─────────────────────────────────────────────────────────────────────────────
// App.tsx  —  Application root
//
// Sets up React Query, the Tooltip provider, toast renderers, and React Router.
// Section URLs use `/base_section` (e.g. `/dps_information`, `/public_store`).
// Public home stays at `/`.
// ─────────────────────────────────────────────────────────────────────────────
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import SectionPathRoute from "./components/routing/SectionPathRoute";
import DiscordCallback from "./pages/DiscordCallback";
import GoogleCallback from "./pages/GoogleCallback";
import PublicView from "./pages/PublicView";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
    },
  },
});

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '') || undefined} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          {/* Public home (default index) */}
          <Route path="/" element={<PublicView />} />
          <Route path="/public_home" element={<Navigate to="/" replace />} />

          {/* OAuth / legacy slash paths */}
          <Route path="/discord-callback" element={<DiscordCallback />} />
          <Route path="/dojcad/discord-callback" element={<DiscordCallback />} />
          <Route path="/google-callback" element={<GoogleCallback />} />
          <Route path="/dojcad/google-callback" element={<GoogleCallback />} />
          <Route path="/dps/internal-affairs" element={<Navigate to="/dps_internal-affairs" replace />} />
          <Route path="/civilian" element={<Navigate to="/portal_dashboard" replace />} />

          {/* Bare bases → default sections */}
          <Route path="/portal" element={<Navigate to="/portal_dashboard" replace />} />
          <Route path="/admin" element={<Navigate to="/admin_members" replace />} />
          <Route path="/dps" element={<Navigate to="/dps_personnel-roster" replace />} />
          <Route path="/dph" element={<Navigate to="/dph_personnel-roster" replace />} />
          <Route path="/doc" element={<Navigate to="/doc_personnel-roster" replace />} />
          <Route path="/staff" element={<Navigate to="/staff_roster" replace />} />

          {/* `/dps_information`, `/public_store`, `/admin_logs-members`, … */}
          <Route path="/:sectionPath" element={<SectionPathRoute />} />

          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
