/**
 * Edit preview — production build of your local changes + local API.
 * Shows what the site will look like after you push to GitHub and the VPS deploys.
 * Does NOT use live VPS / Mongo data (use preview:live for that).
 */
delete process.env.PREVIEW_API_URL;
process.env.PREVIEW_RESTART_API ??= "1";
process.env.OPEN_BROWSER ??= "0";
await import("./preview-local.mjs");
