// ─────────────────────────────────────────────────────────────────────────────
// routes/dph-resources.ts  —  DPH resource documents
//
// Mirrors routes/resources.ts + routes/resource-files.ts against dph_resources.
// Visibility uses allowed_dph_ranks (department ranks) alongside allowed_ranks
// (division ranks), so DPH restrictions never read DPS rank names.
// ─────────────────────────────────────────────────────────────────────────────
import { Router } from "express";
import multer from "multer";
import { pool } from "@workspace/db";
import { writeLog } from "../lib/audit-log.js";
import { ConversionError, convertDocxToPdf, isDocx, isLegacyDoc, isPdf } from "../lib/docx-to-pdf";

function actorFrom(req: { headers: Record<string, unknown>; body?: unknown }): string {
  const header = req.headers["x-actor"];
  if (typeof header === "string" && header.trim()) return header.trim();
  const bodyActor = (req.body as { actor?: unknown } | undefined)?.actor;
  if (typeof bodyActor === "string" && bodyActor.trim()) return bodyActor.trim();
  return "Admin";
}

const router = Router();

const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20 MB
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: 1 },
});

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

const parseRankList = (value: unknown): string[] => {
  const parsed = parseJsonField(value, []);
  if (!Array.isArray(parsed)) return [];
  return parsed.map(String).map(s => s.trim()).filter(Boolean);
};

const normalizeResourceRow = (row: Record<string, unknown>) => ({
  ...row,
  header_config: parseJsonField(row.header_config, {}),
  content: parseJsonField(row.content, {}),
  division_only: Boolean(row.division_only),
  allowed_ranks: parseRankList(row.allowed_ranks),
  personnel_only: Boolean(row.personnel_only),
  allowed_dph_ranks: parseRankList(row.allowed_dph_ranks),
});

// ── One-time migration ────────────────────────────────────────────────────────
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dph_resources (
        id            serial PRIMARY KEY,
        title         text NOT NULL,
        type          text NOT NULL DEFAULT 'document',
        logo_url      text,
        header_config jsonb NOT NULL DEFAULT '{}',
        content       jsonb NOT NULL DEFAULT '{}',
        created_by    text,
        created_at    timestamptz NOT NULL DEFAULT NOW(),
        updated_at    timestamptz NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`ALTER TABLE dph_resources ADD COLUMN IF NOT EXISTS header_config jsonb NOT NULL DEFAULT '{}'`);
    // file_data holds the stored PDF for uploaded (type='pdf') resources.
    await pool.query(`ALTER TABLE dph_resources ADD COLUMN IF NOT EXISTS file_data bytea`);
    // Optional link to a DPH division (Division Roster → Resources).
    await pool.query(`ALTER TABLE dph_resources ADD COLUMN IF NOT EXISTS division_id integer`);
    await pool.query(`ALTER TABLE dph_resources ADD COLUMN IF NOT EXISTS division_only boolean NOT NULL DEFAULT false`);
    await pool.query(`ALTER TABLE dph_resources ADD COLUMN IF NOT EXISTS allowed_ranks text NOT NULL DEFAULT '[]'`);
    // Department-wide visibility: DPH personnel only + optional DPH rank list
    await pool.query(`ALTER TABLE dph_resources ADD COLUMN IF NOT EXISTS personnel_only boolean NOT NULL DEFAULT false`);
    await pool.query(`ALTER TABLE dph_resources ADD COLUMN IF NOT EXISTS allowed_dph_ranks text NOT NULL DEFAULT '[]'`);
  } catch (e) {
    console.error("dph_resources migration failed:", e);
  }
})();

const RESOURCE_LIST_COLS = `
  id, title, type, logo_url, created_by, created_at, updated_at, division_id,
  COALESCE(division_only, false) AS division_only,
  COALESCE(allowed_ranks, '[]') AS allowed_ranks,
  COALESCE(personnel_only, false) AS personnel_only,
  COALESCE(allowed_dph_ranks, '[]') AS allowed_dph_ranks
`;

const RESOURCE_DETAIL_COLS = `
  id, title, type, logo_url, header_config, content, created_by, created_at, updated_at,
  division_id, COALESCE(division_only, false) AS division_only,
  COALESCE(allowed_ranks, '[]') AS allowed_ranks,
  COALESCE(personnel_only, false) AS personnel_only,
  COALESCE(allowed_dph_ranks, '[]') AS allowed_dph_ranks
`;

const isPublicResource = (row: {
  division_id?: unknown;
  division_only: boolean;
  personnel_only: boolean;
  allowed_ranks: string[];
  allowed_dph_ranks: string[];
}) =>
  row.division_id == null
  && !row.division_only
  && !row.personnel_only
  && row.allowed_ranks.length === 0
  && row.allowed_dph_ranks.length === 0;

// ── GET /dph/resources — list all (lightweight, no content blob) ──────────────
router.get("/dph/resources", async (req, res) => {
  try {
    const divisionIdRaw = typeof req.query.division_id === "string" ? req.query.division_id : "";
    const divisionId = divisionIdRaw ? parseInt(divisionIdRaw, 10) : NaN;
    const publicOnly =
      req.query.public === "true"
      || req.query.public === "1"
      || req.query.scope === "public";
    const params: unknown[] = [];
    let where = "";
    if (Number.isInteger(divisionId) && divisionId > 0) {
      where = "WHERE division_id = $1";
      params.push(divisionId);
    } else if (publicOnly) {
      where = `WHERE division_id IS NULL
                 AND COALESCE(division_only, false) = false
                 AND COALESCE(personnel_only, false) = false`;
    }
    const { rows } = await pool.query(
      `SELECT ${RESOURCE_LIST_COLS}
         FROM dph_resources
         ${where}
        ORDER BY created_at DESC`,
      params
    );
    const normalized = rows.map(r => normalizeResourceRow(r as Record<string, unknown>));
    res.json(publicOnly ? normalized.filter(isPublicResource) : normalized);
  } catch (err) {
    req.log.error({ err }, "dph/resources GET error");
    res.status(500).json({ error: "Failed to fetch resources." });
  }
});

// ── POST /dph/resources/upload — multipart PDF / DOCX upload ─────────────────
router.post("/dph/resources/upload", (req, res) => {
  upload.single("file")(req, res, async (multerErr: unknown) => {
    if (multerErr) {
      const tooBig = multerErr instanceof multer.MulterError && multerErr.code === "LIMIT_FILE_SIZE";
      req.log.warn({ err: multerErr }, "dph resource upload rejected by multer");
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
    if (file.size === 0) { res.status(400).json({ error: "The uploaded file is empty." }); return; }

    const ext = (file.originalname.split(".").pop() ?? "").toLowerCase();
    let pdf: Buffer;

    try {
      // Never trust the extension alone — sniff the real content.
      if (ext === "pdf" && isPdf(file.buffer)) {
        pdf = file.buffer;
      } else if (ext === "docx" && isDocx(file.buffer)) {
        pdf = await convertDocxToPdf(file.buffer);
      } else if (isLegacyDoc(file.buffer)) {
        res.status(400).json({ error: "Legacy .doc files are not supported. Please save the document as .docx and try again." });
        return;
      } else {
        res.status(400).json({ error: "Unsupported file type. Only PDF (.pdf) and Word (.docx) files are accepted." });
        return;
      }
    } catch (err) {
      req.log.error({ err, name: file.originalname }, "dph docx conversion error");
      const msg = err instanceof ConversionError ? err.message : "Failed to process the document. Please try again.";
      res.status(422).json({ error: msg });
      return;
    }

    try {
      const divisionIdRaw = typeof req.body.division_id === "string" ? req.body.division_id.trim() : "";
      const divisionIdParsed = divisionIdRaw ? parseInt(divisionIdRaw, 10) : NaN;
      const divisionId = Number.isInteger(divisionIdParsed) && divisionIdParsed > 0 ? divisionIdParsed : null;
      const divisionOnlyRaw = typeof req.body.division_only === "string" ? req.body.division_only.trim() : "";
      const divisionOnly = divisionId != null && (divisionOnlyRaw === "1" || divisionOnlyRaw.toLowerCase() === "true");
      const allowedRanks = parseRankList(req.body.allowed_ranks);
      const allowedDphRanks = parseRankList(req.body.allowed_dph_ranks);
      const personnelOnlyRaw = typeof req.body.personnel_only === "string" ? req.body.personnel_only.trim() : "";
      const personnelOnly = divisionId == null
        && (personnelOnlyRaw === "1" || personnelOnlyRaw.toLowerCase() === "true" || allowedDphRanks.length > 0);
      const savedDphRanks = divisionId == null ? allowedDphRanks : [];

      const { rows } = await pool.query(
        `INSERT INTO dph_resources
           (title, type, created_by, file_data, division_id, division_only, allowed_ranks, personnel_only, allowed_dph_ranks)
         VALUES ($1, 'pdf', $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, title, type, logo_url, created_by, created_at, updated_at, division_id,
                   division_only, allowed_ranks, personnel_only, allowed_dph_ranks`,
        [title, createdBy, pdf, divisionId, divisionOnly, JSON.stringify(allowedRanks), personnelOnly, JSON.stringify(savedDphRanks)],
      );
      void writeLog("dph_personnel", createdBy || actorFrom(req), "Uploaded DPH resource", title);
      res.status(201).json(normalizeResourceRow(rows[0] as Record<string, unknown>));
    } catch (err) {
      req.log.error({ err }, "dph resource upload db insert failed");
      res.status(500).json({ error: "Failed to save the resource." });
    }
  });
});

// ── GET /dph/resources/:id/file — serve the stored PDF ───────────────────────
router.get("/dph/resources/:id/file", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id." }); return; }
  try {
    const { rows } = await pool.query(
      `SELECT title, file_data FROM dph_resources WHERE id = $1 AND file_data IS NOT NULL`,
      [id],
    );
    if (!rows.length) { res.status(404).json({ error: "File not found." }); return; }
    const safeName = (rows[0].title as string).replace(/[^\w\- ]+/g, "").trim() || "resource";
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${safeName}.pdf"`);
    res.send(rows[0].file_data);
  } catch (err) {
    req.log.error({ err }, "dph/resources file GET error");
    res.status(500).json({ error: "Failed to fetch file." });
  }
});

// ── GET /dph/resources/:id — single resource with full content ───────────────
router.get("/dph/resources/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id." }); return; }
  try {
    const { rows } = await pool.query(
      `SELECT ${RESOURCE_DETAIL_COLS} FROM dph_resources WHERE id = $1`,
      [id]
    );
    if (!rows.length) { res.status(404).json({ error: "Not found." }); return; }
    res.json(normalizeResourceRow(rows[0] as Record<string, unknown>));
  } catch (err) {
    req.log.error({ err }, "dph/resources GET :id error");
    res.status(500).json({ error: "Failed to fetch resource." });
  }
});

// ── POST /dph/resources — create ─────────────────────────────────────────────
router.post("/dph/resources", async (req, res) => {
  const {
    title,
    type = "document",
    created_by,
    division_id,
    division_only,
    allowed_ranks,
    personnel_only,
    allowed_dph_ranks,
  } = req.body as {
    title?: string;
    type?: string;
    created_by?: string;
    division_id?: number | null;
    division_only?: boolean;
    allowed_ranks?: unknown;
    personnel_only?: boolean;
    allowed_dph_ranks?: unknown;
  };
  if (!title?.trim()) { res.status(400).json({ error: "Title is required." }); return; }

  const resolvedDivisionId =
    division_id == null ? null
      : (Number.isInteger(division_id) && division_id > 0 ? division_id : null);
  const divisionRanks = parseRankList(allowed_ranks);
  const dphRanks = parseRankList(allowed_dph_ranks);
  const onlyDivision = resolvedDivisionId != null ? Boolean(division_only) : false;
  // Division resources don't use department personnel flags
  const onlyPersonnel = resolvedDivisionId == null
    ? (Boolean(personnel_only) || dphRanks.length > 0)
    : false;
  const savedDphRanks = resolvedDivisionId == null ? dphRanks : [];

  try {
    const { rows } = await pool.query(
      `INSERT INTO dph_resources
         (title, type, created_by, division_id, division_only, allowed_ranks, personnel_only, allowed_dph_ranks)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, title, type, logo_url, created_by, created_at, updated_at, division_id,
                 division_only, allowed_ranks, personnel_only, allowed_dph_ranks`,
      [
        title.trim(),
        type,
        created_by ?? null,
        resolvedDivisionId,
        onlyDivision,
        JSON.stringify(divisionRanks),
        onlyPersonnel,
        JSON.stringify(savedDphRanks),
      ]
    );
    const actor =
      (typeof created_by === "string" && created_by.trim())
      || actorFrom(req);
    void writeLog("dph_personnel", actor, "Created DPH resource", title.trim());
    res.status(201).json(normalizeResourceRow(rows[0] as Record<string, unknown>));
  } catch (err) {
    req.log.error({ err }, "dph/resources POST error");
    res.status(500).json({ error: "Failed to create resource." });
  }
});

// ── PATCH /dph/resources/:id ─────────────────────────────────────────────────
router.patch("/dph/resources/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id." }); return; }

  const {
    title, logo_url, content, header_config,
    division_only, allowed_ranks, personnel_only, allowed_dph_ranks,
  } = req.body as {
    title?: string; logo_url?: string | null; content?: object; header_config?: object;
    division_only?: boolean; allowed_ranks?: unknown;
    personnel_only?: boolean; allowed_dph_ranks?: unknown;
  };

  const sets: string[] = [];
  const vals: unknown[] = [];
  let idx = 1;

  if (title !== undefined) { sets.push(`title = $${idx++}`); vals.push(title.trim()); }
  if (logo_url !== undefined) { sets.push(`logo_url = $${idx++}`); vals.push(logo_url); }
  if (content !== undefined) { sets.push(`content = $${idx++}`); vals.push(JSON.stringify(content)); }
  if (header_config !== undefined) { sets.push(`header_config = $${idx++}`); vals.push(JSON.stringify(header_config)); }
  if (division_only !== undefined) { sets.push(`division_only = $${idx++}`); vals.push(Boolean(division_only)); }
  if (allowed_ranks !== undefined) { sets.push(`allowed_ranks = $${idx++}`); vals.push(JSON.stringify(parseRankList(allowed_ranks))); }
  if (personnel_only !== undefined) { sets.push(`personnel_only = $${idx++}`); vals.push(Boolean(personnel_only)); }
  if (allowed_dph_ranks !== undefined) { sets.push(`allowed_dph_ranks = $${idx++}`); vals.push(JSON.stringify(parseRankList(allowed_dph_ranks))); }

  if (!sets.length) { res.status(400).json({ error: "Nothing to update." }); return; }

  sets.push(`updated_at = NOW()`);
  vals.push(id);

  try {
    const { rows } = await pool.query(
      `UPDATE dph_resources SET ${sets.join(", ")}
        WHERE id = $${idx}
        RETURNING ${RESOURCE_DETAIL_COLS}`,
      vals
    );
    if (!rows.length) { res.status(404).json({ error: "Not found." }); return; }
    void writeLog(
      "dph_personnel",
      actorFrom(req),
      "Updated DPH resource",
      String((rows[0] as { title?: string }).title ?? id),
    );
    res.json(normalizeResourceRow(rows[0] as Record<string, unknown>));
  } catch (err) {
    req.log.error({ err }, "dph/resources PATCH error");
    res.status(500).json({ error: "Failed to update resource." });
  }
});

// ── DELETE /dph/resources/:id ────────────────────────────────────────────────
router.delete("/dph/resources/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id." }); return; }
  try {
    const { rows } = await pool.query<{ title: string }>(
      `DELETE FROM dph_resources WHERE id = $1 RETURNING title`,
      [id],
    );
    if (rows[0]) {
      void writeLog("dph_personnel", actorFrom(req), "Deleted DPH resource", rows[0].title);
    }
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "dph/resources DELETE error");
    res.status(500).json({ error: "Failed to delete resource." });
  }
});

export default router;
