/**
 * Live-reload preview against the live NRP API on Render (Supabase Postgres).
 * Local file edits show immediately; data comes from the deployed API.
 */
import { NRP_LIVE_API_URL } from "./nrp-live-defaults.mjs";

process.env.PREVIEW_API_URL ??= NRP_LIVE_API_URL;
process.env.OPEN_BROWSER ??= "0";
await import("./dev-all.mjs");
