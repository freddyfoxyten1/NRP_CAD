import { Router } from "express";
import { isUniqueViolation, pool } from "@workspace/db";
import { writeLog } from "../lib/audit-log.js";

const router = Router();

// ── One-time migration: create DOC tables ─────────────────────────────────────
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS doc_rank_groups (
        id         serial PRIMARY KEY,
        name       text NOT NULL UNIQUE,
        sort_order integer NOT NULL DEFAULT 0,
        panel_access boolean NOT NULL DEFAULT false
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS doc_ranks (
        id              serial PRIMARY KEY,
        name            text NOT NULL UNIQUE,
        sort_order      integer NOT NULL DEFAULT 0,
        group_id        integer REFERENCES doc_rank_groups(id) ON DELETE SET NULL,
        color_hex       text,
        callsign_prefix text,
        insignia_url    text
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS doc_users (
        id             serial PRIMARY KEY,
        profile_id     integer NOT NULL REFERENCES cad_user_profiles(id) ON DELETE CASCADE,
        username       text,
        doc_rank       text,
        doc_role       text,
        callsign       text NOT NULL DEFAULT 'DOC-XX',
        status         text NOT NULL DEFAULT 'Active',
        appointed_date date,
        certifications text[] NOT NULL DEFAULT '{}',
        created_at     timestamptz NOT NULL DEFAULT NOW(),
        updated_at     timestamptz NOT NULL DEFAULT NOW(),
        UNIQUE (profile_id)
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS doc_fleet_categories (
        id         serial PRIMARY KEY,
        name       text NOT NULL UNIQUE,
        sort_order integer NOT NULL DEFAULT 0
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS doc_fleet (
        id                   serial PRIMARY KEY,
        name                 text NOT NULL,
        year                 text,
        category             text NOT NULL DEFAULT 'General',
        category_sort        integer NOT NULL DEFAULT 0,
        image_url            text,
        who_can_drive        text[] NOT NULL DEFAULT '{}',
        restrict_to_divisions text[] NOT NULL DEFAULT '{}',
        liveries             text[] NOT NULL DEFAULT '{}',
        notes                text,
        sort_order           integer NOT NULL DEFAULT 0
      )
    `);
  } catch (e) {
    console.error("doc tables migration failed:", e);
  }
})();

// ── Helpers ───────────────────────────────────────────────────────────────────
const rankOrderSubquery = `
  COALESCE(
    (SELECT sort_order FROM doc_ranks WHERE lower(name) = lower(d.doc_rank)),
    999
  )
`;

// ── GET personnel (pass ?all=1 to include inactive) ───────────────────────────
router.get("/doc", async (req, res) => {
  try {
    const includeAll = req.query.all === "1";
    const where = includeAll ? "" : "WHERE lower(d.status) != 'inactive'";
    const result = await pool.query(
      `SELECT p.id, COALESCE(d.username, p.username) AS username,
              p.discord_username, p.discord_id, p.avatar_hash,
              d.callsign, d.doc_rank, d.doc_role, d.status, d.appointed_date,
              d.certifications,
              COALESCE(rg.name, 'Community Members') AS group_name,
              COALESCE(rg.sort_order, 999) AS group_sort_order
       FROM cad_user_profiles p
       JOIN doc_users d ON d.profile_id = p.id
       LEFT JOIN doc_ranks dr ON lower(dr.name) = lower(d.doc_rank)
       LEFT JOIN doc_rank_groups rg ON dr.group_id = rg.id
       ${where}
       ORDER BY COALESCE(rg.sort_order, 999), ${rankOrderSubquery},
                COALESCE(d.username, p.username)`
    );
    res.json(result.rows);
  } catch (err) {
    req.log.error({ err }, "doc GET error");
    res.status(500).json({ error: "Unable to load roster." });
  }
});

// ── GET /doc/me?username=X — fetch the current user's DOC record ──────────────
router.get("/doc/me", async (req, res) => {
  const username = String(req.query.username ?? "").trim();
  if (!username) { res.json(null); return; }
  try {
    const result = await pool.query(
      `SELECT d.doc_rank, d.doc_role, d.callsign, d.status
       FROM doc_users d
       JOIN cad_user_profiles p ON p.id = d.profile_id
       WHERE lower(COALESCE(d.username, p.username)) = lower($1)
       LIMIT 1`,
      [username]
    );
    res.json(result.rows[0] ?? null);
  } catch (err) {
    req.log.error({ err }, "doc/me GET error");
    res.json(null);
  }
});

// ── GET /doc/users/search — typeahead for Add Member form ────────────────────
router.get("/doc/users/search", async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  if (!q) { res.json([]); return; }
  try {
    const result = await pool.query(
      `SELECT id, username, discord_username, discord_id, rank, avatar_hash
       FROM cad_user_profiles
       WHERE username ILIKE $1 OR discord_username ILIKE $1
       ORDER BY username
       LIMIT 8`,
      [`%${q}%`]
    );
    res.json(result.rows);
  } catch (err) {
    req.log.error({ err }, "doc/users/search GET error");
    res.status(500).json({ error: "Search failed." });
  }
});

// ── PATCH — update a member's DOC fields ──────────────────────────────────────
router.patch("/doc/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid id." }); return; }

  const { doc_rank, doc_role, callsign, status, appointed_date, certifications } =
    req.body as Record<string, unknown>;

  const safeDate = (appointed_date && String(appointed_date).trim()) ? appointed_date : null;

  try {
    const upd = await pool.query(
      `UPDATE doc_users SET
         doc_rank       = COALESCE($2, doc_rank),
         doc_role       = COALESCE($3, doc_role),
         callsign       = COALESCE($4, callsign),
         status         = COALESCE($5, status),
         appointed_date = COALESCE($6::date, appointed_date),
         certifications = COALESCE($7::text[], certifications),
         updated_at     = NOW()
       WHERE profile_id = $1`,
      [id, doc_rank ?? null, doc_role ?? null, callsign ?? null, status ?? null,
       safeDate, certifications ?? null]
    );
    if ((upd.rowCount ?? 0) === 0) { res.status(404).json({ error: "Member not found." }); return; }

    const result = await pool.query(
      `SELECT p.id, COALESCE(u.username, p.username) AS username,
              p.discord_username, p.discord_id,
              u.callsign, u.doc_rank, u.doc_role, u.status, u.appointed_date, u.certifications
       FROM doc_users u
       JOIN cad_user_profiles p ON p.id = u.profile_id
       WHERE u.profile_id = $1`,
      [id]
    );
    const actor = (req.body as Record<string, unknown>).actor as string || (req.headers['x-actor'] as string) || 'Admin';
    await writeLog('doc_personnel', actor, 'Updated member record', `${result.rows[0].username} — rank: ${result.rows[0].doc_rank}`);
    res.json(result.rows[0]);
  } catch (err) {
    req.log.error({ err }, "doc PATCH error");
    res.status(500).json({ error: "Unable to update member." });
  }
});

// ── POST — add/promote a member ───────────────────────────────────────────────
router.post("/doc", async (req, res) => {
  const { username, discord_username = "", discord_id = "",
          doc_rank = "Unranked", doc_role = "", callsign = "DOC-XX", status = "Active", appointed_date } =
    req.body as Record<string, string>;

  if (!username?.trim()) { res.status(400).json({ error: "Username is required." }); return; }

  try {
    const existing = await pool.query<{ id: number }>(
      `SELECT id FROM cad_user_profiles WHERE lower(username) = lower($1) LIMIT 1`,
      [username.trim()]
    );

    if ((existing.rowCount ?? 0) > 0) {
      const profileId = existing.rows[0].id;

      if (discord_username.trim() || discord_id.trim()) {
        await pool.query(
          `UPDATE cad_user_profiles SET
             discord_username = CASE WHEN $2 != '' THEN $2 ELSE discord_username END,
             discord_id       = CASE WHEN $3 != '' THEN $3 ELSE discord_id       END,
             updated_at       = NOW()
           WHERE id = $1`,
          [profileId, discord_username.trim(), discord_id.trim()]
        );
      }

      const profileRow = await pool.query<{ username: string }>(
        `SELECT username FROM cad_user_profiles WHERE id = $1`, [profileId]
      );
      const canonicalUsername = profileRow.rows[0]?.username ?? username.trim();

      await pool.query(
        `INSERT INTO doc_users (profile_id, username, doc_rank, doc_role, callsign, status, appointed_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7::date)
         ON CONFLICT (profile_id) DO UPDATE SET
           username       = EXCLUDED.username,
           doc_rank       = EXCLUDED.doc_rank,
           doc_role       = CASE WHEN EXCLUDED.doc_role != '' THEN EXCLUDED.doc_role ELSE doc_users.doc_role END,
           callsign       = EXCLUDED.callsign,
           status         = EXCLUDED.status,
           appointed_date = EXCLUDED.appointed_date,
           updated_at     = NOW()`,
        [profileId, canonicalUsername, doc_rank, doc_role.trim(), callsign.trim(), status, appointed_date || null]
      );
      const result = await pool.query(
        `SELECT p.id, COALESCE(u.username, p.username) AS username,
                p.discord_username, p.discord_id,
                u.callsign, u.doc_rank, u.doc_role, u.status, u.appointed_date, u.certifications
         FROM doc_users u
         JOIN cad_user_profiles p ON p.id = u.profile_id
         WHERE u.profile_id = $1`,
        [profileId]
      );
      const actor = (req.body as Record<string, string>).actor || (req.headers['x-actor'] as string) || 'Admin';
      await writeLog('doc_personnel', actor, 'Added/updated member', `${result.rows[0].username} — ${doc_rank}`);
      res.json(result.rows[0]);
    } else {
      const ts = Date.now();
      const profileRes = await pool.query<{ id: number }>(
        `INSERT INTO cad_user_profiles
           (auth_user_id, username, discord_username, discord_id, email,
            community_code, rank, role, password_salt, password_hash)
         VALUES ($1, $2, $3, $4, $5, 'MANUAL', 'Member', 'Community Members', '', '')
         RETURNING id`,
        [`manual-${ts}`, username.trim(), discord_username.trim(), discord_id.trim(),
         `manual_${ts}@manual.local`]
      );
      const profileId = profileRes.rows[0].id;

      await pool.query(
        `INSERT INTO doc_users (profile_id, username, doc_rank, doc_role, callsign, status, appointed_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7::date)`,
        [profileId, username.trim(), doc_rank, doc_role.trim(), callsign.trim(), status, appointed_date || null]
      );
      const result = await pool.query(
        `SELECT p.id, COALESCE(u.username, p.username) AS username,
                p.discord_username, p.discord_id,
                u.callsign, u.doc_rank, u.doc_role, u.status, u.appointed_date, u.certifications
         FROM doc_users u
         JOIN cad_user_profiles p ON p.id = u.profile_id
         WHERE u.profile_id = $1`,
        [profileId]
      );
      const actor = (req.body as Record<string, string>).actor || (req.headers['x-actor'] as string) || 'Admin';
      await writeLog('doc_personnel', actor, 'Added new member', `${username.trim()} — ${doc_rank}`);
      res.status(201).json(result.rows[0]);
    }
  } catch (err) {
    req.log.error({ err }, "doc POST error");
    res.status(500).json({ error: "Unable to add member." });
  }
});

// ── DELETE — remove a member from the DOC roster ─────────────────────────────
router.delete("/doc/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid id." }); return; }
  try {
    const profileRes = await pool.query<{ community_code: string }>(
      `SELECT community_code FROM cad_user_profiles WHERE id = $1`, [id]
    );
    if ((profileRes.rowCount ?? 0) === 0) { res.status(404).json({ error: "Member not found." }); return; }

    const usernameRes = await pool.query<{ username: string }>(
      `SELECT COALESCE(d.username, p.username) AS username FROM cad_user_profiles p LEFT JOIN doc_users d ON d.profile_id = p.id WHERE p.id = $1`, [id]
    );
    const removedName = usernameRes.rows[0]?.username ?? String(id);

    if (profileRes.rows[0].community_code === "MANUAL") {
      await pool.query(`DELETE FROM cad_user_profiles WHERE id = $1`, [id]);
    } else {
      await pool.query(`DELETE FROM doc_users WHERE profile_id = $1`, [id]);
    }
    const actor = (req.headers['x-actor'] as string) || 'Admin';
    await writeLog('doc_personnel', actor, 'Removed member from roster', removedName);
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "doc DELETE error");
    res.status(500).json({ error: "Unable to remove member." });
  }
});

// ── GET ranks ─────────────────────────────────────────────────────────────────
router.get("/doc/ranks", async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, sort_order, group_id, color_hex, callsign_prefix, insignia_url
       FROM doc_ranks ORDER BY sort_order, id`
    );
    res.json(result.rows);
  } catch {
    res.status(500).json({ error: "Unable to load ranks." });
  }
});

// ── GET ranks/:id — single rank detail with member list ───────────────────────
router.get("/doc/ranks/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid id." }); return; }
  try {
    const rankRes = await pool.query(
      `SELECT id, name, sort_order, group_id, color_hex, callsign_prefix, insignia_url
       FROM doc_ranks WHERE id = $1`, [id]
    );
    if (rankRes.rowCount === 0) { res.status(404).json({ error: "Rank not found." }); return; }
    const rank = rankRes.rows[0];

    const membersRes = await pool.query(
      `SELECT p.id, COALESCE(d.username, p.username) AS username,
              p.discord_username, p.discord_id, p.avatar_hash,
              d.callsign, d.doc_rank, d.status
       FROM cad_user_profiles p
       JOIN doc_users d ON d.profile_id = p.id
       WHERE lower(d.doc_rank) = lower($1)
       ORDER BY COALESCE(d.username, p.username)`, [rank.name]
    );
    res.json({ ...rank, members: membersRes.rows });
  } catch (err) {
    req.log.error({ err }, "doc/ranks/:id GET error");
    res.status(500).json({ error: "Unable to load rank." });
  }
});

// ── POST ranks/reorder ────────────────────────────────────────────────────────
router.post("/doc/ranks/reorder", async (req, res) => {
  const { ids } = req.body as { ids?: number[] };
  if (!Array.isArray(ids) || ids.length === 0) {
    res.status(400).json({ error: "ids must be a non-empty array." }); return;
  }
  try {
    await Promise.all(
      ids.map((id, i) => pool.query(`UPDATE doc_ranks SET sort_order = $2 WHERE id = $1`, [id, i]))
    );
    const result = await pool.query(
      `SELECT id, name, sort_order, group_id, color_hex, callsign_prefix, insignia_url
       FROM doc_ranks WHERE id = ANY($1) ORDER BY sort_order`,
      [ids]
    );
    res.json(result.rows);
  } catch (err) {
    req.log.error({ err }, "doc ranks reorder error");
    res.status(500).json({ error: "Unable to reorder ranks." });
  }
});

// ── POST ranks — add a new rank ───────────────────────────────────────────────
router.post("/doc/ranks", async (req, res) => {
  const { name, group_id, color_hex, callsign_prefix, insignia_url } =
    req.body as { name?: string; group_id?: number; color_hex?: string; callsign_prefix?: string; insignia_url?: string };
  if (!name?.trim()) { res.status(400).json({ error: "Name is required." }); return; }
  try {
    const maxRes = await pool.query(`SELECT COALESCE(MAX(sort_order), -1) AS mx FROM doc_ranks`);
    const nextOrder = Number(maxRes.rows[0].mx) + 1;
    const result = await pool.query(
      `INSERT INTO doc_ranks (name, sort_order, group_id, color_hex, callsign_prefix, insignia_url)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, sort_order, group_id, color_hex, callsign_prefix, insignia_url`,
      [name.trim(), nextOrder, group_id ?? null, color_hex ?? null, callsign_prefix?.trim() ?? null, insignia_url?.trim() ?? null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err: unknown) {
    req.log.error({ err }, "doc ranks POST error");
    if (isUniqueViolation(err)) { res.status(409).json({ error: "A rank with that name already exists." }); return; }
    res.status(500).json({ error: "Unable to add rank." });
  }
});

// ── PATCH ranks/:id ───────────────────────────────────────────────────────────
router.patch("/doc/ranks/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid id." }); return; }

  const { name, direction, color_hex, callsign_prefix, insignia_url, group_id } =
    req.body as { name?: string; direction?: "up" | "down"; color_hex?: string; callsign_prefix?: string; insignia_url?: string; group_id?: number | null };

  try {
    if (group_id !== undefined && name === undefined && direction === undefined
        && color_hex === undefined && callsign_prefix === undefined && insignia_url === undefined) {
      const result = await pool.query(
        `UPDATE doc_ranks SET group_id = $2 WHERE id = $1
         RETURNING id, name, sort_order, group_id, color_hex, callsign_prefix, insignia_url`,
        [id, group_id ?? null]
      );
      if (result.rowCount === 0) { res.status(404).json({ error: "Rank not found." }); return; }
      res.json(result.rows[0]); return;
    }

    if (name !== undefined && direction === undefined) {
      if (!name.trim()) { res.status(400).json({ error: "Name cannot be empty." }); return; }
      const result = await pool.query(
        `UPDATE doc_ranks SET name = $2, color_hex = $3, callsign_prefix = $4, insignia_url = $5
         WHERE id = $1
         RETURNING id, name, sort_order, group_id, color_hex, callsign_prefix, insignia_url`,
        [id, name.trim(), color_hex?.trim() || null, callsign_prefix?.trim() || null, insignia_url?.trim() || null]
      );
      if (result.rowCount === 0) { res.status(404).json({ error: "Rank not found." }); return; }
      res.json(result.rows[0]); return;
    }

    if (direction === undefined && (color_hex !== undefined || callsign_prefix !== undefined || insignia_url !== undefined)) {
      const result = await pool.query(
        `UPDATE doc_ranks SET
           color_hex       = CASE WHEN $2::text IS NOT NULL THEN $2 ELSE color_hex END,
           callsign_prefix = CASE WHEN $3::text IS NOT NULL THEN $3 ELSE callsign_prefix END,
           insignia_url    = CASE WHEN $4::text IS NOT NULL THEN $4 ELSE insignia_url END
         WHERE id = $1
         RETURNING id, name, sort_order, group_id, color_hex, callsign_prefix, insignia_url`,
        [id, color_hex ?? null, callsign_prefix?.trim() ?? null, insignia_url?.trim() ?? null]
      );
      if (result.rowCount === 0) { res.status(404).json({ error: "Rank not found." }); return; }
      res.json(result.rows[0]); return;
    }

    if (direction === "up" || direction === "down") {
      const current = await pool.query(`SELECT id, sort_order FROM doc_ranks WHERE id = $1`, [id]);
      if (current.rowCount === 0) { res.status(404).json({ error: "Rank not found." }); return; }
      const currentOrder = current.rows[0].sort_order as number;
      const adjacentRes = await pool.query(
        direction === "up"
          ? `SELECT id, sort_order FROM doc_ranks WHERE sort_order < $1 ORDER BY sort_order DESC LIMIT 1`
          : `SELECT id, sort_order FROM doc_ranks WHERE sort_order > $1 ORDER BY sort_order ASC  LIMIT 1`,
        [currentOrder]
      );
      if (adjacentRes.rowCount === 0) { res.json({ ok: true, noChange: true }); return; }
      const adj = adjacentRes.rows[0];
      await pool.query(
        `UPDATE doc_ranks SET sort_order = CASE WHEN id = $1 THEN $3 WHEN id = $2 THEN $4 END WHERE id IN ($1, $2)`,
        [id, adj.id, adj.sort_order, currentOrder]
      );
      res.json({ ok: true }); return;
    }

    res.status(400).json({ error: "Provide 'name', metadata fields, or 'direction' to reorder." });
  } catch (err: unknown) {
    const pg = err as { code?: string };
    if (pg.code === "23505") { res.status(409).json({ error: "That name is already taken." }); return; }
    req.log.error({ err }, "doc ranks PATCH error");
    res.status(500).json({ error: "Unable to update rank." });
  }
});

// ── DELETE ranks/:id ──────────────────────────────────────────────────────────
router.delete("/doc/ranks/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid id." }); return; }
  try {
    await pool.query(`DELETE FROM doc_ranks WHERE id = $1`, [id]);
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "doc ranks DELETE error");
    res.status(500).json({ error: "Unable to delete rank." });
  }
});

// ── GET groups ────────────────────────────────────────────────────────────────
router.get("/doc/groups", async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, sort_order, panel_access FROM doc_rank_groups ORDER BY sort_order, id`
    );
    res.json(result.rows);
  } catch (err) {
    _req.log.error({ err }, "doc groups GET error");
    res.status(500).json({ error: "Unable to load groups." });
  }
});

// ── POST groups ───────────────────────────────────────────────────────────────
router.post("/doc/groups", async (req, res) => {
  const { name } = req.body as { name?: string };
  if (!name?.trim()) { res.status(400).json({ error: "Name is required." }); return; }
  try {
    const maxRes = await pool.query(`SELECT COALESCE(MAX(sort_order), 0) AS mx FROM doc_rank_groups`);
    const nextOrder = Number(maxRes.rows[0].mx) + 1;
    const result = await pool.query(
      `INSERT INTO doc_rank_groups (name, sort_order) VALUES ($1, $2) RETURNING id, name, sort_order, panel_access`,
      [name.trim(), nextOrder]
    );
    res.status(201).json(result.rows[0]);
  } catch (err: unknown) {
    const pg = err as { code?: string };
    if (pg.code === "23505") { res.status(409).json({ error: "A group with that name already exists." }); return; }
    req.log.error({ err }, "doc groups POST error");
    res.status(500).json({ error: "Unable to add group." });
  }
});

// ── POST groups/reorder ───────────────────────────────────────────────────────
router.post("/doc/groups/reorder", async (req, res) => {
  const { ids } = req.body as { ids?: number[] };
  if (!Array.isArray(ids) || ids.length === 0) {
    res.status(400).json({ error: "ids must be a non-empty array." }); return;
  }
  try {
    await Promise.all(
      ids.map((id, i) => pool.query(`UPDATE doc_rank_groups SET sort_order = $2 WHERE id = $1`, [id, i]))
    );
    const result = await pool.query(
      `SELECT id, name, sort_order, panel_access FROM doc_rank_groups WHERE id = ANY($1) ORDER BY sort_order`,
      [ids]
    );
    res.json(result.rows);
  } catch (err) {
    req.log.error({ err }, "doc groups reorder error");
    res.status(500).json({ error: "Unable to reorder groups." });
  }
});

// ── PATCH groups/:id ──────────────────────────────────────────────────────────
router.patch("/doc/groups/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid id." }); return; }

  const { name, direction, panel_access } =
    req.body as { name?: string; direction?: "up" | "down"; panel_access?: boolean };

  try {
    if (panel_access !== undefined && name === undefined && direction === undefined) {
      const result = await pool.query(
        `UPDATE doc_rank_groups SET panel_access = $2 WHERE id = $1
         RETURNING id, name, sort_order, panel_access`,
        [id, panel_access]
      );
      if (result.rowCount === 0) { res.status(404).json({ error: "Group not found." }); return; }
      const actor = (req.body as Record<string, unknown>).actor as string || (req.headers['x-actor'] as string) || 'Admin';
      const groupName = result.rows[0].name as string;
      await writeLog('doc_personnel', actor,
        panel_access ? 'Granted panel access' : 'Revoked panel access',
        `Group: ${groupName}`
      );
      res.json(result.rows[0]); return;
    }

    if (name !== undefined) {
      if (!name.trim()) { res.status(400).json({ error: "Name cannot be empty." }); return; }
      const result = await pool.query(
        `UPDATE doc_rank_groups SET name = $2 WHERE id = $1
         RETURNING id, name, sort_order, panel_access`,
        [id, name.trim()]
      );
      if (result.rowCount === 0) { res.status(404).json({ error: "Group not found." }); return; }
      res.json(result.rows[0]); return;
    }

    if (direction === "up" || direction === "down") {
      const current = await pool.query(`SELECT id, sort_order FROM doc_rank_groups WHERE id = $1`, [id]);
      if (current.rowCount === 0) { res.status(404).json({ error: "Group not found." }); return; }
      const currentOrder = current.rows[0].sort_order as number;
      const adjacentRes = await pool.query(
        direction === "up"
          ? `SELECT id, sort_order FROM doc_rank_groups WHERE sort_order < $1 ORDER BY sort_order DESC LIMIT 1`
          : `SELECT id, sort_order FROM doc_rank_groups WHERE sort_order > $1 ORDER BY sort_order ASC  LIMIT 1`,
        [currentOrder]
      );
      if (adjacentRes.rowCount === 0) { res.json({ ok: true, noChange: true }); return; }
      const adj = adjacentRes.rows[0];
      await pool.query(
        `UPDATE doc_rank_groups SET sort_order = CASE WHEN id = $1 THEN $3 WHEN id = $2 THEN $4 END WHERE id IN ($1, $2)`,
        [id, adj.id, adj.sort_order, currentOrder]
      );
      res.json({ ok: true }); return;
    }

    res.status(400).json({ error: "Provide 'name', 'panel_access', or 'direction'." });
  } catch (err: unknown) {
    const pg = err as { code?: string };
    if (pg.code === "23505") { res.status(409).json({ error: "That name is already taken." }); return; }
    req.log.error({ err }, "doc groups PATCH error");
    res.status(500).json({ error: "Unable to update group." });
  }
});

// ── DELETE groups/:id ─────────────────────────────────────────────────────────
router.delete("/doc/groups/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid id." }); return; }
  try {
    await pool.query(
      `UPDATE doc_ranks SET group_id = (
         SELECT id FROM doc_rank_groups WHERE id != $1 ORDER BY sort_order DESC LIMIT 1
       ) WHERE group_id = $1`,
      [id]
    );
    await pool.query(`DELETE FROM doc_rank_groups WHERE id = $1`, [id]);
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "doc groups DELETE error");
    res.status(500).json({ error: "Unable to delete group." });
  }
});

// ── Fleet ─────────────────────────────────────────────────────────────────────
router.get("/doc/vehicles", async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, year, category, category_sort, image_url,
              who_can_drive, restrict_to_divisions, liveries, notes, sort_order
       FROM doc_fleet ORDER BY category_sort, category, sort_order, id`
    );
    res.json(result.rows);
  } catch {
    res.status(500).json({ error: "Unable to load fleet." });
  }
});

router.post("/doc/fleet", async (req, res) => {
  const { name, year = null, category = "General", category_sort = 0, image_url = null,
          who_can_drive = [], restrict_to_divisions = [], liveries = [], notes = null, sort_order = 0 } =
    req.body as Record<string, unknown>;
  if (!name || typeof name !== "string" || !name.trim()) {
    res.status(400).json({ error: "Vehicle name is required." }); return;
  }
  try {
    const result = await pool.query(
      `INSERT INTO doc_fleet (name, year, category, category_sort, image_url, who_can_drive, restrict_to_divisions, liveries, notes, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id, name, year, category, category_sort, image_url, who_can_drive, restrict_to_divisions, liveries, notes, sort_order`,
      [name.trim(), year || null, String(category).trim(), Number(category_sort),
       image_url || null, who_can_drive, restrict_to_divisions, liveries, notes || null, Number(sort_order)]
    );
    const actor = (req.body as Record<string, unknown>).actor as string || (req.headers['x-actor'] as string) || 'Admin';
    await writeLog('doc_vehicles', actor, 'Added vehicle', `${result.rows[0].name} — ${result.rows[0].category}`);
    res.status(201).json(result.rows[0]);
  } catch {
    res.status(500).json({ error: "Unable to add vehicle." });
  }
});

router.patch("/doc/fleet/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { name, year, category, category_sort, image_url, who_can_drive, restrict_to_divisions, liveries, notes, sort_order } =
    req.body as Record<string, unknown>;
  try {
    const result = await pool.query(
      `UPDATE doc_fleet SET
         name                 = COALESCE($1, name),
         year                 = $2,
         category             = COALESCE($3, category),
         category_sort        = COALESCE($4, category_sort),
         image_url            = $5,
         who_can_drive        = COALESCE($6, who_can_drive),
         restrict_to_divisions= COALESCE($7, restrict_to_divisions),
         liveries             = COALESCE($8, liveries),
         notes                = $9,
         sort_order           = COALESCE($10, sort_order)
       WHERE id = $11
       RETURNING id, name, year, category, category_sort, image_url, who_can_drive, restrict_to_divisions, liveries, notes, sort_order`,
      [name ?? null, year ?? null, category ?? null,
       category_sort != null ? Number(category_sort) : null,
       image_url ?? null, who_can_drive ?? null, restrict_to_divisions ?? null,
       liveries ?? null, notes ?? null,
       sort_order != null ? Number(sort_order) : null, id]
    );
    if ((result.rowCount ?? 0) === 0) { res.status(404).json({ error: "Vehicle not found." }); return; }
    const actor = (req.body as Record<string, unknown>).actor as string || (req.headers['x-actor'] as string) || 'Admin';
    await writeLog('doc_vehicles', actor, 'Updated vehicle', result.rows[0].name);
    res.json(result.rows[0]);
  } catch {
    res.status(500).json({ error: "Unable to update vehicle." });
  }
});

router.delete("/doc/fleet/:id", async (req, res) => {
  const id = Number(req.params.id);
  try {
    const result = await pool.query(`DELETE FROM doc_fleet WHERE id=$1 RETURNING id, name`, [id]);
    if ((result.rowCount ?? 0) === 0) { res.status(404).json({ error: "Vehicle not found." }); return; }
    const actor = (req.headers['x-actor'] as string) || 'Admin';
    await writeLog('doc_vehicles', actor, 'Deleted vehicle', result.rows[0]?.name ?? String(id));
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Unable to delete vehicle." });
  }
});

// ── Fleet categories ──────────────────────────────────────────────────────────
router.get("/doc/fleet/categories", async (_req, res) => {
  try {
    const r = await pool.query(`SELECT id, name, sort_order FROM doc_fleet_categories ORDER BY sort_order, id`);
    res.json(r.rows);
  } catch { res.status(500).json({ error: "Unable to load categories." }); }
});

router.post("/doc/fleet/categories", async (req, res) => {
  const { name } = req.body as { name?: string };
  if (!name?.trim()) { res.status(400).json({ error: "Category name required." }); return; }
  try {
    const mx = await pool.query(`SELECT COALESCE(MAX(sort_order),-1) AS m FROM doc_fleet_categories`);
    const r = await pool.query(
      `INSERT INTO doc_fleet_categories (name, sort_order) VALUES ($1,$2) RETURNING id, name, sort_order`,
      [name.trim(), (mx.rows[0].m as number) + 1]
    );
    res.status(201).json(r.rows[0]);
  } catch { res.status(500).json({ error: "Unable to add category." }); }
});

router.patch("/doc/fleet/categories/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { name } = req.body as { name?: string };
  if (!name?.trim()) { res.status(400).json({ error: "Category name required." }); return; }
  try {
    const old = await pool.query(`SELECT name FROM doc_fleet_categories WHERE id=$1`, [id]);
    if ((old.rowCount ?? 0) === 0) { res.status(404).json({ error: "Category not found." }); return; }
    await pool.query(`UPDATE doc_fleet SET category=$1 WHERE category=$2`, [name.trim(), old.rows[0].name]);
    const r = await pool.query(
      `UPDATE doc_fleet_categories SET name=$1 WHERE id=$2 RETURNING id, name, sort_order`,
      [name.trim(), id]
    );
    res.json(r.rows[0]);
  } catch { res.status(500).json({ error: "Unable to rename category." }); }
});

router.delete("/doc/fleet/categories/:id", async (req, res) => {
  const id = Number(req.params.id);
  try {
    const cat = await pool.query(`SELECT name FROM doc_fleet_categories WHERE id=$1`, [id]);
    if ((cat.rowCount ?? 0) === 0) { res.status(404).json({ error: "Category not found." }); return; }
    await pool.query(`DELETE FROM doc_fleet WHERE category=$1`, [cat.rows[0].name]);
    await pool.query(`DELETE FROM doc_fleet_categories WHERE id=$1`, [id]);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: "Unable to delete category." }); }
});

router.post("/doc/fleet/reorder", async (req, res) => {
  const { ids } = req.body as { ids?: number[] };
  if (!Array.isArray(ids)) { res.status(400).json({ error: "ids[] required." }); return; }
  try {
    await Promise.all(ids.map((id, i) => pool.query(`UPDATE doc_fleet SET sort_order=$1 WHERE id=$2`, [i, id])));
    res.json({ ok: true });
  } catch { res.status(500).json({ error: "Unable to reorder vehicles." }); }
});

router.post("/doc/fleet/categories/reorder", async (req, res) => {
  const { ordered } = req.body as { ordered?: number[] };
  if (!Array.isArray(ordered)) { res.status(400).json({ error: "ordered[] required." }); return; }
  try {
    await Promise.all(ordered.map((id, i) => pool.query(`UPDATE doc_fleet_categories SET sort_order=$1 WHERE id=$2`, [i, id])));
    res.json({ ok: true });
  } catch { res.status(500).json({ error: "Unable to reorder categories." }); }
});

export default router;
