/**
 * Test preview — production build of your local changes + local API.
 * Sign-in returns to http://localhost:4173, not cad.dojrblx.com.
 * Use this to review unpublished files before a VPS release.
 */
delete process.env.PREVIEW_API_URL;
process.env.PREVIEW_RESTART_API ??= "1";
process.env.OPEN_BROWSER ??= "0";
await import("./preview-local.mjs");
