/**
 * Production-style preview from this NRP_CAD checkout (port 4173).
 * Uses the local API unless PREVIEW_API_URL is set explicitly.
 */
process.env.OPEN_BROWSER ??= "0";
await import("./preview-local.mjs");
