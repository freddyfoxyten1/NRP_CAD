/**
 * Test preview — unpublished local UI + live VPS Mongo (cad.dojrblx.com).
 * Sign-in returns to http://localhost:4173, not the published site.
 */
process.env.PREVIEW_API_URL ??= "https://cad.dojrblx.com";
process.env.OPEN_BROWSER ??= "0";
await import("./preview-local.mjs");
