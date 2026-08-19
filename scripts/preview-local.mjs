/**
 * Production-style local preview: build frontend, serve on 4173.
 * Default (preview / preview:edit / preview:live): unpublished UI + Render API.
 */
import { NRP_LIVE_API_URL, NRP_LIVE_SITE_URL } from "./nrp-live-defaults.mjs";
import { execSync, spawn } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const API_PORT = process.env.API_PORT ?? "8080";
const PREVIEW_PORT = process.env.PREVIEW_PORT ?? "4173";
/** Live Render API — set via PREVIEW_API_URL or preview:live script */
let remoteApiUrl = (process.env.PREVIEW_API_URL ?? "").trim().replace(/\/$/, "");
let usingRemoteApi = remoteApiUrl.length > 0;

/** Always return to this preview, never the published northpointrp.xyz site. */
const previewRedirectUri = `http://localhost:${PREVIEW_PORT}/dojcad/discord-callback`;

const repoEnv = {
  ...process.env,
  PREVIEW_PORT,
  get PREVIEW_API_URL() {
    return remoteApiUrl;
  },
  CAD_DATABASE_PATH: process.env.CAD_DATABASE_PATH ?? path.join(root, "cad-database"),
  DISCORD_REDIRECT_URI: previewRedirectUri,
};

const children = [];
let exiting = false;

function dirNewestMtime(dir) {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      newest = Math.max(newest, dirNewestMtime(full));
      continue;
    }
    newest = Math.max(newest, statSync(full).mtimeMs);
  }
  return newest;
}

function needsFrontendBuild() {
  if (process.env.PREVIEW_FORCE_BUILD === "1") return true;
  const distIndex = path.join(root, "artifacts/dojrp/dist/public/index.html");
  if (!existsSync(distIndex)) return true;

  const distMtime = statSync(distIndex).mtimeMs;
  let srcMtime = dirNewestMtime(path.join(root, "artifacts/dojrp/src"));
  for (const file of [
    path.join(root, "artifacts/dojrp/vite.config.ts"),
    path.join(root, "artifacts/dojrp/index.html"),
    path.join(root, "artifacts/dojrp/tailwind.config.ts"),
  ]) {
    if (existsSync(file)) srcMtime = Math.max(srcMtime, statSync(file).mtimeMs);
  }
  return srcMtime > distMtime;
}

function httpGet(url, options = {}) {
  const client = url.startsWith("https:") ? https : http;
  return client.get(url, options);
}

function probe(url) {
  return new Promise((resolve) => {
    const req = httpGet(url, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 400);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(4000, () => {
      req.destroy();
      resolve(false);
    });
  });
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
          const parsed = JSON.parse(body);
          resolve(Boolean(parsed.ok));
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

async function ensureRemoteApiReady() {
  if (!usingRemoteApi) return true;
  console.log(`Checking Render API (Supabase): ${remoteApiUrl}`);
  const dbOk = await probeDbHealth(remoteApiUrl);
  if (dbOk) return true;
  console.warn(
    `Render API at ${remoteApiUrl} did not report Postgres as healthy.`,
  );
  console.warn("Falling back to local API + your .env database.");
  usingRemoteApi = false;
  remoteApiUrl = "";
  return false;
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

async function waitForPortFree(port, label, maxMs = 15_000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if (!isPortListening(port)) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  console.warn(`Warning: ${label} port ${port} may still be in use.`);
  return false;
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
    else if (code && code !== 0) shutdown(code);
  });
  return child;
}

async function isApiHealthy() {
  if (!isPortListening(API_PORT)) return false;
  if (!(await probe(`http://127.0.0.1:${API_PORT}/api/healthz`))) return false;
  // healthz alone is not enough — a stale API can be up while roster routes fail.
  return probeDbHealth(`http://127.0.0.1:${API_PORT}`);
}

async function ensureApi(label = "API") {
  const healthUrl = `http://127.0.0.1:${API_PORT}/api/healthz`;

  if (process.env.PREVIEW_RESTART_API === "1" && (await isApiHealthy())) {
    console.log(`Restarting ${label} on port ${API_PORT} for preview…`);
    killPort(API_PORT);
    await waitForPortFree(API_PORT, label);
  }

  if (await isApiHealthy()) {
    console.log(`${label} already healthy on port ${API_PORT}.`);
    return true;
  }

  if (isPortListening(API_PORT)) {
    console.log(`Port ${API_PORT} is in use but API is not healthy; restarting…`);
    killPort(API_PORT);
    await waitForPortFree(API_PORT, label);
  }

  console.log(`Starting ${label} on port ${API_PORT}…`);
  spawnInRoot("bun", ["run", "dev:api"]);
  const apiReady = await waitFor(healthUrl, label);
  if (!apiReady) {
    console.error(`${label} did not start on port ${API_PORT}. Preview may not load data.`);
    return false;
  }
  return true;
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

await ensureRemoteApiReady();

if (usingRemoteApi) {
  console.log(`Using live Render API: ${remoteApiUrl}`);
  // Unpublished Google Doc routes are not on Render yet — serve them locally.
  await ensureApi("local API for unpublished routes");
} else {
  await ensureApi();
}

const shouldBuildFrontend = needsFrontendBuild();
console.log(shouldBuildFrontend ? "Building frontend…" : "Frontend build is up to date — skipping rebuild.");
if (shouldBuildFrontend) {
  try {
    execSync("bun run --cwd ./artifacts/dojrp build", {
      cwd: root,
      stdio: "inherit",
      env: repoEnv,
      shell: true,
    });
  } catch {
    console.error("Frontend build failed.");
    shutdown(1);
  }
}

if (!(await isApiHealthy())) {
  console.warn("API stopped during build; restarting…");
  await ensureApi();
}

if (isPortListening(PREVIEW_PORT)) {
  console.log(`Stopping previous preview on port ${PREVIEW_PORT}…`);
  killPort(PREVIEW_PORT);
  await waitForPortFree(PREVIEW_PORT, "preview");
}

spawnInRoot("bun", ["run", "--cwd", "./artifacts/dojrp", "serve"]);

const ready = await waitFor(`http://127.0.0.1:${PREVIEW_PORT}/`, "preview server");
if (ready) {
  console.log(
    [
      "",
      "═══════════════════════════════════════════════════════════════",
      usingRemoteApi
        ? "  NRP CAD test preview — unpublished files + live Render API"
        : "  NRP CAD test preview — unpublished files (local API)",
      "═══════════════════════════════════════════════════════════════",
      "",
      `  Site:  http://localhost:${PREVIEW_PORT}/`,
      usingRemoteApi
        ? `  API:   ${remoteApiUrl}/api/healthz  (Render + Supabase)`
        : `  API:   http://localhost:${API_PORT}/api/healthz  (local SQLite from .env)`,
      usingRemoteApi
        ? `  Local: http://localhost:${API_PORT}/api  (unpublished Google Doc routes)`
        : "",
      "",
      usingRemoteApi
        ? "  Local files only — nothing is committed, pushed, or published."
        : `  Unpublished files. Sign-in returns here, not ${NRP_LIVE_SITE_URL}.`,
      usingRemoteApi
        ? `  Data/login use the live Render API. Sign-in returns here.`
        : "",
      "",
      "  Live reload while editing: bun run dev:live",
      "  Rebuild this preview:     bun run preview",
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
} else {
  console.error(
    `Preview server did not respond on port ${PREVIEW_PORT}. Check the build output above.`,
  );
  shutdown(1);
}
