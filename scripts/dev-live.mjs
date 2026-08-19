/**
 * Live-reload preview wired to the NRP hosted stack:
 * - Render API (nrp-cad-api) → Supabase Postgres + Discord sign-in
 * - Supabase Edge Function fallback for homepage Discord counts
 */
import { NRP_RENDER_API, NRP_SUPABASE_STATS } from "./nrp-live-defaults.mjs";

process.env.PREVIEW_API_URL ??= NRP_RENDER_API;
process.env.VITE_STATS_URL ??= NRP_SUPABASE_STATS;
process.env.OPEN_BROWSER ??= "0";
await import("./dev-all.mjs");
