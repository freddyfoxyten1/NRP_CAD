/**
 * Test preview — unpublished local UI from this NRP_CAD checkout.
 * Uses the local API unless PREVIEW_API_URL is set explicitly.
 */
process.env.OPEN_BROWSER ??= "0";
await import("./preview-local.mjs");
