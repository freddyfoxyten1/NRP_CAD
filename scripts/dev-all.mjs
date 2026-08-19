/**
 * Local private preview — Vite with live reload.
 * Default: local API + SQLite from this NRP_CAD checkout.
 * Set PREVIEW_API_URL only when you intentionally proxy a remote API.
 */
import { execSync, spawn } from "node:child_process";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const API_PORT = process.env.API_PORT ?? "8080";
const WEB_PORT = process.env.WEB_PORT ?? "5173";
const PREVIEW_API_URL = (process.env.PREVIEW_API_URL ?? "").trim().replace(/\/$/, "");
let usingRemoteApi = PREVIEW_API_URL.length > 0;

function httpGet(url, options = {}) {
  const client = url.startsWith("https:") ? https : http;
  return client.get(url, options);
}

function probeDbHealth(baseUrl) {
  return new Promise((resolve) => {
    const req = httpGet(`${baseUrl}/api/health/db`, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        try {
          resolve(Boolean(JSON.parse(body).ok));
        } catch {
          resolve(false);
        }
      });
    });
    req.on("error", () => resolve(false));
    req.setTimeout(5000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

/** Ensure local preview/dev use the repo-root SQLite store, not api-server/cad-database. */
const repoEnv = {
  ...process.env,
  get PREVIEW_API_URL() {
    return usingRemoteApi ? PREVIEW_API_URL : "";
  },
  CAD_DATABASE_PATH: process.env.CAD_DATABASE_PATH ?? path.join(root, "cad-database"),
};

const children = [];
let exiting = false;

function probe(url) {
  return new Promise((resolve) => {
    const req = httpGet(url, (res) => {
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

function isPortListening(port) {
  try {
    if (process.platform === "win32") {
      const out = execSync(`netstat -ano | findstr "LISTENING" | findstr ":${port} "`, {
        encoding: "utf8",
      });
      return out.trim().length > 0;
    }
    execSync(`lsof -i :${port} -sTCP:LISTEN`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function killPort(port) {
  try {
    if (process.platform === "win32") {
      const out = execSync(`netstat -ano | findstr "LISTENING" | findstr ":${port} "`, {
        encoding: "utf8",
      });
      const pids = new Set();
      for (const line of out.split("\n")) {
        if (!line.includes("LISTENING")) continue;
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && /^\d+$/.test(pid) && pid !== "0") pids.add(pid);
      }
      for (const pid of pids) {
        try {
          execSync(`taskkill /PID ${pid} /F`, { stdio: "ignore" });
        } catch {
          /* ignore */
        }
      }
      return pids.size > 0;
    }
    execSync(`lsof -ti :${port} | xargs kill -9 2>/dev/null`, { shell: true, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function waitForPortFree(port, label, maxMs = 15_000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if (!isPortListening(port)) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  console.warn(`Warning: ${label} port ${port} may still be in use.`);
  return false;
}

async function freePort(port, label) {
  if (!isPortListening(port)) return;
  console.log(`Stopping previous ${label} on port ${port}…`);
  killPort(port);
  await waitForPortFree(port, label);
}

function spawnInRoot(command, args, { fatal = true } = {}) {
  const child = spawn(command, args, {
    cwd: root,
    stdio: "inherit",
    shell: true,
    env: repoEnv,
  });
  children.push(child);
  child.on("exit", (code, signal) => {
    if (exiting) return;
    if (!fatal) {
      console.warn(`${command} ${args.join(" ")} exited (${code ?? signal}).`);
      return;
    }
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
        ? "  NRP CAD live preview — local files + remote API (PREVIEW_API_URL)"
        : "  NRP CAD local preview (this checkout only)",
      "═══════════════════════════════════════════════════════════════",
      "",
      `  Site (live reload):  http://localhost:${WEB_PORT}/`,
      usingRemoteApi
        ? `  API:                 ${PREVIEW_API_URL}/api/healthz  (remote)`
        : `  API health:          http://localhost:${API_PORT}/api/healthz`,
      "",
      "  Edit & save files → the browser updates automatically.",
      usingRemoteApi
        ? "  Data comes from PREVIEW_API_URL. Push to GitHub when you are ready."
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

await freePort(WEB_PORT, "preview");

if (usingRemoteApi) {
  console.log(`Using remote API from PREVIEW_API_URL: ${PREVIEW_API_URL}`);
  const dbOk = await probeDbHealth(PREVIEW_API_URL);
  if (!dbOk) {
    console.warn("VPS Mongo is not ready — falling back to local API + .env.");
    usingRemoteApi = false;
  }
}

if (!usingRemoteApi) {
  await freePort(API_PORT, "API");
  spawnInRoot("bun", ["run", "dev:api"], { fatal: false });
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
