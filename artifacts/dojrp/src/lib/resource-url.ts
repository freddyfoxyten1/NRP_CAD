export type ResourceLinkDepartment = "dps" | "dph" | "staff";
export type ResourceLinkMode = "public" | "edit";

export type ResourceLinkTarget = {
  id: number;
  title: string;
};

export type ParsedResourcePath = {
  department: ResourceLinkDepartment;
  mode: ResourceLinkMode;
  linkSlug: string;
  /** `/dps_resources-{slug}` — always renders the department page, not PublicView. */
  inApp?: boolean;
};

const PUBLIC_PREFIX = "public_resource_";
const EDIT_PREFIX = "edit_resource_";
const IN_APP_RESOURCES_PREFIX = "resources-";

/** URL-safe slug from a resource title (e.g. "SOP Manual" → "sop-manual"). */
export function slugifyResourceTitle(title: string): string {
  return (
    title
      .toLowerCase()
      .trim()
      .replace(/['"]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "resource"
  );
}

/** Stable link slug: `{title-slug}-{id}` (e.g. `sop-manual-91`). */
export function resourceLinkSlug(title: string, id: number): string {
  return `${slugifyResourceTitle(title)}-${id}`;
}

export function parseResourceLinkSlug(linkSlug: string): { nameSlug: string; id: number | null } {
  const match = linkSlug.match(/^(.*)-(\d+)$/);
  if (!match) return { nameSlug: linkSlug, id: null };
  const id = Number(match[2]);
  if (!Number.isInteger(id) || id <= 0) return { nameSlug: linkSlug, id: null };
  return { nameSlug: match[1], id };
}

export function departmentResourcePath(
  department: ResourceLinkDepartment,
  mode: ResourceLinkMode,
  title: string,
  id: number,
): string {
  const prefix = mode === "public" ? PUBLIC_PREFIX : EDIT_PREFIX;
  return `/${department}_${prefix}${resourceLinkSlug(title, id)}`;
}

/** In-app DPS/DPH resource view — stays on the department route (never PublicView). */
export function departmentInAppResourcePath(
  department: "dps" | "dph",
  title: string,
  id: number,
): string {
  return `/${department}_${IN_APP_RESOURCES_PREFIX}${resourceLinkSlug(title, id)}`;
}

export function departmentResourcesTabPath(department: ResourceLinkDepartment): string {
  return `/${department}_resources`;
}

/** Path used when a logged-in member opens a resource inside a department portal. */
export function departmentPortalResourcePath(
  department: ResourceLinkDepartment,
  canEdit: boolean,
  title: string,
  id: number,
): string {
  if (department === "dps" || department === "dph") {
    return departmentInAppResourcePath(department, title, id);
  }
  return departmentResourcePath(
    department,
    department === "staff" && !canEdit ? "public" : "edit",
    title,
    id,
  );
}

/** @deprecated Use departmentPortalResourcePath — kept for tests. */
export function inAppResourceUrlMode(department: ResourceLinkDepartment, canEdit: boolean): ResourceLinkMode {
  if (department === "staff" && !canEdit) return "public";
  return "edit";
}

export function parseResourceSection(section: string): Omit<ParsedResourcePath, "department"> | null {
  if (section.startsWith(IN_APP_RESOURCES_PREFIX)) {
    const linkSlug = section.slice(IN_APP_RESOURCES_PREFIX.length);
    return linkSlug ? { mode: "public", linkSlug, inApp: true } : null;
  }
  if (section.startsWith(PUBLIC_PREFIX)) {
    const linkSlug = section.slice(PUBLIC_PREFIX.length);
    return linkSlug ? { mode: "public", linkSlug } : null;
  }
  if (section.startsWith(EDIT_PREFIX)) {
    const linkSlug = section.slice(EDIT_PREFIX.length);
    return linkSlug ? { mode: "edit", linkSlug } : null;
  }
  return null;
}

/** Parse `/dps_public_resource_sop-manual-91` and `/dps_resources-sop-manual-91` style paths. */
export function parseResourcePathname(pathname: string): ParsedResourcePath | null {
  const raw = pathname.replace(/\/+$/, "") || "/";

  const inApp = raw.match(/^\/(dps|dph)_resources-(.+)$/);
  if (inApp?.[2]?.trim()) {
    return {
      department: inApp[1] as ResourceLinkDepartment,
      mode: "public",
      linkSlug: inApp[2].trim(),
      inApp: true,
    };
  }

  const match = raw.match(/^\/(dps|dph|staff)_(public_resource_|edit_resource_)(.+)$/);
  if (!match) return null;
  const linkSlug = match[3]?.trim();
  if (!linkSlug) return null;
  return {
    department: match[1] as ResourceLinkDepartment,
    mode: match[2] === PUBLIC_PREFIX ? "public" : "edit",
    linkSlug,
  };
}

export function isResourceSection(section: string | undefined): boolean {
  if (!section) return false;
  return section.startsWith(IN_APP_RESOURCES_PREFIX)
    || section.startsWith(PUBLIC_PREFIX)
    || section.startsWith(EDIT_PREFIX);
}

export function findResourceByLinkSlug<T extends ResourceLinkTarget>(
  resources: T[],
  linkSlug: string,
): T | null {
  const { id, nameSlug } = parseResourceLinkSlug(linkSlug);
  if (id != null) {
    const byId = resources.find(r => r.id === id);
    if (byId) return byId;
  }
  const normalized = nameSlug.toLowerCase();
  return resources.find(r => slugifyResourceTitle(r.title) === normalized) ?? null;
}

export function isDepartmentPortalResourceSection(section: string | undefined): boolean {
  return Boolean(section?.startsWith(IN_APP_RESOURCES_PREFIX));
}
