import { Navigate } from "react-router-dom";
import { useParams } from "react-router-dom";
import RequireAuth from "@/components/auth/RequireAuth";
import MemberPortal from "@/pages/MemberPortal";
import AdminPortal from "@/pages/AdminPortal";
import DepartmentOfPublicSafety from "@/pages/DepartmentOfPublicSafety";
import DepartmentOfCommunications from "@/pages/DepartmentOfCommunications";
import DepartmentOfPublicHealth from "@/pages/DepartmentOfPublicHealth";
import DpsInternalAffairs from "@/pages/DpsInternalAffairs";
import DphInternalAffairs from "@/pages/DphInternalAffairs";
import StaffPortal from "@/pages/StaffPortal";
import PublicView from "@/pages/PublicView";
import NotFound from "@/pages/NotFound";

const BASES = new Set([
  "public",
  "portal",
  "admin",
  "dps",
  "dph",
  "doc",
  "staff",
]);

/**
 * Handles shareable `/base_section` URLs (e.g. `/dps_information`, `/public_store`).
 * React Router cannot parse `/base_:section` as a param, so we match `/:sectionPath`
 * and dispatch by parsing the underscore form ourselves.
 * Public home is `/` (not `/public_home`).
 */
export default function SectionPathRoute() {
  const { sectionPath } = useParams<{ sectionPath: string }>();
  const raw = sectionPath?.trim() ?? "";
  const underscore = raw.indexOf("_");
  if (underscore <= 0) return <NotFound />;

  const base = raw.slice(0, underscore);
  const section = raw.slice(underscore + 1);
  if (!BASES.has(base) || !section) return <NotFound />;

  if (base === "public" && section === "home") {
    return <Navigate to="/" replace />;
  }

  if (base === "dps" && section === "internal-affairs") {
    return (
      <RequireAuth>
        <DpsInternalAffairs />
      </RequireAuth>
    );
  }
  if (base === "dph" && section === "internal-affairs") {
    return (
      <RequireAuth>
        <DphInternalAffairs />
      </RequireAuth>
    );
  }
  if (base === "dps" && section === "cad") {
    return <Navigate to="/dps_personnel-roster" replace />;
  }
  if (base === "dph" && section === "cad") {
    return <Navigate to="/dph_personnel-roster" replace />;
  }
  if (base === "doc" && section === "cad") {
    return <Navigate to="/doc_personnel-roster" replace />;
  }

  switch (base) {
    case "public":
      return <PublicView />;
    case "portal":
      return (
        <RequireAuth>
          <MemberPortal />
        </RequireAuth>
      );
    case "admin":
      return (
        <RequireAuth>
          <AdminPortal />
        </RequireAuth>
      );
    case "dps":
      return (
        <RequireAuth>
          <DepartmentOfPublicSafety />
        </RequireAuth>
      );
    case "dph":
      return (
        <RequireAuth>
          <DepartmentOfPublicHealth />
        </RequireAuth>
      );
    case "doc":
      return (
        <RequireAuth>
          <DepartmentOfCommunications />
        </RequireAuth>
      );
    case "staff":
      return (
        <RequireAuth>
          <StaffPortal />
        </RequireAuth>
      );
    default:
      return <NotFound />;
  }
}
