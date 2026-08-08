import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { getCadSession } from "@/lib/cad-session";

/**
 * Redirects unauthenticated users to the public index.
 * Wrap any member/staff/department route that requires a CAD session.
 */
export default function RequireAuth({ children }: { children: ReactNode }) {
  const location = useLocation();
  const session = getCadSession();

  if (!session) {
    return <Navigate to="/" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}
