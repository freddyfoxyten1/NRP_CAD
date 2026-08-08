import { Router } from "express";
import { pool } from "@workspace/db";
import { writeLog } from "../lib/audit-log";

const router = Router();

let initDone = false;
async function ensureTable() {
  if (initDone) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cad_calls (
      id          SERIAL PRIMARY KEY,
      origin      TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'Pending',
      location    TEXT,
      ten_code    TEXT,
      units       TEXT[],
      description TEXT,
      priority    INTEGER NOT NULL DEFAULT 3,
      created_by  TEXT,
      created_at  TIMESTAMPTZ DEFAULT NOW(),
      updated_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cad_call_history (
      id          SERIAL PRIMARY KEY,
      call_id     INTEGER NOT NULL REFERENCES cad_calls(id) ON DELETE CASCADE,
      event_type  TEXT NOT NULL,
      description TEXT,
      actor       TEXT,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  initDone = true;
}

async function logEvent(
  callId: number,
  eventType: string,
  description: string,
  actor?: string | null
) {
  await pool.query(
    `INSERT INTO cad_call_history (call_id, event_type, description, actor)
     VALUES ($1, $2, $3, $4)`,
    [callId, eventType, description, actor ?? null]
  );
}

// GET /api/cad/calls — list all non-closed calls (most recent first)
router.get("/cad/calls", async (req, res) => {
  try {
    await ensureTable();
    const result = await pool.query(
      `SELECT * FROM cad_calls ORDER BY created_at DESC LIMIT 200`
    );
    return res.json(result.rows);
  } catch (err) {
    console.error("cad/calls GET error:", err);
    return res.status(500).json({ error: "Failed to fetch calls." });
  }
});

// GET /api/cad/calls/:id/history — fetch event log for a call
router.get("/cad/calls/:id/history", async (req, res) => {
  try {
    await ensureTable();
    const result = await pool.query(
      `SELECT * FROM cad_call_history WHERE call_id = $1 ORDER BY created_at ASC`,
      [req.params.id]
    );
    return res.json(result.rows);
  } catch (err) {
    console.error("cad/calls history GET error:", err);
    return res.status(500).json({ error: "Failed to fetch call history." });
  }
});

// POST /api/cad/calls — create a new call
router.post("/cad/calls", async (req, res) => {
  try {
    await ensureTable();
  } catch (err) {
    console.error("cad/calls table init error:", err);
    return res.status(500).json({ error: "Database initialisation failed." });
  }

  const { origin, status, location, ten_code, units, description, priority, created_by } = req.body ?? {};

  if (!origin?.trim()) {
    return res.status(400).json({ error: "Call origin is required." });
  }

  const priorityNum = Number(priority);
  if (![1, 2, 3, 4].includes(priorityNum)) {
    return res.status(400).json({ error: "Priority must be 1–4." });
  }

  try {
    // Find the lowest available ID (re-uses gaps left by deleted calls)
    const idRes = await pool.query(
      `SELECT MIN(s) AS next_id
       FROM generate_series(1, (SELECT COALESCE(MAX(id), 0) + 1 FROM cad_calls)) s
       WHERE s NOT IN (SELECT id FROM cad_calls)`
    );
    const nextId: number = idRes.rows[0].next_id ?? 1;

    const result = await pool.query(
      `INSERT INTO cad_calls (id, origin, status, location, ten_code, units, description, priority, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        nextId,
        origin.trim(),
        (status?.trim() || "Pending"),
        location?.trim() || null,
        ten_code?.trim() || null,
        Array.isArray(units) && units.length > 0 ? units : null,
        description?.trim() || null,
        priorityNum,
        created_by?.trim() || null,
      ]
    );
    const call = result.rows[0];

    // Log creation event
    const parts: string[] = [`Call created — origin: ${call.origin}`];
    if (call.location) parts.push(`location: ${call.location}`);
    if (call.ten_code) parts.push(`code: ${call.ten_code}`);
    parts.push(`priority: P${call.priority}`);
    if (call.status && call.status !== "Pending") parts.push(`status: ${call.status}`);
    await logEvent(call.id, "call_created", parts.join(", "), call.created_by);

    if (Array.isArray(call.units) && call.units.length > 0) {
      await logEvent(
        call.id,
        "units_assigned",
        `Units assigned: ${call.units.join(", ")}`,
        call.created_by
      );
    }

    // Write to audit log for admin visibility
    void writeLog(
      "cad_dispatch",
      call.created_by || "Dispatcher",
      "Call created",
      `Call #${call.id} — ${call.origin}${call.location ? ` at ${call.location}` : ""}${call.ten_code ? ` (${call.ten_code})` : ""} — P${call.priority}`
    );

    return res.status(201).json(call);
  } catch (err) {
    console.error("cad/calls POST error:", err);
    return res.status(500).json({ error: "Failed to create call." });
  }
});

// PATCH /api/cad/calls/:id — update any call fields
router.patch("/cad/calls/:id", async (req, res) => {
  try {
    await ensureTable();

    const existing = await pool.query(`SELECT * FROM cad_calls WHERE id = $1`, [req.params.id]);
    if (existing.rowCount === 0) return res.status(404).json({ error: "Call not found." });
    const prev = existing.rows[0];

    const { status, units, actor, origin, location, ten_code, description, priority } = req.body ?? {};

    const priorityNum = priority !== undefined ? Number(priority) : null;
    if (priorityNum !== null && ![1, 2, 3, 4].includes(priorityNum)) {
      return res.status(400).json({ error: "Priority must be 1–4." });
    }

    const result = await pool.query(
      `UPDATE cad_calls SET
         origin      = COALESCE($1, origin),
         status      = COALESCE($2, status),
         location    = CASE WHEN $3::text IS NOT NULL THEN $3::text ELSE location END,
         ten_code    = CASE WHEN $4::text IS NOT NULL THEN $4::text ELSE ten_code END,
         units       = COALESCE($5, units),
         description = CASE WHEN $6::text IS NOT NULL THEN $6::text ELSE description END,
         priority    = COALESCE($7, priority),
         updated_at  = NOW()
       WHERE id = $8 RETURNING *`,
      [
        origin?.trim() || null,
        status?.trim() || null,
        location !== undefined ? (location?.trim() || null) : null,
        ten_code !== undefined ? (ten_code?.trim() || null) : null,
        Array.isArray(units) ? units : null,
        description !== undefined ? (description?.trim() || null) : null,
        priorityNum,
        req.params.id,
      ]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: "Call not found." });
    const updated = result.rows[0];

    // Log status change
    if (status?.trim() && status.trim() !== prev.status) {
      await logEvent(updated.id, "status_changed", `Status changed: ${prev.status} → ${updated.status}`, actor ?? null);
    }

    // Log field edits
    const edits: string[] = [];
    if (origin?.trim() && origin.trim() !== prev.origin) edits.push(`origin: "${prev.origin}" → "${updated.origin}"`);
    if (location !== undefined && (location?.trim() || null) !== prev.location) edits.push(`location updated`);
    if (ten_code !== undefined && (ten_code?.trim() || null) !== prev.ten_code) edits.push(`10-code: ${updated.ten_code ?? '—'}`);
    if (description !== undefined && (description?.trim() || null) !== prev.description) edits.push(`description updated`);
    if (priorityNum !== null && priorityNum !== prev.priority) edits.push(`priority: P${prev.priority} → P${updated.priority}`);
    if (edits.length > 0) {
      await logEvent(updated.id, "call_edited", `Call edited — ${edits.join(", ")}`, actor ?? null);
    }

    // Log unit changes
    if (Array.isArray(units)) {
      const prevUnits: string[] = Array.isArray(prev.units) ? prev.units : [];
      const added = units.filter((u: string) => !prevUnits.includes(u));
      const removed = prevUnits.filter(u => !units.includes(u));
      if (added.length > 0) await logEvent(updated.id, "units_added", `Unit${added.length > 1 ? "s" : ""} added: ${added.join(", ")}`, actor ?? null);
      if (removed.length > 0) await logEvent(updated.id, "units_removed", `Unit${removed.length > 1 ? "s" : ""} removed: ${removed.join(", ")}`, actor ?? null);
    }

    // Write to audit log for admin visibility
    const auditActor = actor || "Dispatcher";
    if (status?.trim() && status.trim() !== prev.status) {
      void writeLog("cad_dispatch", auditActor, "Call status updated", `Call #${updated.id} — ${prev.status} → ${updated.status}`);
    } else if (edits.length > 0) {
      void writeLog("cad_dispatch", auditActor, "Call updated", `Call #${updated.id} — ${edits.join(", ")}`);
    } else if (Array.isArray(units)) {
      const prevUnits2: string[] = Array.isArray(prev.units) ? prev.units : [];
      const added2 = units.filter((u: string) => !prevUnits2.includes(u));
      const removed2 = prevUnits2.filter(u => !units.includes(u));
      if (added2.length > 0 || removed2.length > 0) {
        const unitParts: string[] = [];
        if (added2.length > 0) unitParts.push(`assigned: ${added2.join(", ")}`);
        if (removed2.length > 0) unitParts.push(`unassigned: ${removed2.join(", ")}`);
        void writeLog("cad_dispatch", auditActor, "Call units changed", `Call #${updated.id} — ${unitParts.join("; ")}`);
      }
    }

    return res.json(updated);
  } catch (err) {
    console.error("cad/calls PATCH error:", err);
    return res.status(500).json({ error: "Failed to update call." });
  }
});

// DELETE /api/cad/calls/:id — permanently delete a call and its history
router.delete("/cad/calls/:id", async (req, res) => {
  try {
    await ensureTable();
    // Fetch call details before deleting so we can log them
    const existing = await pool.query(`SELECT * FROM cad_calls WHERE id = $1`, [req.params.id]);
    if (existing.rowCount === 0) return res.status(404).json({ error: "Call not found." });
    const call = existing.rows[0];

    const actor: string = (req.body as { actor?: string })?.actor || call.created_by || "Dispatcher";

    await pool.query(`DELETE FROM cad_calls WHERE id = $1`, [req.params.id]);

    void writeLog(
      "cad_dispatch",
      actor,
      "Call closed",
      `Call #${call.id} — ${call.origin}${call.location ? ` at ${call.location}` : ""}${call.ten_code ? ` (${call.ten_code})` : ""} — was ${call.status}`
    );

    return res.json({ deleted: call.id });
  } catch (err) {
    console.error("cad/calls DELETE error:", err);
    return res.status(500).json({ error: "Failed to delete call." });
  }
});

export default router;
