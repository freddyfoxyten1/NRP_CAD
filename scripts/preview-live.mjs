/**
 * Same as `bun run preview`: unpublished local UI + VPS Mongo.
 * Discord sign-in returns to localhost:4173.
 */
process.env.PREVIEW_API_URL ??= "http://cad.dojrblx.com";
process.env.OPEN_BROWSER ??= "0";
await import("./preview-local.mjs");
