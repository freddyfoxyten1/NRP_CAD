import { Router, Request, Response, NextFunction } from "express";
import { pool, isMongoStore, settingsRepo } from "@workspace/db";
import { writeLog } from "../lib/audit-log";
import {
  auditLabelForMode,
  getCadMode,
  modeToOnline,
  parseCadMode,
  setCadMode,
  type CadMode,
} from "../lib/cad-mode";
import { ensureCadSettingsTable } from "../lib/ensure-cad-settings";

const router = Router();
const ADMIN_CODE = process.env.ADMIN_PORTAL_CODE ?? "ADMIN2026";

const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
  if (req.headers["x-admin-code"] !== ADMIN_CODE) {
    res.status(403).json({ error: "Admin access required." });
    return;
  }
  next();
};

const ensureSettings = ensureCadSettingsTable().catch(() => {});

router.get("/settings/cad-status", async (_req, res) => {
  await ensureSettings;
  try {
    const mode = await getCadMode();
    res.json({ mode, online: modeToOnline(mode) });
  } catch {
    res.json({ mode: "online" as CadMode, online: true });
  }
});

router.post("/settings/cad-status", requireAdmin, async (req, res) => {
  await ensureSettings;
  try {
    const body = req.body as { mode?: string; online?: boolean; actor?: string };
    let mode = parseCadMode(body.mode);
    if (!mode && typeof body.online === "boolean") {
      mode = body.online ? "online" : "lockdown";
    }
    if (!mode) {
      res.status(400).json({
        error: "mode must be 'online', 'members_locked', or 'lockdown'.",
      });
      return;
    }
    const actor =
      typeof body.actor === "string"
        ? body.actor
        : typeof req.headers["x-actor"] === "string"
          ? req.headers["x-actor"]
          : "Admin";
    await setCadMode(mode);
    req.log.info({ mode }, "CAD status updated");
    void writeLog("terminal", actor, auditLabelForMode(mode));
    res.json({ mode, online: modeToOnline(mode) });
  } catch (err) {
    req.log.error({ err }, "settings/cad-status POST error");
    res.status(500).json({ error: "Unable to update CAD status." });
  }
});

router.get("/settings/self-dispatch", async (req, res) => {
  await ensureSettings;
  try {
    if (isMongoStore()) {
      const value = await settingsRepo.getSetting("self_dispatch");
      res.json({ enabled: value === "true" });
      return;
    }
    const result = await pool.query<{ value: string }>(
      `SELECT value FROM cad_settings WHERE key='self_dispatch' LIMIT 1`,
    );
    res.json({ enabled: result.rows[0]?.value === "true" });
  } catch {
    res.json({ enabled: false });
  }
});

router.post("/settings/self-dispatch", requireAdmin, async (req, res) => {
  await ensureSettings;
  try {
    const body = req.body as { enabled?: boolean; actor?: string };
    const enabled = body.enabled === true;
    const actor = typeof body.actor === "string" ? body.actor : (typeof req.headers["x-actor"] === "string" ? req.headers["x-actor"] : "Admin");
    if (isMongoStore()) {
      await settingsRepo.setSetting("self_dispatch", enabled ? "true" : "false");
    } else {
      await pool.query(
        `INSERT INTO cad_settings (key, value, updated_at) VALUES ('self_dispatch', $1, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
        [enabled ? "true" : "false"],
      );
    }
    req.log.info({ enabled }, "Self Dispatch status updated");
    void writeLog("terminal", actor, enabled ? "Enabled Self Dispatch" : "Disabled Self Dispatch");
    res.json({ enabled });
  } catch (err) {
    req.log.error({ err }, "settings/self-dispatch POST error");
    res.status(500).json({ error: "Unable to update Self Dispatch status." });
  }
});

const ENV_SERVER_STORE_URL = (process.env.VITE_SERVER_STORE_URL ?? process.env.SERVER_STORE_URL ?? "").trim();

async function resolveServerStoreUrl(): Promise<string> {
  await ensureSettings;
  if (isMongoStore()) {
    const fromDb = (await settingsRepo.getSetting("server_store_url") ?? "").trim();
    return fromDb || ENV_SERVER_STORE_URL;
  }
  const result = await pool.query<{ value: string }>(
    `SELECT value FROM cad_settings WHERE key='server_store_url' LIMIT 1`,
  );
  const fromDb = (result.rows[0]?.value ?? "").trim();
  return fromDb || ENV_SERVER_STORE_URL;
}

router.get("/settings/server-store", async (_req, res) => {
  try {
    const url = await resolveServerStoreUrl();
    res.json({ url });
  } catch {
    res.json({ url: ENV_SERVER_STORE_URL });
  }
});

router.post("/settings/server-store", requireAdmin, async (req, res) => {
  await ensureSettings;
  try {
    const body = req.body as { url?: string; actor?: string };
    const url = typeof body.url === "string" ? body.url.trim() : "";
    const actor = typeof body.actor === "string" ? body.actor : (typeof req.headers["x-actor"] === "string" ? req.headers["x-actor"] : "Admin");
    if (url && !/^https?:\/\//i.test(url)) {
      res.status(400).json({ error: "Store URL must start with http:// or https://." }); return;
    }
    if (isMongoStore()) {
      await settingsRepo.setSetting("server_store_url", url);
    } else {
      await pool.query(
        `INSERT INTO cad_settings (key, value, updated_at) VALUES ('server_store_url', $1, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
        [url],
      );
    }
    void writeLog("terminal", actor, url ? "Updated Server Store URL" : "Cleared Server Store URL", url || "(empty)");
    res.json({ url });
  } catch (err) {
    req.log.error({ err }, "settings/server-store POST error");
    res.status(500).json({ error: "Unable to update Server Store URL." });
  }
});

export default router;
