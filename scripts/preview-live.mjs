/**
 * Compare against VPS Mongo data. Test-preview sign-in must stay on localhost.
 * For unpublished UI changes use `bun run preview` (local API + this checkout).
 */
process.env.PREVIEW_API_URL ??= "https://cad.dojrblx.com";
process.env.OPEN_BROWSER ??= "0";
await import("./preview-local.mjs");
