import { Router } from "express";
import { pool } from "@workspace/db";

const router = Router();

// ── One-time migration ────────────────────────────────────────────────────────
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS moderations (
        id               SERIAL PRIMARY KEY,
        target_username  TEXT NOT NULL,
        type             TEXT NOT NULL,
        reason           TEXT NOT NULL,
        issued_by        TEXT NOT NULL,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  } catch (e) {
    console.error("Moderations migration failed:", e);
  }
})();

const VALID_TYPES = ["Warning", "Strike", "BOLO", "Kick", "Ban"];

// ── GET /moderations — recent 50 ─────────────────────────────────────────────
router.get("/moderations", async (_req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, target_username, type, reason, issued_by, created_at
       FROM moderations ORDER BY created_at DESC LIMIT 50`
    );
    res.json(r.rows);
  } catch {
    res.status(500).json({ error: "Failed to fetch moderations." });
  }
});

// ── GET /moderations/user/:username — account + history ──────────────────────
router.get("/moderations/user/:username", async (req, res) => {
  const username = req.params.username.trim();
  if (!username) { res.status(400).json({ error: "Username required." }); return; }
  try {
    const [profileRes, modRes] = await Promise.all([
      pool.query(
        `SELECT id, username, rank, role, status, discord_username, discord_id, avatar_hash
         FROM cad_user_profiles WHERE lower(username) = lower($1) LIMIT 1`,
        [username]
      ),
      pool.query(
        `SELECT id, target_username, type, reason, issued_by, created_at
         FROM moderations WHERE lower(target_username) = lower($1)
         ORDER BY created_at DESC`,
        [username]
      ),
    ]);
    res.json({ account: profileRes.rows[0] ?? null, moderations: modRes.rows });
  } catch {
    res.status(500).json({ error: "Failed to fetch user data." });
  }
});

// ── POST /moderations — create ────────────────────────────────────────────────
router.post("/moderations", async (req, res) => {
  const { target_username, type, reason, issued_by } = req.body as {
    target_username?: string; type?: string; reason?: string; issued_by?: string;
  };
  if (!target_username?.trim() || !type?.trim() || !reason?.trim() || !issued_by?.trim()) {
    res.status(400).json({ error: "All fields are required." }); return;
  }
  if (!VALID_TYPES.includes(type.trim())) {
    res.status(400).json({ error: `Invalid type. Must be one of: ${VALID_TYPES.join(", ")}.` }); return;
  }
  try {
    const r = await pool.query(
      `INSERT INTO moderations (target_username, type, reason, issued_by)
       VALUES ($1, $2, $3, $4)
       RETURNING id, target_username, type, reason, issued_by, created_at`,
      [target_username.trim(), type.trim(), reason.trim(), issued_by.trim()]
    );
    res.json(r.rows[0]);
  } catch {
    res.status(500).json({ error: "Failed to create moderation." });
  }
});

export default router;
