/** Hosted API origin for GitHub Pages. Empty in local Vite (proxy to :8080). */
const API_ORIGIN = String(import.meta.env.VITE_API_URL ?? "").trim().replace(/\/$/, "");

export function discordOAuthRedirectUri(): string {
  const path = `${import.meta.env.BASE_URL}dojcad/discord-callback`.replace(/\/{2,}/g, "/");
  return new URL(path, window.location.origin).href;
}

function rewriteApiUrl(raw: string): string {
  if (!API_ORIGIN) return raw;
  let url: URL;
  try {
    url = new URL(raw, window.location.origin);
  } catch {
    return raw;
  }
  if (url.origin !== window.location.origin) return raw;

  const base = String(import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");
  let pathname = url.pathname;
  if (base && pathname.startsWith(`${base}/api`)) {
    pathname = pathname.slice(base.length);
  }
  if (pathname === "/api" || pathname.startsWith("/api/")) {
    return `${API_ORIGIN}${pathname}${url.search}${url.hash}`;
  }
  return raw;
}

function rewriteInput(input: RequestInfo | URL): RequestInfo | URL {
  if (typeof input === "string") return rewriteApiUrl(input);
  if (input instanceof URL) return rewriteApiUrl(input.href);
  const next = rewriteApiUrl(input.url);
  return next === input.url ? input : new Request(next, input);
}

/** Send `/api` requests to the hosted CAD API when the static site is on GitHub Pages. */
export function installApiOrigin(): void {
  if (!API_ORIGIN || typeof window === "undefined") return;
  const orig = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => orig(rewriteInput(input), init);
}
