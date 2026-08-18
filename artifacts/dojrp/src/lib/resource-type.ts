import { parseGoogleDocId } from "./google-doc-url";

export type ResourceKind = "document" | "pdf" | "google_doc";
export type ResourceDepartment = "dps" | "dph" | "staff";

export type ResourceLike = {
  type?: string | null;
  google_file_id?: string | null;
  logo_url?: string | null;
  header_config?: unknown;
  content?: unknown;
};

function asObject(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object") return value as Record<string, unknown>;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return null;
}

function readGoogleFileId(value: unknown): string | null {
  const obj = asObject(value);
  if (!obj) return null;
  const id = obj.google_file_id;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

export function googleFileIdFromResource(resource?: ResourceLike | null): string | null {
  if (!resource) return null;
  const direct = typeof resource.google_file_id === "string" ? resource.google_file_id.trim() : "";
  if (direct) return direct;
  const nested = readGoogleFileId(resource.header_config) ?? readGoogleFileId(resource.content);
  if (nested) return nested;
  return typeof resource.logo_url === "string" ? parseGoogleDocId(resource.logo_url) : null;
}

export function isPdfLikeResource(typeOrResource?: string | null | ResourceLike): boolean {
  if (typeOrResource == null) return false;
  if (typeof typeOrResource === "string") {
    return typeOrResource === "pdf" || typeOrResource === "google_doc";
  }
  const type = typeOrResource.type ?? null;
  if (type === "pdf" || type === "google_doc") return true;
  return Boolean(googleFileIdFromResource(typeOrResource));
}

export function resourceTypeLabel(typeOrResource?: string | null | ResourceLike): string {
  if (typeOrResource && typeof typeOrResource === "object") {
    if (typeOrResource.type === "pdf") return "PDF";
    if (typeOrResource.type === "google_doc" || googleFileIdFromResource(typeOrResource)) return "Google Doc";
    return "Document";
  }
  if (typeOrResource === "pdf") return "PDF";
  if (typeOrResource === "google_doc") return "Google Doc";
  return "Document";
}

/** Live Google Doc PDF via share-link export (preview proxies `/api/google` locally). */
export function resourceFileUrl(
  department: ResourceDepartment,
  id: number,
  typeOrResource?: string | null | ResourceLike,
): string {
  const resource = typeOrResource && typeof typeOrResource === "object" ? typeOrResource : { type: typeOrResource };
  const type = resource.type ?? (typeof typeOrResource === "string" ? typeOrResource : null);
  const fileId = googleFileIdFromResource(resource);
  if (fileId) return `/api/google/export?file_id=${encodeURIComponent(fileId)}`;
  if (type === "google_doc") return `/api/google/file/${department}/${id}`;
  if (department === "dph") return `/api/dph/resources/${id}/file`;
  if (department === "staff") return `/api/staff/resources/${id}/file`;
  return `/api/resources/${id}/file`;
}
