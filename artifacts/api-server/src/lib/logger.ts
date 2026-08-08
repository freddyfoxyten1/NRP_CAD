// ─────────────────────────────────────────────────────────────────────────────
// lib/logger.ts  —  Structured logger
//
// Creates and exports a Pino logger instance used across all routes and libs.
// In development, output is pretty-printed.  In production, it emits JSON.
// Import `logger` from this file rather than creating your own pino instance.
// ─────────────────────────────────────────────────────────────────────────────
import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "res.headers['set-cookie']",
  ],
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});
