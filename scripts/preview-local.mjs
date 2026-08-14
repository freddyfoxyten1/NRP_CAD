/**
 * Production-style local preview: build frontend, serve on 4173, optional API.
 * Use `bun run dev` for live reload while editing; use this before a release push.
 */
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const API_PORT = process.env.API_PORT ?? "8080";
const PREVIEW_PORT = process.env.PREVIEW_PORT ?? "4173";

/** Ensure local preview/dev use the repo-root SQLite store, not api-server/cad-database. */
const previewRedirectUri =
  process.env.DISCORD_REDIRECT_URI?.includes(":5173")
    ? `http://localhost:${PREVIEW_PORT}/dojcad/discord-callback`
    : (process.env.DISCORD_REDIRECT_URI ??
      `http://localhost:${PREVIEW_PORT}/dojcad/discord-callback`);

const repoEnv = {
  ...process.env,
  CAD_DATABASE_PATH: process.env.CAD_DATABASE_PATH ?? path.join(root, "cad-database"),
  DISCORD_REDIRECT_URI: previewRedirectUri,
};

const children = [];
let exiting = false;
let apiStarted = false;

function probe(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 400);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(2000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitFor(url, label, maxMs = 180_000) {
  const start = Date.now();
  process.stdout.write(`Waiting for ${label}`);
  while (Date.now() - start < maxMs) {
    if (await probe(url)) {
      process.stdout.write("\n");
      return true;
    }
    process.stdout.write(".");
    await new Promise((r) => setTimeout(r, 800));
  }
  process.stdout.write("\n");
  return false;
}

function shutdown(code = 0) {
  if (exiting) return;
  exiting = true;
  for (const child of children) {
    try {
      child.kill("SIGTERM");
    } catch {
      /* ignore */
    }
  }
  process.exit(code);
}

function spawnInRoot(command, args) {
  const child = spawn(command, args, {
    cwd: root,
    stdio: "inherit",
    shell: true,
    env: repoEnv,
  });
  children.push(child);
  child.on("exit", (code, signal) => {
    if (exiting) return;
    if (signal) shutdown(1);
    else shutdown(code ?? 0);
  });
  return child;
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

if (!(await probe(`http://127.0.0.1:${API_PORT}/api/healthz`))) {
  apiStarted = true;
  spawnInRoot("bun", ["run", "dev:api"]);
  await waitFor(`http://127.0.0.1:${API_PORT}/api/healthz`, "API");
} else {
  console.warn(
    [
      "",
      "Note: API is already running on port " + API_PORT + ".",
      "If Discord sign-in fails, stop it (Ctrl+C on dev) and run preview again.",
      "",
    ].join("\n"),
  );
}

spawnInRoot("bun", ["run", "preview:build"]);

const ready = await waitFor(`http://127.0.0.1:${PREVIEW_PORT}/`, "preview server");
if (ready) {
  console.log(
    [
      "",
      "═══════════════════════════════════════════════════════════════",
      "  DOJCAD production preview (private — not on GitHub)",
      "═══════════════════════════════════════════════════════════════",
      "",
      `  Site:  http://localhost:${PREVIEW_PORT}/`,
      `  API:   http://localhost:${API_PORT}/api/healthz`,
      "",
      "  Re-run after code changes (rebuilds first). For live edits use: bun run dev",
      "",
      `  Discord sign-in redirect: ${previewRedirectUri}`,
      "  Add that URI in the Discord Developer Portal if sign-in fails.",
      "",
    ].join("\n"),
  );
  if (process.env.OPEN_BROWSER !== "0") {
    spawn("cmd", ["/c", "start", "", `http://localhost:${PREVIEW_PORT}/`], {
      detached: true,
      stdio: "ignore",
      shell: true,
    }).unref();
  }
}
