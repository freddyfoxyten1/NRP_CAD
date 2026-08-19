/** Browser hosts allowed for Northpoint CAD (CORS + Discord OAuth). */

const FIXED_SITE_HOSTS = new Set([
  "northpointrp.xyz",
  "www.northpointrp.xyz",
  "cad.dojrblx.com",
  "freddyfoxyten1.github.io",
]);

export function normalizeSiteHost(host: string): string {
  return host.toLowerCase().split(":")[0] ?? "";
}

export function isVercelPreviewHost(host: string): boolean {
  return normalizeSiteHost(host).endsWith(".vercel.app");
}

export function isGitHubPagesHost(host: string): boolean {
  const lower = normalizeSiteHost(host);
  return lower.endsWith(".github.io") || lower === "freddyfoxyten1.github.io";
}

export function isNorthpointSiteHost(host: string): boolean {
  const lower = normalizeSiteHost(host);
  if (!lower) return false;
  if (FIXED_SITE_HOSTS.has(lower)) return true;
  if (isVercelPreviewHost(host)) return true;
  if (isGitHubPagesHost(host)) return true;
  return false;
}

export function parseCorsOriginList(): string[] {
  const raw = (process.env.CORS_ORIGIN ?? process.env.PUBLIC_ORIGIN ?? "").trim();
  if (!raw) return [];
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

export function isAllowedCorsOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  try {
    const host = new URL(origin).host;
    if (isNorthpointSiteHost(host)) return true;
    const allowed = parseCorsOriginList();
    return allowed.includes(origin);
  } catch {
    return false;
  }
}

export function defaultProductionCorsOrigins(): string[] {
  return [
    "https://northpointrp.xyz",
    "https://www.northpointrp.xyz",
    "https://freddyfoxyten1.github.io",
    "https://cad.dojrblx.com",
  ];
}
