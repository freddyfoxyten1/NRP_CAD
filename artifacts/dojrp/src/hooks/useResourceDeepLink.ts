import { useCallback, useEffect, useMemo, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  departmentPortalResourcePath,
  departmentResourcesTabPath,
  findResourceByLinkSlug,
  parseResourcePathname,
  type ResourceLinkDepartment,
  type ResourceLinkTarget,
} from "@/lib/resource-url";

type Options<T extends ResourceLinkTarget> = {
  department: ResourceLinkDepartment;
  resources: T[];
  resourcesLoaded: boolean;
  onOpen: (resource: T, canEdit: boolean) => void;
  /** Where to go when the resource overlay closes (defaults to department resources tab). */
  closePath?: string;
};

export function useResourceDeepLink<T extends ResourceLinkTarget>(options: Options<T>) {
  const navigate = useNavigate();
  const location = useLocation();
  const handledRef = useRef<string | null>(null);
  const returnPathRef = useRef<string | null>(null);
  const onOpenRef = useRef(options.onOpen);
  onOpenRef.current = options.onOpen;

  const parsed = useMemo(() => parseResourcePathname(location.pathname), [location.pathname]);
  const activeLink = parsed?.department === options.department ? parsed : null;

  useEffect(() => {
    if (!activeLink || !options.resourcesLoaded) return;
    const key = location.pathname;
    if (handledRef.current === key) return;
    const resource = findResourceByLinkSlug(options.resources, activeLink.linkSlug);
    if (!resource) return;
    handledRef.current = key;
    const canEdit = activeLink.mode === "edit" && !activeLink.inApp;
    onOpenRef.current(resource, canEdit);
  }, [activeLink, options.resources, options.resourcesLoaded, location.pathname]);

  const openResourceUrl = useCallback(
    (resource: T, canEdit: boolean) => {
      const path = departmentPortalResourcePath(
        options.department,
        canEdit,
        resource.title,
        resource.id,
      );
      if (location.pathname === path) {
        onOpenRef.current(resource, canEdit);
        return;
      }
      returnPathRef.current = location.pathname;
      navigate(path);
    },
    [navigate, options.department, location.pathname],
  );

  const closeResourceUrl = useCallback(() => {
    handledRef.current = null;
    const returnTo = returnPathRef.current;
    returnPathRef.current = null;
    if (returnTo && returnTo !== location.pathname) {
      navigate(returnTo);
      return;
    }
    const fallback = options.closePath ?? departmentResourcesTabPath(options.department);
    if (location.pathname !== fallback) {
      navigate(fallback);
    }
  }, [navigate, options.closePath, options.department, location.pathname]);

  return { openResourceUrl, closeResourceUrl, activeLink };
}
