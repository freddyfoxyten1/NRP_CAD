#!/usr/bin/env bun
/** Production container entry — bind Render PORT and boot the API. */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiDir = path.join(root, "artifacts", "api-server");

const port = (process.env.PORT ?? process.env.API_PORT ?? "8080").trim();
process.env.PORT = port;
process.env.API_PORT = port;
process.env.NODE_ENV ??= "production";

console.log(`[start] NRP CAD API on 0.0.0.0:${port} (DATA_STORE=${process.env.DATA_STORE ?? "sql"})`);

const child = spawn("bun", ["run", "start"], {
  cwd: apiDir,
  stdio: "inherit",
  env: process.env,
});

child.on("exit", (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});
