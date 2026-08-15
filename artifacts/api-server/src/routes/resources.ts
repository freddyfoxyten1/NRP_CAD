import { Router } from "express";
import { isMongoStore, pool, getCollection } from "@workspace/db";

const router = Router();

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
  allowed_dps_ranks: parseRankList(row.allowed_dps_ranks),
});

// ── One-time migration ────────────────────────────────────────────────────────
(async () => {
  if (isMongoStore()) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dps_resources (
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
    await pool.query(`ALTER TABLE dps_resources ADD COLUMN IF NOT EXISTS header_config jsonb NOT NULL DEFAULT '{}'`);
    // file_data holds the stored PDF for uploaded (type='pdf') resources.
    await pool.query(`ALTER TABLE dps_resources ADD COLUMN IF NOT EXISTS file_data bytea`);
    // Optional link to a DPS division (Division Roster → Resources).
    await pool.query(`ALTER TABLE dps_resources ADD COLUMN IF NOT EXISTS division_id integer`);
    await pool.query(`ALTER TABLE dps_resources ADD COLUMN IF NOT EXISTS division_only boolean NOT NULL DEFAULT false`);
    await pool.query(`ALTER TABLE dps_resources ADD COLUMN IF NOT EXISTS allowed_ranks text NOT NULL DEFAULT '[]'`);
    // Department-wide visibility: DPS personnel only + optional DPS rank list
    await pool.query(`ALTER TABLE dps_resources ADD COLUMN IF NOT EXISTS personnel_only boolean NOT NULL DEFAULT false`);
    await pool.query(`ALTER TABLE dps_resources ADD COLUMN IF NOT EXISTS allowed_dps_ranks text NOT NULL DEFAULT '[]'`);
  } catch (e) {
    console.error("dps_resources migration failed:", e);
  }
})();

const RESOURCE_LIST_COLS = `
  id, title, type, logo_url, created_by, created_at, updated_at, division_id,
  COALESCE(division_only, false) AS division_only,
  COALESCE(allowed_ranks, '[]') AS allowed_ranks,
  COALESCE(personnel_only, false) AS personnel_only,
  COALESCE(allowed_dps_ranks, '[]') AS allowed_dps_ranks
`;

const RESOURCE_DETAIL_COLS = `
  id, title, type, logo_url, header_config, content, created_by, created_at, updated_at,
  division_id, COALESCE(division_only, false) AS division_only,
  COALESCE(allowed_ranks, '[]') AS allowed_ranks,
  COALESCE(personnel_only, false) AS personnel_only,
  COALESCE(allowed_dps_ranks, '[]') AS allowed_dps_ranks
`;

const isPublicResource = (row: ReturnType<typeof normalizeResourceRow>) =>
  row.division_id == null
  && !row.division_only
  && !row.personnel_only
  && row.allowed_ranks.length === 0
  && row.allowed_dps_ranks.length === 0;

// ── GET /resources — list all (lightweight, no content blob) ──────────────────
router.get("/resources", async (req, res) => {
  try {
    const divisionIdRaw = typeof req.query.division_id === "string" ? req.query.division_id : "";
    const divisionId = divisionIdRaw ? parseInt(divisionIdRaw, 10) : NaN;
    const publicOnly =
      req.query.public === "true"
      || req.query.public === "1"
      || req.query.scope === "public";

    if (isMongoStore()) {
      const col = await getCollection("resources");
      let filter: Record<string, unknown> = { department: "dps" };
      if (Number.isInteger(divisionId) && divisionId > 0) {
        filter = { department: "dps", division_id: divisionId };
      } else if (publicOnly) {
        filter = {
          department: "dps",
          division_id: null,
          division_only: false,
          personnel_only: false,
        };
      }
      const rows = await col.find(filter).sort({ created_at: -1 }).toArray();
      const normalized = rows.map(r => normalizeResourceRow(r as Record<string, unknown>));
      res.json(publicOnly ? normalized.filter(isPublicResource) : normalized);
      return;
    }

    const params: unknown[] = [];
    let where = "";
    if (Number.isInteger(divisionId) && divisionId > 0) {
      where = "WHERE division_id = $1";
      params.push(divisionId);
    } else if (publicOnly) {
      // Index / community: department-wide public docs only (no division or restricted).
      where = `WHERE division_id IS NULL
                 AND COALESCE(division_only, false) = false
                 AND COALESCE(personnel_only, false) = false`;
    }
    // Clients filter by viewer membership / ranks / personnel flags when not publicOnly.
    const { rows } = await pool.query(
      `SELECT ${RESOURCE_LIST_COLS}
         FROM dps_resources
         ${where}
        ORDER BY created_at DESC`,
      params
    );
    const normalized = rows.map(r => normalizeResourceRow(r as Record<string, unknown>));
    res.json(publicOnly ? normalized.filter(isPublicResource) : normalized);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to fetch resources." });
  }
});

// ── GET /resources/:id — single resource with full content ────────────────────
router.get("/resources/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id." });
  try {
    if (isMongoStore()) {
      const col = await getCollection("resources");
      const row = await col.findOne({ id, department: "dps" });
      if (!row) return res.status(404).json({ error: "Not found." });
      res.json(normalizeResourceRow(row as Record<string, unknown>));
      return;
    }
    const { rows } = await pool.query(
      `SELECT ${RESOURCE_DETAIL_COLS}
         FROM dps_resources WHERE id = $1`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: "Not found." });
    res.json(normalizeResourceRow(rows[0] as Record<string, unknown>));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to fetch resource." });
  }
});

// ── POST /resources — create ──────────────────────────────────────────────────
router.post("/resources", async (req, res) => {
  const {
    title,
    type = "document",
    created_by,
    division_id,
    division_only,
    allowed_ranks,
    personnel_only,
    allowed_dps_ranks,
  } = req.body as {
    title?: string;
    type?: string;
    created_by?: string;
    division_id?: number | null;
    division_only?: boolean;
    allowed_ranks?: unknown;
    personnel_only?: boolean;
    allowed_dps_ranks?: unknown;
  };
  if (!title?.trim()) return res.status(400).json({ error: "Title is required." });
  const resolvedDivisionId =
    division_id == null || division_id === undefined ? null
      : (Number.isInteger(division_id) && division_id > 0 ? division_id : null);
  const divisionRanks = parseRankList(allowed_ranks);
  const dpsRanks = parseRankList(allowed_dps_ranks);
  const onlyDivision = resolvedDivisionId != null ? Boolean(division_only) : false;
  // Division resources don't use department personnel flags
  const onlyPersonnel = resolvedDivisionId == null
    ? (Boolean(personnel_only) || dpsRanks.length > 0)
    : false;
  const savedDpsRanks = resolvedDivisionId == null ? dpsRanks : [];
  try {
    const { rows } = await pool.query(
      `INSERT INTO dps_resources
         (title, type, created_by, division_id, division_only, allowed_ranks, personnel_only, allowed_dps_ranks)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, title, type, logo_url, created_by, created_at, updated_at, division_id,
                 division_only, allowed_ranks, personnel_only, allowed_dps_ranks`,
      [
        title.trim(),
        type,
        created_by ?? null,
        resolvedDivisionId,
        onlyDivision,
        JSON.stringify(divisionRanks),
        onlyPersonnel,
        JSON.stringify(savedDpsRanks),
      ]
    );
    res.status(201).json(normalizeResourceRow(rows[0] as Record<string, unknown>));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to create resource." });
  }
});

// ── PATCH /resources/:id — update title, logo_url, or content ────────────────
router.patch("/resources/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id." });

  const {
    title, logo_url, content, header_config,
    division_only, allowed_ranks, personnel_only, allowed_dps_ranks,
  } = req.body as {
    title?: string; logo_url?: string | null; content?: object; header_config?: object;
    division_only?: boolean; allowed_ranks?: unknown;
    personnel_only?: boolean; allowed_dps_ranks?: unknown;
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
  if (allowed_dps_ranks !== undefined) { sets.push(`allowed_dps_ranks = $${idx++}`); vals.push(JSON.stringify(parseRankList(allowed_dps_ranks))); }

  if (!sets.length) return res.status(400).json({ error: "Nothing to update." });

  sets.push(`updated_at = NOW()`);
  vals.push(id);

  try {
    const { rows } = await pool.query(
      `UPDATE dps_resources SET ${sets.join(", ")}
        WHERE id = $${idx}
        RETURNING ${RESOURCE_DETAIL_COLS}`,
      vals
    );
    if (!rows.length) return res.status(404).json({ error: "Not found." });
    res.json(normalizeResourceRow(rows[0] as Record<string, unknown>));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to update resource." });
  }
});

// ── DELETE /resources/:id ────────────────────────────────────────────────────
router.delete("/resources/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id." });
  try {
    await pool.query(`DELETE FROM dps_resources WHERE id = $1`, [id]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to delete resource." });
  }
});

export default router;
