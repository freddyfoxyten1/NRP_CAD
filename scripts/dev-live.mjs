/**
 * Live-reload preview for NRP_CAD.
 * Default: local API + SQLite from this repo. Set PREVIEW_API_URL only if you
 * intentionally want to proxy a remote API (not used for normal NRP_CAD editing).
 */
process.env.OPEN_BROWSER ??= "0";
await import("./dev-all.mjs");
