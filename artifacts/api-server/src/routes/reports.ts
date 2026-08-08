import { Router } from "express";
import { pool } from "@workspace/db";

const router = Router();

// ── Lazy table initialisation ─────────────────────────────────────────────────
// We keep a cached promise so the heavy DDL runs at most once per server
// process, but we reset it to null on failure so that the next request
// retries — avoiding the "first boot silently failed, now nothing works"
// problem.
let initPromise: Promise<void> | null = null;

async function ensureTables(): Promise<void> {
  // 1. Ensure cad_civilians exists first — cad_citations has a FK to it.
  //    Using IF NOT EXISTS means this is a no-op when civilian.ts already
  //    created the table; it's just a safety net for ordering races.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cad_civilians (
      id             SERIAL PRIMARY KEY,
      owner_username TEXT,
      first_name     TEXT NOT NULL,
      last_name      TEXT NOT NULL,
      dob            TEXT,
      gender         TEXT,
      ethnicity      TEXT,
      address        TEXT,
      phone          TEXT,
      notes          TEXT,
      wanted         BOOLEAN DEFAULT FALSE,
      created_at     TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // 2. Create cad_citations with the FK already pointing at cad_civilians.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cad_citations (
      id          SERIAL PRIMARY KEY,
      civilian_id INTEGER REFERENCES cad_civilians(id) ON DELETE SET NULL,
      subject     TEXT NOT NULL,
      officer     TEXT,
      date_time   TEXT,
      location    TEXT,
      violation   TEXT NOT NULL,
      fine_amount TEXT,
      notes       TEXT,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // 3. Add civilian_id to pre-existing tables that were created before this
  //    column existed.
  await pool.query(`
    ALTER TABLE cad_citations
      ADD COLUMN IF NOT EXISTS civilian_id INTEGER REFERENCES cad_civilians(id) ON DELETE SET NULL
  `);

  // 4. Warnings table.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cad_warnings (
      id          SERIAL PRIMARY KEY,
      subject     TEXT NOT NULL,
      officer     TEXT,
      date_time   TEXT,
      location    TEXT,
      reason      TEXT NOT NULL,
      notes       TEXT,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

function getInitPromise(): Promise<void> {
  if (!initPromise) {
    initPromise = ensureTables().catch((err) => {
      // Reset so the next request retries instead of getting a permanently
      // rejected promise.
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
}

// POST /api/reports/citation  (router is mounted under /api, so path here is /reports/citation)
router.post("/reports/citation", async (req, res) => {
  try {
    await getInitPromise();
  } catch (err) {
    console.error("Failed to initialise citations table:", err);
    return res.status(500).json({ error: "Database initialisation failed. Please try again." });
  }

  const { subject, officer, date_time, location, violation, fine_amount, notes, civilian_id } = req.body ?? {};

  if (!subject?.trim()) {
    return res.status(400).json({ error: "Subject name is required." });
  }
  if (!violation?.trim()) {
    return res.status(400).json({ error: "Violation / offence is required." });
  }

  // Validate civilian_id: must be absent, null, or a positive integer.
  let civilianId: number | null = null;
  if (civilian_id != null) {
    const parsed = Number(civilian_id);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return res.status(400).json({ error: "civilian_id must be a positive integer." });
    }
    civilianId = parsed;
  }

  try {
    const result = await pool.query(
      `INSERT INTO cad_citations (civilian_id, subject, officer, date_time, location, violation, fine_amount, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        civilianId,
        subject.trim(),
        officer?.trim() ?? null,
        date_time?.trim() ?? null,
        location?.trim() ?? null,
        violation.trim(),
        fine_amount?.trim() ?? null,
        notes?.trim() ?? null,
      ]
    );

    return res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Failed to save citation:", err);
    return res.status(500).json({ error: "Failed to save citation report." });
  }
});

// POST /api/reports/warning
router.post("/reports/warning", async (req, res) => {
  try {
    await getInitPromise();
  } catch (err) {
    console.error("Failed to initialise warnings table:", err);
    return res.status(500).json({ error: "Database initialisation failed. Please try again." });
  }

  const { subject, officer, date_time, location, reason, notes } = req.body ?? {};

  if (!subject?.trim()) {
    return res.status(400).json({ error: "Subject name is required." });
  }
  if (!reason?.trim()) {
    return res.status(400).json({ error: "Reason is required." });
  }

  try {
    const result = await pool.query(
      `INSERT INTO cad_warnings (subject, officer, date_time, location, reason, notes)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        subject.trim(),
        officer?.trim() ?? null,
        date_time?.trim() ?? null,
        location?.trim() ?? null,
        reason.trim(),
        notes?.trim() ?? null,
      ]
    );
    return res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Failed to save warning:", err);
    return res.status(500).json({ error: "Failed to save warning." });
  }
});

export default router;
