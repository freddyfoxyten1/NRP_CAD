import { lazy, Suspense, type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useParams } from "react-router-dom";
import RequireAuth from "@/components/auth/RequireAuth";
import { getCadSession } from "@/lib/cad-session";
import PublicView from "@/pages/PublicView";
import NotFound from "@/pages/NotFound";
import RouteFallback from "@/components/routing/RouteFallback";
import { parseResourceSection } from "@/lib/resource-url";

const MemberPortal = lazy(() => import("@/pages/MemberPortal"));
const AdminPortal = lazy(() => import("@/pages/AdminPortal"));
const DepartmentOfPublicSafety = lazy(() => import("@/pages/DepartmentOfPublicSafety"));
const DepartmentOfCommunications = lazy(() => import("@/pages/DepartmentOfCommunications"));
const DepartmentOfPublicHealth = lazy(() => import("@/pages/DepartmentOfPublicHealth"));
const DpsInternalAffairs = lazy(() => import("@/pages/DpsInternalAffairs"));
const StaffPortal = lazy(() => import("@/pages/StaffPortal"));
const CadPage = lazy(() => import("@/pages/CadPage"));
const DocCadPage = lazy(() => import("@/pages/DocCadPage"));
const CivilianOperations = lazy(() => import("@/pages/CivilianOperations"));
const DepartmentOfTransportation = lazy(() => import("@/pages/DepartmentOfTransportation"));

const BASES = new Set([
  "public",
  "portal",
  "admin",
  "dps",
  "dph",
  "doc",
  "staff",
  "civilian",
  "dot",
]);

function withSuspense(node: ReactNode) {
  return <Suspense fallback={<RouteFallback />}>{node}</Suspense>;
}

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
    return withSuspense(
      <RequireAuth>
        <DpsInternalAffairs />
      </RequireAuth>,
    );
  }

  const resourceLink = parseResourceSection(section);
  // In-app resource paths (/dps_resources-title-id) are normal department sections — never PublicView.
  const isExternalPublicShare =
    resourceLink?.mode === "public"
    && !resourceLink.inApp
    && (base === "dps" || base === "dph");
  if (isExternalPublicShare) {
    // Logged-in members opening a public share link stay in the department portal.
    if (getCadSession()) {
      return withSuspense(
        <RequireAuth>
          {base === "dps" ? <DepartmentOfPublicSafety /> : <DepartmentOfPublicHealth />}
        </RequireAuth>,
      );
    }
    return <PublicView />;
  }
  if (resourceLink?.mode === "edit" && base === "staff") {
    return withSuspense(
      <RequireAuth>
        <AdminPortal />
      </RequireAuth>,
    );
  }
  if (resourceLink?.mode === "public" && base === "staff") {
    return withSuspense(
      <RequireAuth>
        <StaffPortal />
      </RequireAuth>,
    );
  }

  if (base === "dps" && section === "cad") {
    return withSuspense(
      <RequireAuth>
        <CadPage />
      </RequireAuth>,
    );
  }
  if (base === "dph" && section === "cad") {
    return <Navigate to="/dph_personnel-roster" replace />;
  }
  if (base === "doc" && section === "cad") {
    return withSuspense(
      <RequireAuth>
        <DocCadPage />
      </RequireAuth>,
    );
  }

  switch (base) {
    case "public":
      return <PublicView />;
    case "portal":
      return withSuspense(
        <RequireAuth>
          <MemberPortal />
        </RequireAuth>,
      );
    case "admin":
      return withSuspense(
        <RequireAuth>
          <AdminPortal />
        </RequireAuth>,
      );
    case "dps":
      return withSuspense(
        <RequireAuth>
          <DepartmentOfPublicSafety />
        </RequireAuth>,
      );
    case "dph":
      return withSuspense(
        <RequireAuth>
          <DepartmentOfPublicHealth />
        </RequireAuth>,
      );
    case "doc":
      return withSuspense(
        <RequireAuth>
          <DepartmentOfCommunications />
        </RequireAuth>,
      );
    case "staff":
      return withSuspense(
        <RequireAuth>
          <StaffPortal />
        </RequireAuth>,
      );
    case "civilian":
      return withSuspense(
        <RequireAuth>
          <CivilianOperations />
        </RequireAuth>,
      );
    case "dot":
      return withSuspense(
        <RequireAuth>
          <DepartmentOfTransportation />
        </RequireAuth>,
      );
    default:
      return <NotFound />;
  }
}
