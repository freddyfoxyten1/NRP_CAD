/**
 * Google OAuth + Drive helpers for live Google Doc resources.
 * Tokens stay on the server. Public preview never receives credentials.
 */
import { randomBytes } from "node:crypto";

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/drive.readonly",
].join(" ");

export const GOOGLE_DOC_MIME = "application/vnd.google-apps.document";

export type GoogleAuthErrorCode =
  | "not_configured"
  | "oauth_failed"
  | "oauth_cancelled"
  | "token_expired"
  | "revoked"
  | "not_found"
  | "forbidden"
  | "rate_limited"
  | "unavailable"
  | "invalid"
  | "parse_failed";

export class GoogleAuthError extends Error {
  readonly code: GoogleAuthErrorCode;
  readonly httpStatus: number;

  constructor(message: string, code: GoogleAuthErrorCode, httpStatus = 400) {
    super(message);
    this.name = "GoogleAuthError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export type GoogleTokens = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
};

export type GoogleAccount = {
  id: string;
  email: string;
};

export type GoogleDocMeta = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  trashed?: boolean;
  headRevisionId?: string;
};

export type GoogleDocListItem = {
  id: string;
  name: string;
  modifiedTime: string;
};

const PREVIEW_OAUTH_PORTS = new Set(["4173", "5173"]);
const PREVIEW_REDIRECT_URIS = new Set([
  "http://localhost:4173/dojcad/google-callback",
  "http://localhost:5173/dojcad/google-callback",
]);

type PendingOAuth = { createdBy: string | null; createdAt: number };
const pendingOauth = new Map<string, PendingOAuth>();
const PENDING_TTL_MS = 10 * 60_000;

function prunePending(): void {
  const cutoff = Date.now() - PENDING_TTL_MS;
  for (const [key, value] of pendingOauth) {
    if (value.createdAt < cutoff) pendingOauth.delete(key);
  }
}

export function createOAuthState(createdBy?: string | null): string {
  prunePending();
  const state = randomBytes(16).toString("hex");
  pendingOauth.set(state, { createdBy: createdBy?.trim() || null, createdAt: Date.now() });
  return state;
}

export function takeOAuthState(state: string): PendingOAuth | null {
  prunePending();
  const pending = pendingOauth.get(state);
  if (!pending) return null;
  pendingOauth.delete(state);
  return pending;
}

export function googleClientConfig(): { clientId: string; clientSecret: string } {
  const clientId = (process.env.GOOGLE_CLIENT_ID ?? "").trim();
  const clientSecret = (process.env.GOOGLE_CLIENT_SECRET ?? "").trim();
  if (!clientId || !clientSecret) {
    throw new GoogleAuthError(
      "Google Docs is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
      "not_configured",
      503,
    );
  }
  return { clientId, clientSecret };
}

function isLocalBrowserHost(host: string): boolean {
  const lower = host.toLowerCase();
  return lower.startsWith("localhost") || lower.startsWith("127.0.0.1") || lower.startsWith("[::1]");
}

function normalizeBrowserHost(host: string): string {
  const lower = host.toLowerCase();
  if (lower.startsWith("127.0.0.1:")) return `localhost${host.slice("127.0.0.1".length)}`;
  if (lower === "127.0.0.1") return "localhost";
  if (lower.startsWith("[::1]:")) return `localhost${host.slice("[::1]".length)}`;
  if (lower === "[::1]") return "localhost";
  return host;
}

export function getGoogleRedirectUri(req: {
  headers: { host?: string; "x-forwarded-host"?: string | string[]; "x-forwarded-proto"?: string | string[] };
}): string {
  const forwardedHost = (Array.isArray(req.headers["x-forwarded-host"])
    ? req.headers["x-forwarded-host"][0]
    : req.headers["x-forwarded-host"])
    ?.split(",")[0]
    .trim();
  const host = normalizeBrowserHost(forwardedHost || req.headers.host || "");
  const isProd = (process.env.NODE_ENV ?? "").trim().toLowerCase() === "production";
  const envUri = (process.env.GOOGLE_REDIRECT_URI ?? "").trim();

  if (host && isLocalBrowserHost(host)) {
    const port = host.includes(":") ? host.split(":").pop() ?? "" : "";
    if (!isProd || PREVIEW_OAUTH_PORTS.has(port)) {
      return `http://${host}/dojcad/google-callback`;
    }
  }
  if (host.toLowerCase() === "cad.dojrblx.com") {
    return "https://cad.dojrblx.com/dojcad/google-callback";
  }
  if (envUri) return envUri;
  throw new GoogleAuthError("Cannot determine Google OAuth redirect URI.", "not_configured", 503);
}

export function resolveGoogleRedirectUri(req: Parameters<typeof getGoogleRedirectUri>[0], explicit?: string): string {
  const trimmed = (explicit ?? "").trim();
  if (trimmed && PREVIEW_REDIRECT_URIS.has(trimmed)) return trimmed;
  if (trimmed && trimmed === (process.env.GOOGLE_REDIRECT_URI ?? "").trim()) return trimmed;
  return getGoogleRedirectUri(req);
}

export function buildGoogleAuthUrl(redirectUri: string, state: string): string {
  const { clientId } = googleClientConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export function parseGoogleDocId(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  const fromDocs = raw.match(/docs\.google\.com\/document\/(?:u\/\d+\/)?d\/([a-zA-Z0-9_-]+)/);
  if (fromDocs?.[1] && fromDocs[1] !== "e") return fromDocs[1];
  const fromDrive = raw.match(/drive\.google\.com\/(?:file\/d\/|open\?id=)([a-zA-Z0-9_-]+)/);
  if (fromDrive?.[1]) return fromDrive[1];
  if (/^[a-zA-Z0-9_-]{20,}$/.test(raw)) return raw;
  return null;
}

export function sharedGoogleDocExportUrl(fileId: string): string {
  return `https://docs.google.com/document/d/${encodeURIComponent(fileId)}/export?format=pdf`;
}

/** Public export — works when the Doc is shared as Anyone with the link. */
export async function exportSharedGoogleDocPdf(
  fileId: string,
  http: GoogleHttp = defaultHttp,
): Promise<Buffer> {
  const res = await http(sharedGoogleDocExportUrl(fileId), {
    headers: { accept: "application/pdf,*/*" },
    redirect: "follow",
  });
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length >= 5 && bytes.subarray(0, 4).toString() === "%PDF") {
    return bytes;
  }
  const head = bytes.subarray(0, 800).toString("utf8");
  if (
    res.status === 401
    || res.status === 403
    || /accounts\.google|ServiceLogin|request access|Sign in/i.test(head)
  ) {
    throw new GoogleAuthError(
      "This Google Doc is not shared. In Google Docs open Share → General access → Anyone with the link → Viewer.",
      "forbidden",
      403,
    );
  }
  if (res.status === 404) {
    throw new GoogleAuthError("That Google Doc was deleted or no longer exists.", "not_found", 404);
  }
  throw new GoogleAuthError(
    "Could not open that share link. Share the Doc as Anyone with the link can view.",
    "forbidden",
    403,
  );
}

export type GoogleHttp = (url: string, init?: RequestInit) => Promise<Response>;

const defaultHttp: GoogleHttp = (url, init) => fetch(url, init);

function mapGoogleHttpError(status: number, body: string): GoogleAuthError {
  if (status === 401) {
    return new GoogleAuthError("Google access expired. Reconnect your Google account.", "token_expired", 401);
  }
  if (status === 403) {
    if (/rate|quota|userRateLimitExceeded/i.test(body)) {
      return new GoogleAuthError("Google is rate-limiting requests. Try again shortly.", "rate_limited", 429);
    }
    return new GoogleAuthError("This Google account cannot access that document.", "forbidden", 403);
  }
  if (status === 404) {
    return new GoogleAuthError("That Google Doc was deleted or no longer exists.", "not_found", 404);
  }
  if (status === 429) {
    return new GoogleAuthError("Google is rate-limiting requests. Try again shortly.", "rate_limited", 429);
  }
  if (status >= 500) {
    return new GoogleAuthError("Google Docs is temporarily unavailable.", "unavailable", 502);
  }
  return new GoogleAuthError("Google request failed.", "oauth_failed", status >= 400 ? status : 400);
}

async function readGoogleJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!res.ok) {
    throw mapGoogleHttpError(res.status, text);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new GoogleAuthError("Google returned an unexpected response.", "parse_failed", 502);
  }
}

export async function exchangeGoogleCode(
  code: string,
  redirectUri: string,
  http: GoogleHttp = defaultHttp,
): Promise<GoogleTokens & { account: GoogleAccount }> {
  const { clientId, clientSecret } = googleClientConfig();
  const tokenRes = await http("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
  });
  const tokens = await readGoogleJson<GoogleTokens>(tokenRes);
  if (!tokens.access_token) {
    throw new GoogleAuthError("Google did not return an access token.", "oauth_failed", 400);
  }

  const userRes = await http("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const profile = await readGoogleJson<{ id?: string; email?: string }>(userRes);
  if (!profile.id || !profile.email) {
    throw new GoogleAuthError("Google did not return account details.", "oauth_failed", 400);
  }
  return { ...tokens, account: { id: profile.id, email: profile.email } };
}

export async function refreshGoogleAccessToken(
  refreshToken: string,
  http: GoogleHttp = defaultHttp,
): Promise<GoogleTokens> {
  if (!refreshToken.trim()) {
    throw new GoogleAuthError("Google access was revoked. Reconnect your Google account.", "revoked", 401);
  }
  const { clientId, clientSecret } = googleClientConfig();
  const tokenRes = await http("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (tokenRes.status === 400 || tokenRes.status === 401) {
    const text = await tokenRes.text();
    if (/invalid_grant|revoked/i.test(text)) {
      throw new GoogleAuthError("Google access was revoked. Reconnect your Google account.", "revoked", 401);
    }
    throw new GoogleAuthError("Google access expired. Reconnect your Google account.", "token_expired", 401);
  }
  return readGoogleJson<GoogleTokens>(tokenRes);
}

export function tokenExpiryIso(expiresInSec?: number): string {
  const ms = Math.max(30, (expiresInSec ?? 3600) - 60) * 1000;
  return new Date(Date.now() + ms).toISOString();
}

export function isTokenExpired(expiryIso?: string | null): boolean {
  if (!expiryIso) return true;
  const ts = Date.parse(expiryIso);
  return !Number.isFinite(ts) || ts <= Date.now();
}

export async function listGoogleDocs(
  accessToken: string,
  http: GoogleHttp = defaultHttp,
): Promise<GoogleDocListItem[]> {
  const params = new URLSearchParams({
    q: `mimeType='${GOOGLE_DOC_MIME}' and trashed=false`,
    pageSize: "50",
    fields: "files(id,name,modifiedTime)",
    orderBy: "modifiedTime desc",
    spaces: "drive",
    includeItemsFromAllDrives: "true",
    supportsAllDrives: "true",
    corpora: "user",
  });
  const res = await http(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await readGoogleJson<{ files?: GoogleDocListItem[] }>(res);
  return Array.isArray(data.files) ? data.files : [];
}

export async function getGoogleDocMeta(
  accessToken: string,
  fileId: string,
  http: GoogleHttp = defaultHttp,
): Promise<GoogleDocMeta> {
  const params = new URLSearchParams({
    fields: "id,name,mimeType,modifiedTime,trashed,headRevisionId",
    supportsAllDrives: "true",
  });
  const res = await http(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?${params.toString()}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const meta = await readGoogleJson<GoogleDocMeta>(res);
  if (meta.trashed) {
    throw new GoogleAuthError("That Google Doc was deleted or no longer exists.", "not_found", 404);
  }
  if (meta.mimeType && meta.mimeType !== GOOGLE_DOC_MIME) {
    throw new GoogleAuthError("That file is not a Google Doc.", "invalid", 400);
  }
  return meta;
}

export async function exportGoogleDocPdf(
  accessToken: string,
  fileId: string,
  http: GoogleHttp = defaultHttp,
): Promise<Buffer> {
  const res = await http(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent("application/pdf")}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) {
    throw mapGoogleHttpError(res.status, await res.text());
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length < 5 || bytes.subarray(0, 4).toString() !== "%PDF") {
    throw new GoogleAuthError("Google did not return a renderable document.", "parse_failed", 502);
  }
  return bytes;
}
