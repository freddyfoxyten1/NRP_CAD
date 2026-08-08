import { Router, Request, Response, NextFunction } from "express";
import { pool } from "@workspace/db";
import { writeLog } from "../lib/audit-log";

const router = Router();
const ADMIN_CODE = process.env.ADMIN_PORTAL_CODE ?? "ADMIN2026";

const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
  if (req.headers["x-admin-code"] !== ADMIN_CODE) {
    res.status(403).json({ error: "Admin access required." });
    return;
  }
  next();
};

const ensureSettings = pool
  .query(
    `CREATE TABLE IF NOT EXISTS cad_settings (
       key TEXT PRIMARY KEY,
       value TEXT NOT NULL,
       updated_at TIMESTAMPTZ DEFAULT NOW()
     )`
  )
  .then(() =>
    pool.query(
      `INSERT INTO cad_settings (key, value) VALUES ('cad_online', 'true') ON CONFLICT DO NOTHING`
    )
  )
  .then(() =>
    pool.query(
      `INSERT INTO cad_settings (key, value) VALUES ('self_dispatch', 'false') ON CONFLICT DO NOTHING`
    )
  )
  .catch(() => {});

// Public — anyone can read CAD status
router.get("/settings/cad-status", async (req, res) => {
  await ensureSettings;
  try {
    const result = await pool.query<{ value: string }>(
      `SELECT value FROM cad_settings WHERE key='cad_online' LIMIT 1`
    );
    res.json({ online: result.rows[0]?.value !== "false" });
  } catch {
    res.json({ online: true }); // safe default
  }
});

// Admin only — toggle CAD online/offline
router.post("/settings/cad-status", requireAdmin, async (req, res) => {
  await ensureSettings;
  try {
    const body = req.body as { online?: boolean; actor?: string };
    const online = body.online !== false;
    const actor = typeof body.actor === "string" ? body.actor : (typeof req.headers["x-actor"] === "string" ? req.headers["x-actor"] : "Admin");
    await pool.query(
      `INSERT INTO cad_settings (key, value, updated_at) VALUES ('cad_online', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
      [online ? "true" : "false"]
    );
    req.log.info({ online }, "CAD status updated");
    void writeLog("terminal", actor, online ? "Set terminal Online" : "Set terminal Offline");
    res.json({ online });
  } catch (err) {
    req.log.error({ err }, "settings/cad-status POST error");
    res.status(500).json({ error: "Unable to update CAD status." });
  }
});

// Public — anyone can read Self Dispatch status
router.get("/settings/self-dispatch", async (req, res) => {
  await ensureSettings;
  try {
    const result = await pool.query<{ value: string }>(
      `SELECT value FROM cad_settings WHERE key='self_dispatch' LIMIT 1`
    );
    res.json({ enabled: result.rows[0]?.value === "true" });
  } catch {
    res.json({ enabled: false }); // safe default
  }
});

// Admin only — toggle Self Dispatch
router.post("/settings/self-dispatch", requireAdmin, async (req, res) => {
  await ensureSettings;
  try {
    const body = req.body as { enabled?: boolean; actor?: string };
    const enabled = body.enabled === true;
    const actor = typeof body.actor === "string" ? body.actor : (typeof req.headers["x-actor"] === "string" ? req.headers["x-actor"] : "Admin");
    await pool.query(
      `INSERT INTO cad_settings (key, value, updated_at) VALUES ('self_dispatch', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
      [enabled ? "true" : "false"]
    );
    req.log.info({ enabled }, "Self Dispatch status updated");
    void writeLog("terminal", actor, enabled ? "Enabled Self Dispatch" : "Disabled Self Dispatch");
    res.json({ enabled });
  } catch (err) {
    req.log.error({ err }, "settings/self-dispatch POST error");
    res.status(500).json({ error: "Unable to update Self Dispatch status." });
  }
});

const ENV_SERVER_STORE_URL = (process.env.VITE_SERVER_STORE_URL ?? process.env.SERVER_STORE_URL ?? "").trim();

/** Resolve store URL: DB setting first, then env fallback. */
async function resolveServerStoreUrl(): Promise<string> {
  await ensureSettings;
  const result = await pool.query<{ value: string }>(
    `SELECT value FROM cad_settings WHERE key='server_store_url' LIMIT 1`
  );
  const fromDb = (result.rows[0]?.value ?? "").trim();
  return fromDb || ENV_SERVER_STORE_URL;
}

// Public — anyone can read the Server Store URL used on the index page
router.get("/settings/server-store", async (_req, res) => {
  try {
    const url = await resolveServerStoreUrl();
    res.json({ url });
  } catch {
    res.json({ url: ENV_SERVER_STORE_URL });
  }
});

// Admin only — set the Server Store URL shown on the public index
router.post("/settings/server-store", requireAdmin, async (req, res) => {
  await ensureSettings;
  try {
    const body = req.body as { url?: string; actor?: string };
    const url = typeof body.url === "string" ? body.url.trim() : "";
    const actor = typeof body.actor === "string" ? body.actor : (typeof req.headers["x-actor"] === "string" ? req.headers["x-actor"] : "Admin");
    if (url && !/^https?:\/\//i.test(url)) {
      res.status(400).json({ error: "Store URL must start with http:// or https://." }); return;
    }
    await pool.query(
      `INSERT INTO cad_settings (key, value, updated_at) VALUES ('server_store_url', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
      [url]
    );
    void writeLog("terminal", actor, url ? "Updated Server Store URL" : "Cleared Server Store URL", url || "(empty)");
    res.json({ url });
  } catch (err) {
    req.log.error({ err }, "settings/server-store POST error");
    res.status(500).json({ error: "Unable to update Server Store URL." });
  }
});

export default router;
