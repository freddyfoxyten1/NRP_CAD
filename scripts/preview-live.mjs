/**
 * Preview with live VPS / GitHub-deployed data (MongoDB on cad.dojrblx.com),
 * not the local SQLite API.
 */
process.env.PREVIEW_API_URL ??= "https://cad.dojrblx.com";
process.env.OPEN_BROWSER ??= "0";
await import("./preview-local.mjs");
