/**
 * Production-style local preview: build frontend, serve on 4173, optional API.
 * Default (preview / preview:edit): your local edits before GitHub push.
 * preview:live: proxied VPS API for production data comparison.
 */
import { execSync, spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const API_PORT = process.env.API_PORT ?? "8080";
const PREVIEW_PORT = process.env.PREVIEW_PORT ?? "4173";
/** Live VPS API (Mongo) — set via PREVIEW_API_URL or preview:live script */
const PREVIEW_API_URL = (process.env.PREVIEW_API_URL ?? "").trim().replace(/\/$/, "");
const usingRemoteApi = PREVIEW_API_URL.length > 0;

/** Always return to this preview, never the published cad.dojrblx.com site. */
const previewRedirectUri = `http://localhost:${PREVIEW_PORT}/dojcad/discord-callback`;

const repoEnv = {
  ...process.env,
  PREVIEW_PORT,
  PREVIEW_API_URL,
  CAD_DATABASE_PATH: process.env.CAD_DATABASE_PATH ?? path.join(root, "cad-database"),
  DISCORD_REDIRECT_URI: previewRedirectUri,
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
  return probe(`http://127.0.0.1:${API_PORT}/api/healthz`);
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

await (usingRemoteApi
  ? (console.log(`Using live VPS API (GitHub deploy data): ${PREVIEW_API_URL}`), Promise.resolve(true))
  : ensureApi());

console.log("Building frontend…");
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

if (!usingRemoteApi && !(await isApiHealthy())) {
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
        ? "  DOJCAD preview — VPS data (Discord login goes to cad.dojrblx.com)"
        : "  DOJCAD test preview — local files before VPS release",
      "═══════════════════════════════════════════════════════════════",
      "",
      `  Site:  http://localhost:${PREVIEW_PORT}/`,
      usingRemoteApi
        ? `  API:   ${PREVIEW_API_URL}/api/healthz  (proxied from VPS)`
        : `  API:   http://localhost:${API_PORT}/api/healthz  (this checkout)`,
      "",
      usingRemoteApi
        ? "  Sign-in leaves this preview. Use bun run preview to review unpublished changes."
        : "  Unpublished files. Sign-in returns here, not cad.dojrblx.com.",
      "",
      "  Live reload while editing: bun run dev",
      "  Production data check:    bun run preview:live",
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
