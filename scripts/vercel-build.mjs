/**
 * Production build for Vercel (static Northpoint CAD frontend).
 * Wires the site to Render API + Supabase stats at build time.
 */
import { execSync } from "node:child_process";
import { NRP_RENDER_API, NRP_SUPABASE_STATS } from "./nrp-live-defaults.mjs";

const env = {
  ...process.env,
  BASE_PATH: "/",
  NODE_ENV: "production",
  VITE_API_URL: process.env.VITE_API_URL ?? NRP_RENDER_API,
  VITE_STATS_URL: process.env.VITE_STATS_URL ?? NRP_SUPABASE_STATS,
};

console.log("[vercel:build] VITE_API_URL =", env.VITE_API_URL);
console.log("[vercel:build] VITE_STATS_URL =", env.VITE_STATS_URL);

execSync("bun run --cwd ./artifacts/dojrp build", {
  stdio: "inherit",
  env,
});
