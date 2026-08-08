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

const ensurePortalContent = pool
  .query(
    `CREATE TABLE IF NOT EXISTS portal_content (
       key TEXT PRIMARY KEY,
       content jsonb NOT NULL DEFAULT '{}',
       updated_at TIMESTAMPTZ DEFAULT NOW()
     )`
  )
  .catch(() => {});

const ALLOWED_KEYS = new Set([
  "information_support",
  "terms_of_service",
  "privacy_policy",
]);

function parseContent(raw: unknown): { sections: unknown[] } {
  if (raw == null) return { sections: [] };
  if (typeof raw === "object" && !Array.isArray(raw)) {
    const sections = (raw as { sections?: unknown }).sections;
    return { sections: Array.isArray(sections) ? sections : [] };
  }
  if (typeof raw === "string") {
    try {
      return parseContent(JSON.parse(raw));
    } catch {
      return { sections: [] };
    }
  }
  return { sections: [] };
}

/** Public — members can read portal content pages. */
router.get("/portal/content/:key", async (req, res) => {
  await ensurePortalContent;
  const key = String(req.params.key ?? "").trim();
  if (!ALLOWED_KEYS.has(key)) {
    res.status(404).json({ error: "Unknown content key." });
    return;
  }
  try {
    const result = await pool.query<{ content: unknown }>(
      `SELECT content FROM portal_content WHERE key = $1 LIMIT 1`,
      [key]
    );
    res.json(parseContent(result.rows[0]?.content));
  } catch (err) {
    req.log.error({ err }, "portal/content GET error");
    res.status(500).json({ error: "Failed to load content." });
  }
});

/** Admin — save portal content pages. */
router.put("/portal/content/:key", requireAdmin, async (req, res) => {
  await ensurePortalContent;
  const key = String(req.params.key ?? "").trim();
  if (!ALLOWED_KEYS.has(key)) {
    res.status(404).json({ error: "Unknown content key." });
    return;
  }
  const body = req.body as { sections?: unknown[]; actor?: string };
  const sections = Array.isArray(body.sections) ? body.sections : [];
  const content = { sections };
  const actor =
    (typeof body.actor === "string" && body.actor.trim())
    || (typeof req.headers["x-actor"] === "string" ? req.headers["x-actor"] : "Admin");

  try {
    await pool.query(
      `INSERT INTO portal_content (key, content, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET content = EXCLUDED.content, updated_at = NOW()`,
      [key, JSON.stringify(content)]
    );
    const CONTENT_LABELS: Record<string, string> = {
      information_support: "Information & Support",
      terms_of_service: "Terms of Service",
      privacy_policy: "Privacy Policy",
    };
    const label = CONTENT_LABELS[key] ?? key;
    void writeLog("portal", actor, `Updated ${label}`, label);
    res.json(content);
  } catch (err) {
    req.log.error({ err }, "portal/content PUT error");
    res.status(500).json({ error: "Failed to save content." });
  }
});

export default router;
