/**
 * Test preview — unpublished local UI + live VPS Mongo (cad.dojrblx.com).
 * HTTP keeps Discord on http://localhost:4173 (HTTPS proxy becomes https://localhost, which Discord rejects).
 */
process.env.PREVIEW_API_URL ??= "http://cad.dojrblx.com";
process.env.OPEN_BROWSER ??= "0";
await import("./preview-local.mjs");
