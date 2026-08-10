import { Router, Request, Response, NextFunction } from "express";
import { pool, isMongoStore, contentRepo } from "@workspace/db";
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

// Ensure table exists with soft-delete columns (SQL mode only)
const ensureTable = isMongoStore()
  ? Promise.resolve()
  : pool.query(`
  CREATE TABLE IF NOT EXISTS cad_announcements (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    posted_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,
    deleted_by TEXT
  )
`).then(() =>
  Promise.all([
    pool.query(`ALTER TABLE cad_announcements ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`),
    pool.query(`ALTER TABLE cad_announcements ADD COLUMN IF NOT EXISTS deleted_by TEXT`),
  ])
).catch(() => {});

// Public: members only see live announcements
router.get("/announcements", async (req, res) => {
  await ensureTable;
  try {
    if (isMongoStore()) {
      res.json(await contentRepo.listAnnouncements(50, false));
      return;
    }
    const result = await pool.query<{
      id: number; title: string; message: string; posted_by: string; created_at: string;
    }>(
      `SELECT id, title, message, posted_by, created_at::text
       FROM cad_announcements
       WHERE deleted_at IS NULL
       ORDER BY created_at DESC
       LIMIT 50`
    );
    res.json(result.rows);
  } catch (err) {
    req.log.error({ err }, "announcements GET error");
    res.status(500).json({ error: "Unable to load announcements." });
  }
});

// Admin: all announcements including soft-deleted
router.get("/admin/announcements", requireAdmin, async (req, res) => {
  await ensureTable;
  try {
    if (isMongoStore()) {
      res.json(await contentRepo.listAnnouncements(50, true));
      return;
    }
    const result = await pool.query<{
      id: number; title: string; message: string; posted_by: string;
      created_at: string; deleted_at: string | null; deleted_by: string | null;
    }>(
      `SELECT id, title, message, posted_by, created_at::text,
              deleted_at::text, deleted_by
       FROM cad_announcements
       ORDER BY created_at DESC
       LIMIT 50`
    );
    res.json(result.rows);
  } catch (err) {
    req.log.error({ err }, "admin/announcements GET error");
    res.status(500).json({ error: "Unable to load announcements." });
  }
});

router.post("/announcements", requireAdmin, async (req, res) => {
  await ensureTable;
  try {
    const body = req.body as { title?: string; message?: string; posted_by?: string };
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const message = typeof body.message === "string" ? body.message.trim() : "";
    const posted_by = typeof body.posted_by === "string" ? body.posted_by.trim() : "Admin";

    if (!title || !message) {
      res.status(400).json({ error: "Title and message are required." });
      return;
    }

    if (isMongoStore()) {
      const doc = await contentRepo.insertAnnouncement({ title, message, posted_by });
      res.status(201).json(doc);
      void writeLog("announcements", posted_by, "Posted announcement", `"${title}"`);
      return;
    }

    const result = await pool.query<{
      id: number; title: string; message: string; posted_by: string;
      created_at: string; deleted_at: null; deleted_by: null;
    }>(
      `INSERT INTO cad_announcements (title, message, posted_by)
       VALUES ($1, $2, $3)
       RETURNING id, title, message, posted_by, created_at::text, deleted_at, deleted_by`,
      [title, message, posted_by]
    );

    res.status(201).json(result.rows[0]);
    void writeLog("announcements", posted_by, "Posted announcement", `"${title}"`);
  } catch (err) {
    req.log.error({ err }, "announcements POST error");
    res.status(500).json({ error: "Unable to post announcement." });
  }
});

router.patch("/announcements/:id", requireAdmin, async (req, res) => {
  await ensureTable;
  try {
    const id = parseInt(req.params.id as string, 10);
    const body = req.body as { title?: string; message?: string; actor?: string };
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const message = typeof body.message === "string" ? body.message.trim() : "";
    const actor = typeof body.actor === "string" ? body.actor : (typeof req.headers["x-actor"] === "string" ? req.headers["x-actor"] : "Admin");

    if (!title || !message) {
      res.status(400).json({ error: "Title and message are required." });
      return;
    }

    if (isMongoStore()) {
      const existing = await contentRepo.findByNumericId("announcements", id);
      if (!existing || (existing as { deleted_at?: string | null }).deleted_at) {
        res.status(404).json({ error: "Announcement not found or already deleted." });
        return;
      }
      const updated = await contentRepo.updateAnnouncement(id, { title, message });
      void writeLog("announcements", actor, "Edited announcement", `"${title}" (ID: ${id})`);
      res.json(updated);
      return;
    }

    const result = await pool.query<{
      id: number; title: string; message: string; posted_by: string;
      created_at: string; deleted_at: string | null; deleted_by: string | null;
    }>(
      `UPDATE cad_announcements
       SET title = $1, message = $2
       WHERE id = $3 AND deleted_at IS NULL
       RETURNING id, title, message, posted_by, created_at::text, deleted_at::text, deleted_by`,
      [title, message, id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: "Announcement not found or already deleted." });
      return;
    }

    void writeLog("announcements", actor, "Edited announcement", `"${title}" (ID: ${id})`);
    res.json(result.rows[0]);
  } catch (err) {
    req.log.error({ err }, "announcements PATCH error");
    res.status(500).json({ error: "Unable to update announcement." });
  }
});

// Soft delete — keeps record, marks deleted_at + deleted_by
router.delete("/announcements/:id", requireAdmin, async (req, res) => {
  await ensureTable;
  try {
    const id = parseInt(req.params.id as string, 10);
    const body = req.body as { deleted_by?: string };
    const deleted_by = typeof body.deleted_by === "string" ? body.deleted_by.trim() : "Admin";
    const actor = deleted_by || "Admin";

    if (isMongoStore()) {
      const updated = await contentRepo.softDeleteAnnouncement(id, deleted_by);
      if (!updated) {
        res.status(404).json({ error: "Announcement not found." });
        return;
      }
      void writeLog("announcements", actor, "Deleted announcement", `"${updated.title}" (ID: ${id})`);
      res.json(updated);
      return;
    }

    const result = await pool.query<{
      id: number; title: string; message: string; posted_by: string;
      created_at: string; deleted_at: string; deleted_by: string;
    }>(
      `UPDATE cad_announcements
       SET deleted_at = NOW(), deleted_by = $2
       WHERE id = $1
       RETURNING id, title, message, posted_by, created_at::text, deleted_at::text, deleted_by`,
      [id, deleted_by]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: "Announcement not found." });
      return;
    }

    const deleted = result.rows[0] as { title: string };
    void writeLog("announcements", actor, "Deleted announcement", `"${deleted.title}" (ID: ${id})`);
    res.json(result.rows[0]);
  } catch (err) {
    req.log.error({ err }, "announcements DELETE error");
    res.status(500).json({ error: "Unable to delete announcement." });
  }
});

export default router;
