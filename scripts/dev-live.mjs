/**
 * Live-reload preview against the team VPS / MongoDB on cad.dojrblx.com.
 * Local file edits show immediately; data comes from the deployed API.
 */
process.env.PREVIEW_API_URL ??= "https://cad.dojrblx.com";
process.env.OPEN_BROWSER ??= "0";
await import("./dev-all.mjs");
