/**
 * Test preview — unpublished local UI + live Render API (Supabase Postgres).
 * HTTP keeps Discord on http://localhost:4173 (HTTPS proxy becomes https://localhost, which Discord rejects).
 */
import { NRP_LIVE_API_URL } from "./nrp-live-defaults.mjs";

process.env.PREVIEW_API_URL ??= NRP_LIVE_API_URL;
process.env.OPEN_BROWSER ??= "0";
await import("./preview-local.mjs");
