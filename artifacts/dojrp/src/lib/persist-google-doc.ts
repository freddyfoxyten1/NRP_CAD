import { readApiJson } from "./fetch-api-json";
import type { ResourceDepartment } from "./resource-type";

export type PersistedGoogleDocResource = {
  id: number;
  title: string;
  type: string;
  google_file_id: string;
  logo_url: string;
  header_config: { google_file_id: string; google_url?: string | null };
  [key: string]: unknown;
};

function collectionPath(department: ResourceDepartment): string {
  if (department === "dph") return "/api/dph/resources";
  if (department === "staff") return "/api/staff/resources";
  return "/api/resources";
}

function googleDocUrl(fileId: string, url?: string): string {
  const trimmed = url?.trim() ?? "";
  if (trimmed.includes("docs.google.com") || trimmed.includes("drive.google.com")) return trimmed;
  return `https://docs.google.com/document/d/${fileId}/edit`;
}

/** Save a Google Doc on the live resource API, then store the share-link id. */
export async function persistGoogleDocResource(input: {
  department: ResourceDepartment;
  title: string;
  createdBy?: string | null;
  fileId: string;
  url?: string;
  adminCode?: string;
  visibility?: Record<string, unknown>;
}): Promise<PersistedGoogleDocResource> {
  const path = collectionPath(input.department);
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (input.adminCode) headers["x-admin-code"] = input.adminCode;
  const google_url = googleDocUrl(input.fileId, input.url);
  const header_config = {
    google_file_id: input.fileId,
    google_url,
  };

  const createRes = await fetch(path, {
    method: "POST",
    headers,
    body: JSON.stringify({
      title: input.title,
      type: "google_doc",
      created_by: input.createdBy ?? null,
      google_file_id: input.fileId,
      google_url,
      logo_url: google_url,
      ...(input.visibility ?? {}),
    }),
  });
  const created = await readApiJson<PersistedGoogleDocResource & { error?: string }>(createRes);
  if (!createRes.ok || !created.id) {
    throw new Error(created.error ?? "Failed to save Google Doc.");
  }

  const patchRes = await fetch(`${path}/${created.id}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ header_config, logo_url: google_url }),
  });
  const patched = await readApiJson<PersistedGoogleDocResource & { error?: string }>(patchRes);
  if (!patchRes.ok) {
    throw new Error(patched.error ?? "Google Doc was created but the share link did not save.");
  }
  return {
    ...created,
    ...patched,
    id: patched.id ?? created.id,
    title: patched.title ?? created.title ?? input.title,
    type: patched.type === "pdf" ? "pdf" : "google_doc",
    google_file_id: input.fileId,
    logo_url: google_url,
    header_config,
  };
}
