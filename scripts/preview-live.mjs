/**
 * Built preview (port 4173) wired to Render API + Supabase stats fallback.
 */
import { NRP_RENDER_API, NRP_SUPABASE_STATS } from "./nrp-live-defaults.mjs";

process.env.PREVIEW_API_URL ??= NRP_RENDER_API;
process.env.VITE_STATS_URL ??= NRP_SUPABASE_STATS;
process.env.OPEN_BROWSER ??= "0";
await import("./preview-local.mjs");
