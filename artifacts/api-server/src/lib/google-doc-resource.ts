/**
 * Live Google Doc resources: store a Drive file ID + integration, export PDF on demand.
 */
import type { Request, Response } from "express";
import {
  isMongoStore,
  pool,
  resourcesRepo,
  googleIntegrationsRepo,
} from "@workspace/db";
import type { ResourceDepartment } from "@workspace/db";
import {
  exportGoogleDocPdf,
  exportSharedGoogleDocPdf,
  getGoogleDocMeta,
  GoogleAuthError,
  isTokenExpired,
  parseGoogleDocId,
  refreshGoogleAccessToken,
  tokenExpiryIso,
  type GoogleHttp,
} from "./google-oauth";

export const GOOGLE_DOC_CACHE_TTL_MS = 30_000;
const CACHE_MAX = 32;

type PdfCacheEntry = {
  key: string;
  revision: string;
  pdf: Buffer;
  fetchedAt: number;
};

const pdfCache = new Map<string, PdfCacheEntry>();

export type GoogleResourceVisibility = {
  division_id?: number | null;
  division_only?: boolean;
  allowed_ranks?: unknown;
  personnel_only?: boolean;
  allowed_dps_ranks?: unknown;
  allowed_dph_ranks?: unknown;
};

export type CreatedGoogleResource = {
  id: number;
  title: string;
  type: "google_doc";
  google_file_id: string;
  google_modified_time: string | null;
  created_by: string | null;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
};

function parseRankList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map(s => s.trim()).filter(Boolean);
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (Array.isArray(parsed)) return parsed.map(String).map(s => s.trim()).filter(Boolean);
    } catch { /* ignore */ }
  }
  return [];
}

export function sanitizeResourceForClient<T extends Record<string, unknown>>(
  row: T,
  opts: { public?: boolean } = {},
): T {
  const next = { ...row } as T & Record<string, unknown>;
  delete next.refresh_token;
  delete next.access_token;
  delete next.token_expiry;
  delete next.google_refresh_token;
  delete next.google_access_token;
  delete next.google_token_expiry;
  delete next.file_data;
  delete next.gridFsId;
  if (opts.public) {
    delete next.google_integration_id;
  }
  return next as T;
}

export function isGoogleDocType(type: unknown): boolean {
  return type === "google_doc";
}

function cacheKey(department: ResourceDepartment, id: number): string {
  return `${department}:${id}`;
}

export function cachedPdfIfFresh(
  cached: { revision: string; pdf: Buffer; fetchedAt: number } | undefined,
  revision: string,
  now = Date.now(),
): Buffer | null {
  if (!cached) return null;
  if (cached.revision !== revision) return null;
  if (now - cached.fetchedAt >= GOOGLE_DOC_CACHE_TTL_MS) return null;
  return cached.pdf;
}

export function clearGoogleDocCache(department?: ResourceDepartment, id?: number): void {
  if (department != null && id != null) {
    pdfCache.delete(cacheKey(department, id));
    return;
  }
  pdfCache.clear();
}

function rememberPdf(entry: PdfCacheEntry): void {
  pdfCache.set(entry.key, entry);
  if (pdfCache.size <= CACHE_MAX) return;
  const oldest = [...pdfCache.values()].sort((a, b) => a.fetchedAt - b.fetchedAt)[0];
  if (oldest) pdfCache.delete(oldest.key);
}

async function loadIntegration(id: number) {
  if (isMongoStore()) {
    return googleIntegrationsRepo.getGoogleIntegration(id);
  }
  const { rows } = await pool.query(
    `SELECT id, created_by, email, google_user_id, refresh_token, access_token, token_expiry
       FROM google_integrations WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

async function saveIntegrationTokens(
  id: number,
  accessToken: string,
  tokenExpiry: string,
  refreshToken?: string,
): Promise<void> {
  if (isMongoStore()) {
    await googleIntegrationsRepo.updateGoogleIntegrationTokens(id, {
      access_token: accessToken,
      token_expiry: tokenExpiry,
      ...(refreshToken ? { refresh_token: refreshToken } : {}),
    });
    return;
  }
  await pool.query(
    `UPDATE google_integrations
        SET access_token = $2, token_expiry = $3, refresh_token = COALESCE($4, refresh_token), updated_at = NOW()
      WHERE id = $1`,
    [id, accessToken, tokenExpiry, refreshToken ?? null],
  );
}

export async function accessTokenForIntegration(
  integrationId: number,
  http?: GoogleHttp,
): Promise<string> {
  const integration = await loadIntegration(integrationId);
  if (!integration) {
    throw new GoogleAuthError("This Google account is no longer connected.", "revoked", 401);
  }
  const access = String(integration.access_token ?? "");
  const refresh = String(integration.refresh_token ?? "");
  if (access && !isTokenExpired(String(integration.token_expiry ?? ""))) {
    return access;
  }
  const tokens = await refreshGoogleAccessToken(refresh, http);
  if (!tokens.access_token) {
    throw new GoogleAuthError("Google access expired. Reconnect your Google account.", "token_expired", 401);
  }
  await saveIntegrationTokens(
    integrationId,
    tokens.access_token,
    tokenExpiryIso(tokens.expires_in),
    tokens.refresh_token,
  );
  return tokens.access_token;
}

function visibilityForDepartment(
  department: ResourceDepartment,
  visibility: GoogleResourceVisibility,
): {
  divisionId: number | null;
  divisionOnly: boolean;
  allowedRanks: string[];
  personnelOnly: boolean;
  allowedDpsRanks: string[];
  allowedDphRanks: string[];
} {
  const divisionId =
    visibility.division_id == null
      ? null
      : (Number.isInteger(visibility.division_id) && visibility.division_id > 0 ? visibility.division_id : null);
  const allowedRanks = parseRankList(visibility.allowed_ranks);
  const allowedDpsRanks = parseRankList(visibility.allowed_dps_ranks);
  const allowedDphRanks = parseRankList(visibility.allowed_dph_ranks);
  const divisionOnly = divisionId != null ? Boolean(visibility.division_only) : false;
  const personnelOnly = divisionId == null
    ? Boolean(visibility.personnel_only) || (department === "dph" ? allowedDphRanks.length > 0 : allowedDpsRanks.length > 0)
    : false;
  return {
    divisionId,
    divisionOnly,
    allowedRanks,
    personnelOnly,
    allowedDpsRanks: department === "dps" && divisionId == null ? allowedDpsRanks : [],
    allowedDphRanks: department === "dph" && divisionId == null ? allowedDphRanks : [],
  };
}

export async function createGoogleDocResource(input: {
  department: ResourceDepartment;
  title?: string;
  created_by?: string | null;
  google_file_id?: string;
  google_url?: string;
  google_integration_id?: number | null;
  visibility?: GoogleResourceVisibility;
  http?: GoogleHttp;
}): Promise<CreatedGoogleResource> {
  const fileId = parseGoogleDocId(input.google_file_id ?? input.google_url ?? "");
  if (!fileId) {
    throw new GoogleAuthError("Provide a Google Doc share link.", "invalid", 400);
  }
  const integrationId =
    Number.isInteger(input.google_integration_id) && (input.google_integration_id ?? 0) > 0
      ? Number(input.google_integration_id)
      : null;

  let title = (input.title?.trim() || "Google Doc").trim();
  let modifiedTime: string | null = new Date().toISOString();
  if (integrationId != null) {
    const accessToken = await accessTokenForIntegration(integrationId, input.http);
    const meta = await getGoogleDocMeta(accessToken, fileId, input.http);
    title = (input.title?.trim() || meta.name || "Google Doc").trim();
    modifiedTime = meta.modifiedTime;
  } else {
    await exportSharedGoogleDocPdf(fileId, input.http);
  }
  const vis = visibilityForDepartment(input.department, input.visibility ?? {});

  if (isMongoStore()) {
    const row = await resourcesRepo.insertResource(input.department, {
      title,
      type: "google_doc",
      created_by: input.created_by ?? null,
      google_file_id: fileId,
      google_integration_id: integrationId,
      google_modified_time: modifiedTime,
      division_id: vis.divisionId,
      division_only: vis.divisionOnly,
      allowed_ranks: JSON.stringify(vis.allowedRanks),
      personnel_only: vis.personnelOnly,
      allowed_dps_ranks: JSON.stringify(vis.allowedDpsRanks),
      allowed_dph_ranks: JSON.stringify(vis.allowedDphRanks),
    } as Parameters<typeof resourcesRepo.insertResource>[1]);
    return sanitizeResourceForClient({
      ...row,
      type: "google_doc",
      google_file_id: fileId,
      google_modified_time: modifiedTime,
      division_only: vis.divisionOnly,
      allowed_ranks: vis.allowedRanks,
      personnel_only: vis.personnelOnly,
      allowed_dps_ranks: vis.allowedDpsRanks,
      allowed_dph_ranks: vis.allowedDphRanks,
    }) as CreatedGoogleResource;
  }

  const table =
    input.department === "staff" ? "staff_resources"
      : input.department === "dph" ? "dph_resources"
        : "dps_resources";

  if (input.department === "staff") {
    const { rows } = await pool.query(
      `INSERT INTO staff_resources
         (title, type, created_by, google_file_id, google_integration_id, google_modified_time)
       VALUES ($1, 'google_doc', $2, $3, $4, $5)
       RETURNING id, title, type, logo_url, created_by, created_at, updated_at, google_file_id, google_modified_time`,
      [title, input.created_by ?? null, fileId, integrationId, modifiedTime],
    );
    return sanitizeResourceForClient(rows[0] as Record<string, unknown>) as CreatedGoogleResource;
  }

  if (input.department === "dph") {
    const { rows } = await pool.query(
      `INSERT INTO ${table}
         (title, type, created_by, google_file_id, google_integration_id, google_modified_time,
          division_id, division_only, allowed_ranks, personnel_only, allowed_dph_ranks)
       VALUES ($1, 'google_doc', $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, title, type, logo_url, created_by, created_at, updated_at, division_id,
                 division_only, allowed_ranks, personnel_only, allowed_dph_ranks,
                 google_file_id, google_modified_time`,
      [
        title,
        input.created_by ?? null,
        fileId,
        integrationId,
        modifiedTime,
        vis.divisionId,
        vis.divisionOnly,
        JSON.stringify(vis.allowedRanks),
        vis.personnelOnly,
        JSON.stringify(vis.allowedDphRanks),
      ],
    );
    const row = rows[0] as Record<string, unknown>;
    return sanitizeResourceForClient({
      ...row,
      division_only: Boolean(row.division_only),
      allowed_ranks: vis.allowedRanks,
      personnel_only: Boolean(row.personnel_only),
      allowed_dph_ranks: vis.allowedDphRanks,
    }) as unknown as CreatedGoogleResource;
  }

  const { rows } = await pool.query(
    `INSERT INTO dps_resources
       (title, type, created_by, google_file_id, google_integration_id, google_modified_time,
        division_id, division_only, allowed_ranks, personnel_only, allowed_dps_ranks)
     VALUES ($1, 'google_doc', $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id, title, type, logo_url, created_by, created_at, updated_at, division_id,
               division_only, allowed_ranks, personnel_only, allowed_dps_ranks,
               google_file_id, google_modified_time`,
    [
      title,
      input.created_by ?? null,
      fileId,
      integrationId,
      modifiedTime,
      vis.divisionId,
      vis.divisionOnly,
      JSON.stringify(vis.allowedRanks),
      vis.personnelOnly,
      JSON.stringify(vis.allowedDpsRanks),
    ],
  );
  const row = rows[0] as Record<string, unknown>;
  return sanitizeResourceForClient({
    ...row,
    division_only: Boolean(row.division_only),
    allowed_ranks: vis.allowedRanks,
    personnel_only: Boolean(row.personnel_only),
    allowed_dps_ranks: vis.allowedDpsRanks,
  }) as unknown as CreatedGoogleResource;
}

async function loadResourceRow(department: ResourceDepartment, id: number): Promise<Record<string, unknown> | null> {
  if (isMongoStore()) {
    const row = await resourcesRepo.getResource(department, id);
    return row as Record<string, unknown> | null;
  }
  const table =
    department === "staff" ? "staff_resources"
      : department === "dph" ? "dph_resources"
        : "dps_resources";
  const { rows } = await pool.query(
    `SELECT id, title, type, google_file_id, google_integration_id, google_modified_time
       FROM ${table} WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

async function persistModifiedTime(
  department: ResourceDepartment,
  id: number,
  modifiedTime: string,
): Promise<void> {
  if (isMongoStore()) {
    await resourcesRepo.updateResource(department, id, { google_modified_time: modifiedTime } as never);
    return;
  }
  const table =
    department === "staff" ? "staff_resources"
      : department === "dph" ? "dph_resources"
        : "dps_resources";
  await pool.query(`UPDATE ${table} SET google_modified_time = $2, updated_at = NOW() WHERE id = $1`, [id, modifiedTime]);
}

export async function loadLiveGoogleDocPdf(
  department: ResourceDepartment,
  id: number,
  opts: { ifNoneMatch?: string; http?: GoogleHttp } = {},
): Promise<{ pdf: Buffer; revision: string; title: string; notModified?: boolean }> {
  const row = await loadResourceRow(department, id);
  if (!row || !isGoogleDocType(row.type)) {
    throw new GoogleAuthError("Not a Google Doc resource.", "invalid", 404);
  }
  const fileId = String(row.google_file_id ?? "");
  if (!fileId) {
    throw new GoogleAuthError("This Google Doc resource is missing its document link.", "invalid", 422);
  }
  const integrationId = Number(row.google_integration_id);
  const hasIntegration = Number.isInteger(integrationId) && integrationId > 0;
  const key = cacheKey(department, id);
  const cached = pdfCache.get(key);

  if (!hasIntegration) {
    const revision = `share:${fileId}`;
    const etag = `"${revision}"`;
    if (opts.ifNoneMatch && opts.ifNoneMatch === etag) {
      return { pdf: cached?.pdf ?? Buffer.alloc(0), revision, title: String(row.title ?? "Google Doc"), notModified: true };
    }
    const fresh = cachedPdfIfFresh(cached, revision);
    if (fresh) {
      return { pdf: fresh, revision, title: String(row.title ?? "Google Doc") };
    }
    const pdf = await exportSharedGoogleDocPdf(fileId, opts.http);
    rememberPdf({ key, revision, pdf, fetchedAt: Date.now() });
    return { pdf, revision, title: String(row.title ?? "Google Doc") };
  }

  const accessToken = await accessTokenForIntegration(integrationId, opts.http);
  const meta = await getGoogleDocMeta(accessToken, fileId, opts.http);
  const revision = meta.headRevisionId || meta.modifiedTime;
  const etag = `"${revision}"`;

  if (opts.ifNoneMatch && opts.ifNoneMatch === etag) {
    return { pdf: cached?.pdf ?? Buffer.alloc(0), revision, title: String(row.title ?? meta.name), notModified: true };
  }
  const fresh = cachedPdfIfFresh(cached, revision);
  if (fresh) {
    return { pdf: fresh, revision, title: String(row.title ?? meta.name) };
  }

  const pdf = await exportGoogleDocPdf(accessToken, fileId, opts.http);
  rememberPdf({ key, revision, pdf, fetchedAt: Date.now() });
  if (meta.modifiedTime && meta.modifiedTime !== row.google_modified_time) {
    await persistModifiedTime(department, id, meta.modifiedTime).catch(() => undefined);
  }
  return { pdf, revision, title: String(row.title ?? meta.name) };
}

export function sendGoogleAuthError(res: Response, err: unknown): void {
  if (err instanceof GoogleAuthError) {
    res.status(err.httpStatus).json({ error: err.message, code: err.code });
    return;
  }
  res.status(500).json({ error: "Failed to load Google Doc.", code: "unavailable" });
}

/** Serve a live Google Doc as PDF. Returns true when this resource was handled. */
export async function tryServeGoogleDocFile(
  req: Request,
  res: Response,
  department: ResourceDepartment,
  id: number,
): Promise<boolean> {
  const row = await loadResourceRow(department, id);
  if (!row) return false;
  if (!isGoogleDocType(row.type)) return false;

  try {
    const result = await loadLiveGoogleDocPdf(department, id, {
      ifNoneMatch: typeof req.headers["if-none-match"] === "string" ? req.headers["if-none-match"] : undefined,
    });
    if (result.notModified) {
      res.status(304).end();
      return true;
    }
    const safeName = result.title.replace(/[^\w\- ]+/g, "").trim() || "google-doc";
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${safeName}.pdf"`);
    res.setHeader("Cache-Control", "private, max-age=15, must-revalidate");
    res.setHeader("ETag", `"${result.revision}"`);
    res.setHeader("X-Google-Revision", result.revision);
    res.send(result.pdf);
  } catch (err) {
    sendGoogleAuthError(res, err);
  }
  return true;
}
