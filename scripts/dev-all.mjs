/**
 * Local private preview — Vite with live reload.
 * Default: local API + SQLite.
 * With PREVIEW_API_URL (dev:live): proxied VPS API + Mongo on cad.dojrblx.com.
 * Code changes stay on your machine until you push to GitHub.
 */
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const API_PORT = process.env.API_PORT ?? "8080";
const WEB_PORT = process.env.WEB_PORT ?? "5173";
const PREVIEW_API_URL = (process.env.PREVIEW_API_URL ?? "").trim().replace(/\/$/, "");
const usingRemoteApi = PREVIEW_API_URL.length > 0;

/** Ensure local preview/dev use the repo-root SQLite store, not api-server/cad-database. */
const repoEnv = {
  ...process.env,
  PREVIEW_API_URL,
  CAD_DATABASE_PATH: process.env.CAD_DATABASE_PATH ?? path.join(root, "cad-database"),
};

const children = [];
let exiting = false;

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

function printBanner() {
  console.log(
    [
      "",
      "═══════════════════════════════════════════════════════════════",
      usingRemoteApi
        ? "  DOJCAD live preview — local files + VPS Mongo (cad.dojrblx.com)"
        : "  DOJCAD local preview (private — not on GitHub)",
      "═══════════════════════════════════════════════════════════════",
      "",
      `  Site (live reload):  http://localhost:${WEB_PORT}/`,
      usingRemoteApi
        ? `  API:                 ${PREVIEW_API_URL}/api/healthz  (team VPS + Mongo)`
        : `  API health:          http://localhost:${API_PORT}/api/healthz`,
      "",
      "  Edit & save files → the browser updates automatically.",
      usingRemoteApi
        ? "  Data is live from cad.dojrblx.com. Push to GitHub to update the VPS site."
        : "  Push to GitHub only when you are happy with what you see here.",
      "",
      "  Stop with Ctrl+C",
      "",
    ].join("\n"),
  );
}

function openBrowser(url) {
  if (process.env.OPEN_BROWSER === "0") return;
  const platform = process.platform;
  if (platform === "win32") {
    spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
  } else if (platform === "darwin") {
    spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
  } else {
    spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
  }
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

if (usingRemoteApi) {
  console.log(`Using live VPS API (Mongo on cad.dojrblx.com): ${PREVIEW_API_URL}`);
} else {
  spawnInRoot("bun", ["run", "dev:api"]);
  const apiReady = await waitFor(
    `http://127.0.0.1:${API_PORT}/api/healthz`,
    "API",
  );
  if (!apiReady) {
    console.warn("Warning: API did not respond in time. Starting web anyway — retry in a minute.");
  }
}

spawnInRoot("bun", ["run", "dev:web"]);

const webReady = await waitFor(`http://127.0.0.1:${WEB_PORT}/`, "Vite");
if (webReady) {
  printBanner();
  openBrowser(`http://localhost:${WEB_PORT}/`);
} else {
  console.warn(`Vite did not respond on port ${WEB_PORT}. Check the terminal output above.`);
}
