#!/usr/bin/env bun
/**
 * Create or update nrp-cad-api on Render and deploy with secrets from .env.
 *
 * Usage:
 *   1. Add RENDER_API_KEY to .env (Render → Account Settings → API Keys)
 *   2. Ensure DATABASE_URL + Discord secrets are in .env
 *   3. bun run render:setup
 *
 * Options:
 *   --check     Poll healthz only (no API key required)
 *   --no-deploy Skip triggering a deploy after syncing env
 */
import "./load-env.mjs";

const API = "https://api.render.com/v1";
const SERVICE_NAME = "nrp-cad-api";
const REPO = "https://github.com/freddyfoxyten1/NRP_CAD";
const BRANCH = (process.env.RENDER_BRANCH ?? "cursor/vps-deploy-ia-roster-fixes").trim();
const HEALTH_URL =
  (process.env.RENDER_SERVICE_URL ?? "https://nrp-cad-api.onrender.com").replace(/\/$/, "") +
  "/api/healthz";

const STATIC_ENV = {
  NODE_ENV: "production",
  DATA_STORE: "sql",
  PUBLIC_BASE_PATH: "",
  CORS_ORIGIN: "https://northpointrp.xyz,https://www.northpointrp.xyz",
  PUBLIC_ORIGIN: "https://northpointrp.xyz",
  DISCORD_REDIRECT_URI: "https://northpointrp.xyz/dojcad/discord-callback",
  DISCORD_GUILD_ID: "1539452857592324116",
  STAFF_DISCORD_GUILD_ID: "1539452857592324116",
  DPS_DISCORD_GUILD_ID: "1539660726338326571",
  DIVISION_DISCORD_GUILD_ID: "1539660726338326571",
  DPH_DISCORD_GUILD_ID: "1539452857592324116",
  DISCORD_SERVER_NAME: "Northpoint Roleplay",
  DISCORD_GATEWAY_ENABLED: "1",
};

const SECRET_KEYS = [
  "DATABASE_URL",
  "DISCORD_CLIENT_ID",
  "DISCORD_CLIENT_SECRET",
  "DISCORD_BOT_TOKEN",
];

const args = new Set(process.argv.slice(2));
const checkOnly = args.has("--check");
const skipDeploy = args.has("--no-deploy");

function fail(message) {
  console.error(`[render:setup] ${message}`);
  process.exit(1);
}

function info(message) {
  console.log(`[render:setup] ${message}`);
}

function blueprintHelp() {
  info("No Render API key? Deploy once via Blueprint, then re-run this script:");
  info("  https://dashboard.render.com/select-repo?type=blueprint");
  info(`  Repo: ${REPO}`);
  info(`  Branch: ${BRANCH}`);
  info("After the service exists, add RENDER_API_KEY to .env and run: bun run render:setup");
}

async function checkHealth() {
  info(`Checking ${HEALTH_URL}`);
  try {
    const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(20_000) });
    const text = await res.text();
    if (res.ok) {
      info(`OK (${res.status}): ${text.slice(0, 200)}`);
      return true;
    }
    info(`Not ready (${res.status}): ${text.slice(0, 200)}`);
    return false;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    info(`Unreachable: ${message}`);
    return false;
  }
}

async function renderApi(path, { method = "GET", body } = {}) {
  const apiKey = (process.env.RENDER_API_KEY ?? "").trim();
  if (!apiKey) {
    blueprintHelp();
    fail("Set RENDER_API_KEY in .env (Render → Account Settings → API Keys).");
  }

  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!res.ok) {
    const detail =
      typeof data === "object" && data && "message" in data
        ? String(data.message)
        : typeof data === "string"
          ? data
          : JSON.stringify(data);
    throw new Error(`${method} ${path} → ${res.status}: ${detail}`);
  }

  return data;
}

async function listServices() {
  const out = [];
  let cursor;
  for (;;) {
    const qs = new URLSearchParams({ limit: "100", name: SERVICE_NAME });
    if (cursor) qs.set("cursor", cursor);
    const page = await renderApi(`/services?${qs}`);
    if (!Array.isArray(page) || page.length === 0) break;
    for (const row of page) {
      if (row?.service) out.push(row.service);
      cursor = row?.cursor;
    }
    if (!cursor) break;
  }
  return out;
}

async function getOwnerId() {
  const owners = await renderApi("/owners?limit=20");
  if (!Array.isArray(owners) || owners.length === 0) {
    throw new Error("No Render workspace found on this account.");
  }
  const preferred = (process.env.RENDER_OWNER_ID ?? "").trim();
  if (preferred) {
    const match = owners.find((row) => row?.owner?.id === preferred);
    if (match?.owner?.id) return match.owner.id;
  }
  const first = owners[0]?.owner;
  if (!first?.id) throw new Error("Could not read workspace id from Render.");
  info(`Using workspace: ${first.name ?? first.id}`);
  return first.id;
}

function collectEnvVars() {
  const missing = [];
  const env = { ...STATIC_ENV };
  for (const key of SECRET_KEYS) {
    const value = (process.env[key] ?? "").trim();
    if (!value) missing.push(key);
    else env[key] = value;
  }
  if (missing.length) {
    fail(`Missing in .env: ${missing.join(", ")}`);
  }
  if (/^postgresql:/.test(env.DATABASE_URL) && /db\.[^.]+\.supabase\.co/i.test(env.DATABASE_URL)) {
    info("Warning: DATABASE_URL uses direct db.*.supabase.co (IPv6). Prefer the IPv4 session pooler.");
  }
  return Object.entries(env).map(([key, value]) => ({ key, value }));
}

async function findOrCreateService(ownerId) {
  const existing = (await listServices()).find((s) => s.name === SERVICE_NAME);
  if (existing?.id) {
    info(`Found service ${SERVICE_NAME} (${existing.id})`);
    return existing;
  }

  info(`Creating ${SERVICE_NAME}…`);
  try {
    const created = await renderApi("/services", {
      method: "POST",
      body: {
        type: "web_service",
        name: SERVICE_NAME,
        ownerId,
        repo: REPO,
        branch: BRANCH,
        autoDeploy: "yes",
        serviceDetails: {
          runtime: "docker",
          plan: "free",
          region: "frankfurt",
          healthCheckPath: "/api/healthz",
          preDeployCommand: "bun run db:setup",
          envSpecificDetails: {
            dockerfilePath: "./Dockerfile",
          },
        },
        envVars: collectEnvVars(),
      },
    });
    const service = created?.service ?? created;
    if (!service?.id) throw new Error("Create service returned no id.");
    info(`Created ${SERVICE_NAME} (${service.id})`);
    return service;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    info(`Could not create service via API: ${message}`);
    blueprintHelp();
    throw err;
  }
}

async function syncEnv(serviceId) {
  const envVars = collectEnvVars();
  await renderApi(`/services/${serviceId}/env-vars`, {
    method: "PUT",
    body: envVars,
  });
  info(`Synced ${envVars.length} environment variables.`);
}

async function triggerDeploy(serviceId) {
  const deploy = await renderApi(`/services/${serviceId}/deploys`, {
    method: "POST",
    body: {},
  });
  const id = deploy?.id ?? deploy?.deploy?.id;
  info(id ? `Deploy queued: ${id}` : "Deploy queued.");
  return id;
}

async function waitForDeploy(serviceId, deployId) {
  if (!deployId) return;
  info("Waiting for deploy (up to ~15 min on free tier)…");
  const deadline = Date.now() + 15 * 60_000;
  while (Date.now() < deadline) {
    await Bun.sleep(15_000);
    const deploy = await renderApi(`/services/${serviceId}/deploys/${deployId}`);
    const status = deploy?.status ?? deploy?.deploy?.status;
    info(`Deploy status: ${status ?? "unknown"}`);
    if (status === "live") return;
    if (["build_failed", "update_failed", "canceled", "pre_deploy_failed"].includes(status)) {
      fail(`Deploy failed with status: ${status}. Check the Render dashboard Events tab.`);
    }
  }
  info("Deploy still running — check Render dashboard. Will probe health anyway.");
}

async function main() {
  if (checkOnly) {
    const ok = await checkHealth();
    process.exit(ok ? 0 : 1);
  }

  const ownerId = await getOwnerId();
  const service = await findOrCreateService(ownerId);
  await syncEnv(service.id);

  if (!skipDeploy) {
    const deployId = await triggerDeploy(service.id);
    await waitForDeploy(service.id, deployId);
  }

  const ok = await checkHealth();
  if (ok) {
    info("Render API is live. Test stats: https://nrp-cad-api.onrender.com/api/public/live-stats");
    return;
  }

  info("Health check not OK yet — free-tier cold start can take 1–2 minutes. Re-run: bun run render:check");
  process.exit(1);
}

main().catch((err) => {
  fail(err instanceof Error ? err.message : String(err));
});
