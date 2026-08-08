// ─────────────────────────────────────────────────────────────────────────────
// routes/staff-resources.ts  —  Staff Portal resources
//
// Documents / PDFs managed in Admin Portal, viewed on Staff Roster.
// Mirrors the DPS/DPH resources pattern against staff_resources.
// ─────────────────────────────────────────────────────────────────────────────
import { Router, Request, Response, NextFunction } from "express";
import multer from "multer";
import { pool } from "@workspace/db";
import { writeLog } from "../lib/audit-log";
import { ConversionError, convertDocxToPdf, isDocx, isLegacyDoc, isPdf } from "../lib/docx-to-pdf";

const router = Router();
const ADMIN_CODE = process.env.ADMIN_PORTAL_CODE ?? "ADMIN2026";
const MAX_FILE_BYTES = 20 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: 1 },
});

const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
  if (req.headers["x-admin-code"] !== ADMIN_CODE) {
    res.status(403).json({ error: "Admin access required." });
    return;
  }
  next();
};

const parseJsonField = (value: unknown, fallback: unknown = {}) => {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "object") return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return fallback;
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      return fallback;
    }
  }
  return fallback;
};

const normalizeResourceRow = (row: Record<string, unknown>) => ({
  ...row,
  header_config: parseJsonField(row.header_config, {}),
  content: parseJsonField(row.content, {}),
});

(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS staff_resources (
        id            serial PRIMARY KEY,
        title         text NOT NULL,
        type          text NOT NULL DEFAULT 'document',
        logo_url      text,
        header_config jsonb NOT NULL DEFAULT '{}',
        content       jsonb NOT NULL DEFAULT '{}',
        file_data     bytea,
        created_by    text,
        created_at    timestamptz NOT NULL DEFAULT NOW(),
        updated_at    timestamptz NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`ALTER TABLE staff_resources ADD COLUMN IF NOT EXISTS header_config jsonb NOT NULL DEFAULT '{}'`);
    await pool.query(`ALTER TABLE staff_resources ADD COLUMN IF NOT EXISTS file_data bytea`);
  } catch (e) {
    console.error("staff_resources migration failed:", e);
  }
})();

const RESOURCE_LIST_COLS = `id, title, type, logo_url, created_by, created_at, updated_at`;
const RESOURCE_DETAIL_COLS = `id, title, type, logo_url, header_config, content, created_by, created_at, updated_at`;

/** GET /staff/resources — list (no content blob) */
router.get("/staff/resources", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT ${RESOURCE_LIST_COLS} FROM staff_resources ORDER BY lower(title), id`
    );
    res.json(result.rows.map(normalizeResourceRow));
  } catch (err) {
    req.log.error({ err }, "staff/resources GET error");
    res.status(500).json({ error: "Unable to load staff resources." });
  }
});

/** GET /staff/resources/:id — full resource */
router.get("/staff/resources/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id." });
    return;
  }
  try {
    const result = await pool.query(
      `SELECT ${RESOURCE_DETAIL_COLS} FROM staff_resources WHERE id = $1`,
      [id]
    );
    if (!result.rows[0]) {
      res.status(404).json({ error: "Resource not found." });
      return;
    }
    res.json(normalizeResourceRow(result.rows[0]));
  } catch (err) {
    req.log.error({ err }, "staff/resources/:id GET error");
    res.status(500).json({ error: "Unable to load resource." });
  }
});

/** GET /staff/resources/:id/file — serve stored PDF */
router.get("/staff/resources/:id/file", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id." });
    return;
  }
  try {
    const result = await pool.query<{ title: string; file_data: Buffer | null }>(
      `SELECT title, file_data FROM staff_resources WHERE id = $1 AND type = 'pdf'`,
      [id]
    );
    const row = result.rows[0];
    if (!row?.file_data) {
      res.status(404).json({ error: "PDF not found." });
      return;
    }
    const safeName = (row.title || "resource").replace(/[^\w\- ]+/g, "").trim() || "resource";
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${safeName}.pdf"`);
    res.send(row.file_data);
  } catch (err) {
    req.log.error({ err }, "staff/resources/:id/file GET error");
    res.status(500).json({ error: "Unable to load file." });
  }
});

/** POST /staff/resources — create document resource (admin) */
router.post("/staff/resources", requireAdmin, async (req, res) => {
  const { title, created_by } = req.body as { title?: string; created_by?: string };
  const name = typeof title === "string" ? title.trim() : "";
  if (!name) {
    res.status(400).json({ error: "Title is required." });
    return;
  }
  try {
    const result = await pool.query(
      `INSERT INTO staff_resources (title, type, created_by)
       VALUES ($1, 'document', $2)
       RETURNING ${RESOURCE_DETAIL_COLS}`,
      [name, typeof created_by === "string" ? created_by.trim() || null : null]
    );
    const actor = typeof created_by === "string" ? created_by : "Admin";
    void writeLog("staff", actor, "Created staff resource", name);
    res.status(201).json(normalizeResourceRow(result.rows[0]));
  } catch (err) {
    req.log.error({ err }, "staff/resources POST error");
    res.status(500).json({ error: "Unable to create resource." });
  }
});

/** POST /staff/resources/upload — upload PDF/DOCX (admin) */
router.post("/staff/resources/upload", requireAdmin, (req, res) => {
  upload.single("file")(req, res, async (multerErr: unknown) => {
    if (multerErr) {
      const tooBig = multerErr instanceof multer.MulterError && multerErr.code === "LIMIT_FILE_SIZE";
      res.status(tooBig ? 413 : 400).json({
        error: tooBig ? "File is too large. The maximum size is 20 MB." : "Invalid upload request.",
      });
      return;
    }

    const file = req.file;
    const title = typeof req.body.title === "string" ? req.body.title.trim() : "";
    const createdBy = typeof req.body.created_by === "string" ? req.body.created_by : null;

    if (!file) { res.status(400).json({ error: "A file is required." }); return; }
    if (!title) { res.status(400).json({ error: "Title is required." }); return; }

    const ext = (file.originalname.split(".").pop() ?? "").toLowerCase();
    let pdf: Buffer;

    try {
      if (ext === "pdf" && isPdf(file.buffer)) {
        pdf = file.buffer;
      } else if (ext === "docx" && isDocx(file.buffer)) {
        pdf = await convertDocxToPdf(file.buffer);
      } else if (isLegacyDoc(file.buffer)) {
        res.status(400).json({ error: "Legacy .doc files are not supported. Please save as .docx." });
        return;
      } else {
        res.status(400).json({ error: "Unsupported file type. Only PDF (.pdf) and Word (.docx) are accepted." });
        return;
      }
    } catch (err) {
      req.log.error({ err }, "staff resource upload conversion error");
      const msg = err instanceof ConversionError ? err.message : "Failed to process the document.";
      res.status(500).json({ error: msg });
      return;
    }

    try {
      const result = await pool.query(
        `INSERT INTO staff_resources (title, type, file_data, created_by)
         VALUES ($1, 'pdf', $2, $3)
         RETURNING ${RESOURCE_LIST_COLS}`,
        [title, pdf, createdBy]
      );
      void writeLog("staff", createdBy || "Admin", "Uploaded staff resource", title);
      res.status(201).json(normalizeResourceRow(result.rows[0]));
    } catch (err) {
      req.log.error({ err }, "staff/resources/upload POST error");
      res.status(500).json({ error: "Unable to save uploaded resource." });
    }
  });
});

/** PATCH /staff/resources/:id — update title/content/header (admin for content edits via DocumentEditor also needs this open) */
router.patch("/staff/resources/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id." });
    return;
  }
  const { title, logo_url, content, header_config } = req.body as {
    title?: string;
    logo_url?: string | null;
    content?: object;
    header_config?: object;
  };

  const sets: string[] = [];
  const vals: unknown[] = [];
  let idx = 1;
  if (title !== undefined) {
    const name = String(title).trim();
    if (!name) { res.status(400).json({ error: "Title cannot be empty." }); return; }
    sets.push(`title = $${idx++}`);
    vals.push(name);
  }
  if (logo_url !== undefined) { sets.push(`logo_url = $${idx++}`); vals.push(logo_url); }
  if (content !== undefined) { sets.push(`content = $${idx++}`); vals.push(JSON.stringify(content)); }
  if (header_config !== undefined) { sets.push(`header_config = $${idx++}`); vals.push(JSON.stringify(header_config)); }
  if (sets.length === 0) {
    res.status(400).json({ error: "No updates provided." });
    return;
  }
  sets.push(`updated_at = NOW()`);
  vals.push(id);

  try {
    const result = await pool.query(
      `UPDATE staff_resources SET ${sets.join(", ")} WHERE id = $${idx}
       RETURNING ${RESOURCE_DETAIL_COLS}`,
      vals
    );
    if (!result.rows[0]) {
      res.status(404).json({ error: "Resource not found." });
      return;
    }
    const actor =
      (typeof req.headers["x-actor"] === "string" && req.headers["x-actor"])
      || "Admin";
    const title = String(result.rows[0].title ?? id);
    void writeLog("staff", actor, "Updated staff resource", title);
    res.json(normalizeResourceRow(result.rows[0]));
  } catch (err) {
    req.log.error({ err }, "staff/resources/:id PATCH error");
    res.status(500).json({ error: "Unable to update resource." });
  }
});

/** DELETE /staff/resources/:id — admin only */
router.delete("/staff/resources/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id." });
    return;
  }
  const actor =
    (typeof req.headers["x-actor"] === "string" && req.headers["x-actor"])
    || "Admin";
  try {
    const result = await pool.query<{ title: string }>(
      `DELETE FROM staff_resources WHERE id = $1 RETURNING title`,
      [id]
    );
    if (!result.rows[0]) {
      res.status(404).json({ error: "Resource not found." });
      return;
    }
    void writeLog("staff", actor, "Deleted staff resource", result.rows[0].title);
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "staff/resources/:id DELETE error");
    res.status(500).json({ error: "Unable to delete resource." });
  }
});

export default router;
