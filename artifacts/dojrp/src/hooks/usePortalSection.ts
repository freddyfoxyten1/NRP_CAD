import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";

/** Build a shareable portal section path: `/dps_information`, `/admin_members`, … */
export function portalSectionPath(base: string, section: string): string {
  return `/${base}_${section}`;
}

/** Nested section path: `/dps_department-panel-personnel`, `/admin_logs-members`. */
export function nestedPortalSectionPath(
  base: string,
  parent: string,
  nested: string | null | undefined,
): string {
  if (!nested) return portalSectionPath(base, parent);
  return portalSectionPath(base, `${parent}-${nested}`);
}

export function parseNestedPortalSection(
  section: string | undefined,
  parent: string,
): { isParent: boolean; nested: string | null } {
  if (!section) return { isParent: false, nested: null };
  if (section === parent) return { isParent: true, nested: null };
  const prefix = `${parent}-`;
  if (section.startsWith(prefix)) {
    return { isParent: true, nested: section.slice(prefix.length) || null };
  }
  return { isParent: false, nested: null };
}

/** Read the section id from `/base_section` (React Router cannot param-match mid-segment). */
export function sectionFromPathname(pathname: string, base: string): string | undefined {
  const raw = pathname.replace(/\/+$/, "") || "/";
  if (raw === `/${base}`) return undefined;
  const prefix = `/${base}_`;
  if (!raw.startsWith(prefix)) return undefined;
  const section = raw.slice(prefix.length);
  return section || undefined;
}

/**
 * Syncs the active portal section with the URL.
 * Prefers `/base_section` paths; still accepts legacy `?tab=` and redirects.
 */
export function usePortalSection<T extends string>(options: {
  base: string;
  valid: readonly T[];
  defaultSection: T;
  /**
   * Extra section ids that should resolve to a parent section (e.g. `logs-members` → `logs`).
   * When provided, `resolveParent` maps the raw URL section to the parent tab id.
   */
  resolveParent?: (rawSection: string) => T | null;
}): [T, (next: T) => void, string | undefined] {
  const { base, valid, defaultSection, resolveParent } = options;
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();

  const validSet = useMemo(() => new Set<string>(valid), [valid]);
  const rawSection = useMemo(
    () => sectionFromPathname(location.pathname, base),
    [location.pathname, base],
  );

  const resolve = useCallback((): T => {
    if (rawSection) {
      if (validSet.has(rawSection)) return rawSection as T;
      if (resolveParent) {
        const parent = resolveParent(rawSection);
        if (parent && validSet.has(parent)) return parent;
      }
    }

    const legacy = searchParams.get("tab")?.trim();
    if (legacy && validSet.has(legacy)) return legacy as T;

    return defaultSection;
  }, [rawSection, searchParams, validSet, defaultSection, resolveParent]);

  const [section, setSectionState] = useState<T>(resolve);

  useEffect(() => {
    const next = resolve();
    setSectionState(next);

    const legacy = searchParams.get("tab")?.trim();
    if (legacy && validSet.has(legacy)) {
      navigate(portalSectionPath(base, legacy), { replace: true });
      return;
    }

    const onBareBase = location.pathname === `/${base}` || location.pathname === `/${base}/`;
    if (onBareBase) {
      navigate(portalSectionPath(base, next), { replace: true });
    }
  }, [
    resolve,
    searchParams,
    validSet,
    navigate,
    base,
    location.pathname,
  ]);

  const setSection = useCallback(
    (next: T) => {
      if (!validSet.has(next)) return;
      setSectionState(next);
      navigate(portalSectionPath(base, next));
    },
    [navigate, base, validSet],
  );

  return [section, setSection, rawSection];
}
