/**
 * Same as `bun run preview`: unpublished local UI + live Render API.
 * Discord sign-in returns to localhost:4173.
 */
import { NRP_LIVE_API_URL } from "./nrp-live-defaults.mjs";

process.env.PREVIEW_API_URL ??= NRP_LIVE_API_URL;
process.env.OPEN_BROWSER ??= "0";
await import("./preview-local.mjs");
