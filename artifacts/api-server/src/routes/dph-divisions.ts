// ─────────────────────────────────────────────────────────────────────────────
// routes/dph-divisions.ts  —  DPH Division Roster
//
// Mirrors the DPS Division Roster endpoints in routes/roster.ts, but scoped to
// the dph_* tables and the DPH Discord guild. Every path is prefixed with /dph
// so the mounted routes resolve to /api/dph/…
// ─────────────────────────────────────────────────────────────────────────────
import { Router } from "express";
import { pool } from "@workspace/db";
import { writeLog } from "../lib/audit-log.js";
import {
  DPH_DEFAULT_CALLSIGN,
  loadDphDivisionAssignments,
  setDphMemberDivisionAssignments,
} from "../lib/dph-divisions.js";
import {
  type DphGuildMember,
  DPH_DIVISION_GUILD_ID,
  DPH_GUILD_ID,
  ensureDphMembersCache,
  fetchDphDivisionGuildMembers,
  fetchDphGuildMembers,
  ensureCadProfileForDphDiscordMember,
  getDphDivisionGuildRoles,
} from "../lib/dph-discord.js";

const router = Router();

const DIVISION_SELECT = `id, name, sort_order, discord_role_id, unit_key`;

const DIVISION_RANK_SELECT = `
  id, division_id, name, sort_order, color_hex, insignia_url, discord_role_id,
  callsign_prefix, callsign_type, callsign_static, callsign_min, callsign_max
`;

// ── Divisions ─────────────────────────────────────────────────────────────────

router.get("/dph/divisions", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT ${DIVISION_SELECT} FROM dph_divisions ORDER BY sort_order, id`
    );
    res.json(result.rows);
  } catch (err) {
    req.log.error({ err }, "dph divisions GET error");
    res.status(500).json({ error: "Unable to load divisions." });
  }
});

router.post("/dph/divisions", async (req, res) => {
  const { name, discord_role_id, unit_key } = req.body as {
    name?: string; discord_role_id?: string | null; unit_key?: string | null;
  };
  if (!name?.trim()) { res.status(400).json({ error: "Name is required." }); return; }
  try {
    const maxRes = await pool.query(`SELECT COALESCE(MAX(sort_order), 0) AS mx FROM dph_divisions`);
    const next = Number(maxRes.rows[0]?.mx ?? 0) + 1;
    await pool.query(
      `INSERT INTO dph_divisions (name, sort_order, discord_role_id, unit_key)
       VALUES ($1, $2, $3, $4)`,
      [name.trim(), next, discord_role_id?.trim() || null, unit_key?.trim() || null]
    );
    const result = await pool.query(
      `SELECT ${DIVISION_SELECT} FROM dph_divisions
       WHERE lower(name) = lower($1) ORDER BY id DESC LIMIT 1`,
      [name.trim()]
    );
    const actor = (req.body as Record<string, unknown>).actor as string
      || (req.headers["x-actor"] as string) || "Admin";
    await writeLog("dph_personnel", actor, "Created division", name.trim());
    if (discord_role_id?.trim()) void syncDphDivisionDiscordRoles().catch(console.error);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    req.log.error({ err }, "dph divisions POST error");
    res.status(500).json({ error: "Unable to create division." });
  }
});

router.post("/dph/divisions/reorder", async (req, res) => {
  const { ids } = req.body as { ids?: number[] };
  if (!Array.isArray(ids) || ids.length === 0) {
    res.status(400).json({ error: "ids must be a non-empty array." }); return;
  }
  try {
    await Promise.all(ids.map((id, i) =>
      pool.query(`UPDATE dph_divisions SET sort_order = $2 WHERE id = $1`, [id, i])
    ));
    const result = await pool.query(
      `SELECT ${DIVISION_SELECT} FROM dph_divisions WHERE id = ANY($1) ORDER BY sort_order`,
      [ids]
    );
    res.json(result.rows);
  } catch (err) {
    req.log.error({ err }, "dph divisions reorder error");
    res.status(500).json({ error: "Unable to reorder divisions." });
  }
});

router.patch("/dph/divisions/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid id." }); return; }
  const { name, move, discord_role_id, unit_key } = req.body as {
    name?: string; move?: "up" | "down"; discord_role_id?: string | null; unit_key?: string | null;
  };
  try {
    if (typeof name === "string" && name.trim()) {
      await pool.query(`UPDATE dph_divisions SET name = $2 WHERE id = $1`, [id, name.trim()]);
    }
    if (discord_role_id !== undefined) {
      await pool.query(
        `UPDATE dph_divisions SET discord_role_id = $2 WHERE id = $1`,
        [id, discord_role_id?.trim() || null]
      );
    }
    if (unit_key !== undefined) {
      await pool.query(
        `UPDATE dph_divisions SET unit_key = $2 WHERE id = $1`,
        [id, unit_key?.trim() || null]
      );
    }
    if (move === "up" || move === "down") {
      const current = await pool.query(`SELECT id, sort_order FROM dph_divisions WHERE id = $1`, [id]);
      if (!current.rows.length) { res.status(404).json({ error: "Division not found." }); return; }
      const curOrder = current.rows[0].sort_order as number;
      const neighbor = await pool.query(
        move === "up"
          ? `SELECT id, sort_order FROM dph_divisions WHERE sort_order < $1 ORDER BY sort_order DESC LIMIT 1`
          : `SELECT id, sort_order FROM dph_divisions WHERE sort_order > $1 ORDER BY sort_order ASC  LIMIT 1`,
        [curOrder]
      );
      if (neighbor.rows.length) {
        const n = neighbor.rows[0];
        await pool.query(
          `UPDATE dph_divisions SET sort_order = CASE WHEN id = $1 THEN $3 WHEN id = $2 THEN $4 END WHERE id IN ($1, $2)`,
          [id, n.id, n.sort_order, curOrder]
        );
      }
    }
    const result = await pool.query(
      `SELECT ${DIVISION_SELECT} FROM dph_divisions WHERE id = $1`, [id]
    );
    if (!result.rows.length) { res.status(404).json({ error: "Division not found." }); return; }
    if (discord_role_id !== undefined) void syncDphDivisionDiscordRoles().catch(console.error);
    res.json(result.rows[0]);
  } catch (err) {
    req.log.error({ err }, "dph divisions PATCH error");
    res.status(500).json({ error: "Unable to update division." });
  }
});

router.delete("/dph/divisions/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid id." }); return; }
  try {
    const assigned = await pool.query<{ profile_id: number }>(
      `SELECT DISTINCT profile_id FROM dph_user_divisions WHERE division_id = $1
       UNION
       SELECT profile_id FROM dph_users
       WHERE lower(division_rank) IN (
         SELECT lower(name) FROM dph_division_ranks WHERE division_id = $1
       )`,
      [id]
    );
    await pool.query(`DELETE FROM dph_user_divisions WHERE division_id = $1`, [id]);
    await pool.query(
      `UPDATE dph_users SET division_rank = NULL
       WHERE lower(division_rank) IN (
         SELECT lower(name) FROM dph_division_ranks WHERE division_id = $1
       )`,
      [id]
    );
    await pool.query(`DELETE FROM dph_divisions WHERE id = $1`, [id]);
    for (const row of assigned.rows) {
      const remaining = await loadDphDivisionAssignments([row.profile_id]);
      const list = remaining.get(row.profile_id) ?? [];
      await pool.query(
        `UPDATE dph_users SET division_rank = $2 WHERE profile_id = $1`,
        [row.profile_id, list[0]?.division_rank ?? null]
      );
    }
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "dph divisions DELETE error");
    res.status(500).json({ error: "Unable to delete division." });
  }
});

// ── Division membership ───────────────────────────────────────────────────────

/** Add a member to a division (manual — survives Discord sync until removed). */
router.post("/dph/divisions/:id/members", async (req, res) => {
  const divisionId = Number(req.params.id);
  if (!Number.isInteger(divisionId) || divisionId <= 0) {
    res.status(400).json({ error: "Invalid division id." }); return;
  }

  const {
    profile_id,
    username,
    discord_username = "",
    discord_id = "",
    division_rank,
  } = req.body as {
    profile_id?: number;
    username?: string;
    discord_username?: string;
    discord_id?: string;
    division_rank?: string;
  };

  try {
    const div = await pool.query(`SELECT id, name FROM dph_divisions WHERE id = $1`, [divisionId]);
    if (!div.rows.length) { res.status(404).json({ error: "Division not found." }); return; }

    const ranks = await pool.query<{ name: string; sort_order: number }>(
      `SELECT name, sort_order FROM dph_division_ranks WHERE division_id = $1 ORDER BY sort_order DESC, id DESC`,
      [divisionId]
    );
    if (!ranks.rows.length) {
      res.status(400).json({ error: "Add a division rank before assigning members." }); return;
    }

    const requestedRank = String(division_rank ?? "").trim();
    const rankName = requestedRank
      ? (ranks.rows.find(r => r.name.toLowerCase() === requestedRank.toLowerCase())?.name ?? null)
      : ranks.rows[0].name;
    if (!rankName) { res.status(400).json({ error: "Invalid division rank." }); return; }

    let profileId = Number(profile_id);
    if (!Number.isInteger(profileId) || profileId <= 0) {
      if (!username?.trim()) { res.status(400).json({ error: "Username or profile_id is required." }); return; }

      let found: { id: number } | undefined;
      if (discord_id?.trim()) {
        const byDiscord = await pool.query<{ id: number }>(
          `SELECT id FROM cad_user_profiles WHERE discord_id = $1 LIMIT 1`, [discord_id.trim()]
        );
        found = byDiscord.rows[0];
      }
      if (!found) {
        const byName = await pool.query<{ id: number }>(
          `SELECT id FROM cad_user_profiles WHERE lower(username) = lower($1) LIMIT 1`,
          [username.trim()]
        );
        found = byName.rows[0];
      }

      if (found) {
        profileId = found.id;
        if (discord_username.trim() || discord_id.trim()) {
          await pool.query(
            `UPDATE cad_user_profiles SET
               discord_username = CASE WHEN $2 != '' THEN $2 ELSE discord_username END,
               discord_id       = CASE WHEN $3 != '' THEN $3 ELSE discord_id END,
               updated_at       = NOW()
             WHERE id = $1`,
            [profileId, discord_username.trim(), discord_id.trim()]
          );
        }
      } else {
        const ts = Date.now();
        const created = await pool.query<{ id: number }>(
          `INSERT INTO cad_user_profiles
             (auth_user_id, username, discord_username, discord_id, email,
              community_code, rank, role, password_salt, password_hash)
           VALUES ($1, $2, $3, $4, $5, 'MANUAL', 'Member', 'Community Members', '', '')
           RETURNING id`,
          [
            `manual-dph-div-${ts}`,
            username.trim(),
            discord_username.trim(),
            discord_id.trim(),
            `manual_dph_div_${ts}@manual.local`,
          ]
        );
        profileId = created.rows[0].id;
      }
    }

    await pool.query(
      `INSERT INTO dph_users (profile_id, username, status)
       VALUES ($1, $2, 'Active')
       ON CONFLICT (profile_id) DO UPDATE SET
         username = COALESCE(EXCLUDED.username, dph_users.username),
         status = COALESCE(dph_users.status, 'Active'),
         updated_at = NOW()`,
      [profileId, username?.trim() || null]
    );

    const existing = await loadDphDivisionAssignments([profileId]);
    const current = (existing.get(profileId) ?? [])
      .filter(a => a.division_id !== divisionId)
      .map(a => ({
        division_id: a.division_id,
        division_rank: a.division_rank,
        is_manual: Boolean(a.is_manual),
      }));
    current.push({ division_id: divisionId, division_rank: rankName, is_manual: true });
    const assignments = await setDphMemberDivisionAssignments(profileId, current);

    const member = await pool.query(
      `SELECT p.id, COALESCE(u.username, p.username) AS username,
              p.discord_username, p.discord_id, p.avatar_hash,
              u.callsign, u.dph_rank, u.status
       FROM cad_user_profiles p
       LEFT JOIN dph_users u ON u.profile_id = p.id
       WHERE p.id = $1`,
      [profileId]
    );

    res.status(201).json({
      ...member.rows[0],
      division_assignments: assignments,
      division_rank: assignments.find(a => a.division_id === divisionId)?.division_rank ?? rankName,
    });
  } catch (err) {
    req.log.error({ err }, "dph division members POST error");
    res.status(500).json({ error: "Unable to add member to division." });
  }
});

/** Remove a member from a division only (keeps them on the DPH personnel roster). */
router.delete("/dph/divisions/:id/members/:profileId", async (req, res) => {
  const divisionId = Number(req.params.id);
  const profileId = Number(req.params.profileId);
  if (!Number.isInteger(divisionId) || divisionId <= 0 || !Number.isInteger(profileId) || profileId <= 0) {
    res.status(400).json({ error: "Invalid id." }); return;
  }
  try {
    const existing = await loadDphDivisionAssignments([profileId]);
    const current = existing.get(profileId) ?? [];
    if (!current.some(a => a.division_id === divisionId)) {
      res.status(404).json({ error: "Member is not in this division." }); return;
    }
    const next = current
      .filter(a => a.division_id !== divisionId)
      .map(a => ({
        division_id: a.division_id,
        division_rank: a.division_rank,
        is_manual: Boolean(a.is_manual),
        can_edit_resources: Boolean(a.can_edit_resources),
        can_edit_roster: Boolean(a.can_edit_roster),
        can_edit_info: Boolean(a.can_edit_info),
      }));
    const assignments = await setDphMemberDivisionAssignments(profileId, next);
    res.json({ ok: true, division_assignments: assignments });
  } catch (err) {
    req.log.error({ err }, "dph division members DELETE error");
    res.status(500).json({ error: "Unable to remove member from division." });
  }
});

/** Toggle division resource / roster / info edit permissions for a member. */
router.patch("/dph/divisions/:id/members/:profileId/access", async (req, res) => {
  const divisionId = Number(req.params.id);
  const profileId = Number(req.params.profileId);
  if (!Number.isInteger(divisionId) || divisionId <= 0 || !Number.isInteger(profileId) || profileId <= 0) {
    res.status(400).json({ error: "Invalid id." }); return;
  }
  const { can_edit_resources, can_edit_roster, can_edit_info } = req.body as {
    can_edit_resources?: boolean;
    can_edit_roster?: boolean;
    can_edit_info?: boolean;
  };
  if (can_edit_resources === undefined && can_edit_roster === undefined && can_edit_info === undefined) {
    res.status(400).json({ error: "Provide can_edit_resources, can_edit_roster, and/or can_edit_info." }); return;
  }
  try {
    const existing = await loadDphDivisionAssignments([profileId]);
    const current = existing.get(profileId) ?? [];
    if (!current.some(a => a.division_id === divisionId)) {
      res.status(404).json({ error: "Member is not in this division." }); return;
    }
    const next = current.map(a => ({
      division_id: a.division_id,
      division_rank: a.division_rank,
      is_manual: Boolean(a.is_manual),
      can_edit_resources: a.division_id === divisionId && can_edit_resources !== undefined
        ? Boolean(can_edit_resources)
        : Boolean(a.can_edit_resources),
      can_edit_roster: a.division_id === divisionId && can_edit_roster !== undefined
        ? Boolean(can_edit_roster)
        : Boolean(a.can_edit_roster),
      can_edit_info: a.division_id === divisionId && can_edit_info !== undefined
        ? Boolean(can_edit_info)
        : Boolean(a.can_edit_info),
    }));
    const assignments = await setDphMemberDivisionAssignments(profileId, next);
    const updated = assignments.find(a => a.division_id === divisionId) ?? null;

    const actor = (req.body as Record<string, unknown>).actor as string
      || (req.headers["x-actor"] as string) || "Admin";
    const bits: string[] = [];
    if (can_edit_resources !== undefined) bits.push(`resources ${can_edit_resources ? "granted" : "revoked"}`);
    if (can_edit_roster !== undefined) bits.push(`roster ${can_edit_roster ? "granted" : "revoked"}`);
    if (can_edit_info !== undefined) bits.push(`info ${can_edit_info ? "granted" : "revoked"}`);
    await writeLog(
      "dph_personnel",
      actor,
      "Updated division member access",
      `Profile ${profileId} — division ${divisionId}: ${bits.join(", ")}`,
    );
    res.json({ ok: true, assignment: updated, division_assignments: assignments });
  } catch (err) {
    req.log.error({ err }, "dph division member access PATCH error");
    res.status(500).json({ error: "Unable to update division access." });
  }
});

// ── Division information content ──────────────────────────────────────────────

const parseDivisionInfoContent = (raw: unknown): { sections: unknown[] } => {
  if (raw == null) return { sections: [] };
  if (typeof raw === "object" && !Array.isArray(raw) && Array.isArray((raw as { sections?: unknown }).sections)) {
    return { sections: (raw as { sections: unknown[] }).sections };
  }
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && Array.isArray((parsed as { sections?: unknown }).sections)) {
        return { sections: (parsed as { sections: unknown[] }).sections };
      }
    } catch { /* ignore */ }
  }
  return { sections: [] };
};

router.get("/dph/divisions/:id/info", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid id." }); return; }
  try {
    const result = await pool.query<{ id: number; name: string; info_content: unknown }>(
      `SELECT id, name, COALESCE(info_content, '{"sections":[]}') AS info_content
         FROM dph_divisions WHERE id = $1`,
      [id],
    );
    if (!result.rows.length) { res.status(404).json({ error: "Division not found." }); return; }
    const row = result.rows[0];
    res.json({ id: row.id, name: row.name, ...parseDivisionInfoContent(row.info_content) });
  } catch (err) {
    req.log.error({ err }, "dph division info GET error");
    res.status(500).json({ error: "Unable to load division information." });
  }
});

router.put("/dph/divisions/:id/info", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid id." }); return; }
  const sections = Array.isArray((req.body as { sections?: unknown }).sections)
    ? (req.body as { sections: unknown[] }).sections
    : null;
  if (!sections) { res.status(400).json({ error: "sections array is required." }); return; }
  try {
    const result = await pool.query(
      `UPDATE dph_divisions SET info_content = $2 WHERE id = $1
       RETURNING id, name, info_content`,
      [id, JSON.stringify({ sections })],
    );
    if (!result.rows.length) { res.status(404).json({ error: "Division not found." }); return; }
    const row = result.rows[0] as { id: number; name: string; info_content: unknown };
    const actor = (req.body as Record<string, unknown>).actor as string
      || (req.headers["x-actor"] as string) || "Admin";
    await writeLog("dph_personnel", actor, "Updated division information",
      `${row.name} — ${sections.length} section(s)`);
    res.json({ id: row.id, name: row.name, ...parseDivisionInfoContent(row.info_content) });
  } catch (err) {
    req.log.error({ err }, "dph division info PUT error");
    res.status(500).json({ error: "Unable to save division information." });
  }
});

// ── Division ranks ────────────────────────────────────────────────────────────

async function loadDivisionRankMembers(divisionId: number | null, rankName: string) {
  const result = await pool.query<{
    id: number; username: string; discord_username: string | null; discord_id: string | null;
    avatar_hash: string | null; callsign: string | null; status: string | null;
  }>(
    `SELECT p.id,
            COALESCE(d.username, p.username) AS username,
            p.discord_username,
            p.discord_id,
            p.avatar_hash,
            COALESCE(d.callsign, 'DPH-XX') AS callsign,
            COALESCE(d.status, 'Active') AS status
     FROM dph_user_divisions ud
     JOIN cad_user_profiles p ON p.id = ud.profile_id
     LEFT JOIN dph_users d ON d.profile_id = p.id
     WHERE lower(ud.division_rank) = lower($1)
       AND (ud.division_id = $2 OR (ud.division_id IS NULL AND $2 IS NULL))
     ORDER BY COALESCE(d.username, p.username)`,
    [rankName, divisionId]
  );
  return result.rows;
}

/** Sync callsigns for members assigned to a division rank (writes dph_users.callsign). */
async function syncDivisionRankCallsigns(rankId: number): Promise<void> {
  try {
    const rankRes = await pool.query<{
      name: string; division_id: number | null;
      callsign_type: string | null; callsign_prefix: string | null;
      callsign_static: string | null; callsign_min: number | null; callsign_max: number | null;
    }>(
      `SELECT name, division_id, callsign_type, callsign_prefix, callsign_static, callsign_min, callsign_max
       FROM dph_division_ranks WHERE id = $1`, [rankId]
    );
    if (!rankRes.rows.length) return;
    const {
      name: rankName, division_id, callsign_type, callsign_prefix,
      callsign_static, callsign_min, callsign_max,
    } = rankRes.rows[0];

    if (!callsign_type || callsign_type === "custom") return;

    const prefix = callsign_prefix?.trim() ?? "";
    const join = (suffix: string) => (prefix ? `${prefix}-${suffix}` : suffix);

    const members = await loadDivisionRankMembers(division_id, rankName);
    if (!members.length) return;

    if (callsign_type === "static") {
      if (!callsign_static?.trim()) return;
      const target = join(callsign_static.trim());
      await Promise.all(members.map(m =>
        pool.query(
          `UPDATE dph_users SET callsign = $2, updated_at = NOW() WHERE profile_id = $1`,
          [m.id, target]
        )
      ));
      return;
    }

    if (callsign_type === "dynamic" && callsign_min !== null && callsign_max !== null) {
      const padLen = Math.max(String(callsign_max).length, 2);
      const usedNums = new Set<number>();
      const needsAssignment: number[] = [];

      for (const m of members) {
        const cs = m.callsign ?? "";
        const parts = cs.split("-");
        const numStr = parts[parts.length - 1];
        const n = parseInt(numStr, 10);
        const hasValidPrefix = prefix ? cs.startsWith(prefix + "-") : parts.length === 1;
        const hasValidNum =
          !isNaN(n) && n >= callsign_min && n <= callsign_max &&
          numStr === String(n).padStart(padLen, "0");
        if (hasValidPrefix && hasValidNum) usedNums.add(n);
        else needsAssignment.push(m.id);
      }

      let next = callsign_min;
      for (const profileId of needsAssignment) {
        while (next <= callsign_max && usedNums.has(next)) next++;
        if (next > callsign_max) break;
        await pool.query(
          `UPDATE dph_users SET callsign = $2, updated_at = NOW() WHERE profile_id = $1`,
          [profileId, join(String(next).padStart(padLen, "0"))]
        );
        usedNums.add(next);
        next++;
      }
    }
  } catch (e) {
    console.error("[dph-division-callsign-sync] error:", e);
  }
}

router.get("/dph/division-ranks", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT ${DIVISION_RANK_SELECT} FROM dph_division_ranks ORDER BY sort_order, id`
    );
    res.json(result.rows);
  } catch (err) {
    req.log.error({ err }, "dph division-ranks GET error");
    res.status(500).json({ error: "Unable to load division ranks." });
  }
});

router.get("/dph/division-ranks/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid id." }); return; }
  try {
    const rankRes = await pool.query(
      `SELECT ${DIVISION_RANK_SELECT} FROM dph_division_ranks WHERE id = $1`, [id]
    );
    if (!rankRes.rows.length) { res.status(404).json({ error: "Division rank not found." }); return; }
    const rank = rankRes.rows[0] as {
      id: number; division_id: number | null; name: string;
      callsign_type: string | null; callsign_max: number | null;
    };
    let members = await loadDivisionRankMembers(rank.division_id, rank.name);
    if (rank.callsign_type === "dynamic") {
      members = [...members].sort((a, b) => {
        const nA = parseInt((a.callsign ?? "").split("-").pop() ?? "", 10);
        const nB = parseInt((b.callsign ?? "").split("-").pop() ?? "", 10);
        return (!isNaN(nA) && !isNaN(nB)) ? nA - nB : (a.callsign ?? "").localeCompare(b.callsign ?? "");
      });
    }
    const csRes = await pool.query(
      `SELECT cc.id, cc.division_rank_id, cc.callsign, cc.assigned_profile_id, cc.sort_order,
              COALESCE(d.username, p.username) AS assigned_username
       FROM dph_division_rank_custom_callsigns cc
       LEFT JOIN cad_user_profiles p ON p.id = cc.assigned_profile_id
       LEFT JOIN dph_users d ON d.profile_id = p.id
       WHERE cc.division_rank_id = $1
       ORDER BY cc.sort_order, cc.id`,
      [id]
    );
    res.json({ ...rank, members, custom_callsigns: csRes.rows });
  } catch (err) {
    req.log.error({ err }, "dph division-ranks GET :id error");
    res.status(500).json({ error: "Unable to load division rank." });
  }
});

router.post("/dph/division-ranks", async (req, res) => {
  const {
    name, division_id, color_hex, insignia_url, discord_role_id,
    callsign_prefix, callsign_type, callsign_static, callsign_min, callsign_max,
  } = req.body as {
    name?: string; division_id?: number; color_hex?: string | null;
    insignia_url?: string | null; discord_role_id?: string | null;
    callsign_prefix?: string | null; callsign_type?: string | null;
    callsign_static?: string | null; callsign_min?: number | null; callsign_max?: number | null;
  };
  if (!name?.trim()) { res.status(400).json({ error: "Name is required." }); return; }
  try {
    const maxRes = await pool.query(
      `SELECT COALESCE(MAX(sort_order), -1) AS mx FROM dph_division_ranks
       WHERE (division_id = $1 OR (division_id IS NULL AND $1 IS NULL))`,
      [division_id ?? null]
    );
    const next = Number(maxRes.rows[0]?.mx ?? -1) + 1;
    const csMin = callsign_min !== undefined && callsign_min !== null ? (parseInt(String(callsign_min)) || 0) : null;
    const csMax = callsign_max !== undefined && callsign_max !== null ? (parseInt(String(callsign_max)) || 0) : null;
    await pool.query(
      `INSERT INTO dph_division_ranks
         (name, sort_order, division_id, color_hex, insignia_url, discord_role_id,
          callsign_prefix, callsign_type, callsign_static, callsign_min, callsign_max)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        name.trim(), next, division_id ?? null, color_hex ?? null, insignia_url ?? null,
        discord_role_id?.trim() || null,
        callsign_prefix?.trim() || null, callsign_type?.trim() || null,
        callsign_static?.trim() || null, csMin, csMax,
      ]
    );
    const result = await pool.query(
      `SELECT ${DIVISION_RANK_SELECT}
       FROM dph_division_ranks
       WHERE lower(name) = lower($1)
         AND (division_id = $2 OR (division_id IS NULL AND $2 IS NULL))
       ORDER BY id DESC LIMIT 1`,
      [name.trim(), division_id ?? null]
    );
    if (discord_role_id?.trim()) void syncDphDivisionDiscordRoles().catch(console.error);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    req.log.error({ err }, "dph division-ranks POST error");
    res.status(500).json({ error: "Unable to create division rank." });
  }
});

router.post("/dph/division-ranks/reorder", async (req, res) => {
  const { ids } = req.body as { ids?: number[] };
  if (!Array.isArray(ids) || ids.length === 0) {
    res.status(400).json({ error: "ids must be a non-empty array." }); return;
  }
  try {
    await Promise.all(ids.map((id, i) =>
      pool.query(`UPDATE dph_division_ranks SET sort_order = $2 WHERE id = $1`, [id, i])
    ));
    const result = await pool.query(
      `SELECT ${DIVISION_RANK_SELECT} FROM dph_division_ranks WHERE id = ANY($1) ORDER BY sort_order`,
      [ids]
    );
    res.json(result.rows);
  } catch (err) {
    req.log.error({ err }, "dph division-ranks reorder error");
    res.status(500).json({ error: "Unable to reorder division ranks." });
  }
});

router.patch("/dph/division-ranks/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid id." }); return; }
  const {
    name, division_id, color_hex, insignia_url, discord_role_id, move,
    callsign_prefix, callsign_type, callsign_static, callsign_min, callsign_max,
  } = req.body as {
    name?: string; division_id?: number | null; color_hex?: string | null;
    insignia_url?: string | null; discord_role_id?: string | null; move?: "up" | "down";
    callsign_prefix?: string | null; callsign_type?: string | null;
    callsign_static?: string | null; callsign_min?: number | null; callsign_max?: number | null;
  };
  try {
    const cur = await pool.query<{ name: string; division_id: number | null }>(
      `SELECT name, division_id FROM dph_division_ranks WHERE id = $1`, [id]
    );
    if (!cur.rows.length) { res.status(404).json({ error: "Division rank not found." }); return; }
    const oldName = cur.rows[0].name;
    const oldDivisionId = cur.rows[0].division_id;

    const hasMeta =
      name !== undefined || division_id !== undefined || color_hex !== undefined
      || insignia_url !== undefined || discord_role_id !== undefined
      || callsign_prefix !== undefined || callsign_type !== undefined
      || callsign_static !== undefined || callsign_min !== undefined || callsign_max !== undefined;

    if (hasMeta) {
      const csMin = callsign_min !== undefined
        ? (callsign_min === null ? null : parseInt(String(callsign_min)) || 0)
        : null;
      const csMax = callsign_max !== undefined
        ? (callsign_max === null ? null : parseInt(String(callsign_max)) || 0)
        : null;
      await pool.query(
        `UPDATE dph_division_ranks SET
           name            = COALESCE($2, name),
           division_id     = CASE WHEN $3::boolean THEN $4 ELSE division_id END,
           color_hex       = CASE WHEN $5::boolean THEN $6 ELSE color_hex END,
           insignia_url    = CASE WHEN $7::boolean THEN $8 ELSE insignia_url END,
           discord_role_id = CASE WHEN $9::boolean THEN $10 ELSE discord_role_id END,
           callsign_prefix = CASE WHEN $11::boolean THEN $12 ELSE callsign_prefix END,
           callsign_type   = CASE WHEN $13::boolean THEN $14 ELSE callsign_type END,
           callsign_static = CASE WHEN $15::boolean THEN $16 ELSE callsign_static END,
           callsign_min    = CASE WHEN $17::boolean THEN $18 ELSE callsign_min END,
           callsign_max    = CASE WHEN $19::boolean THEN $20 ELSE callsign_max END
         WHERE id = $1`,
        [
          id,
          name?.trim() || null,
          division_id !== undefined, division_id ?? null,
          color_hex !== undefined, color_hex ?? null,
          insignia_url !== undefined, insignia_url ?? null,
          discord_role_id !== undefined, discord_role_id?.trim() || null,
          callsign_prefix !== undefined, callsign_prefix?.trim() || null,
          callsign_type !== undefined, callsign_type?.trim() || null,
          callsign_static !== undefined, callsign_static?.trim() || null,
          callsign_min !== undefined, csMin,
          callsign_max !== undefined, csMax,
        ]
      );
      if (name?.trim() && name.trim().toLowerCase() !== oldName.toLowerCase()) {
        await pool.query(
          `UPDATE dph_user_divisions SET division_rank = $2
           WHERE lower(division_rank) = lower($1)
             AND (division_id = $3 OR (division_id IS NULL AND $3 IS NULL))`,
          [oldName, name.trim(), oldDivisionId]
        );
        await pool.query(
          `UPDATE dph_users SET division_rank = $2 WHERE lower(division_rank) = lower($1)`,
          [oldName, name.trim()]
        );
      }
      if (
        callsign_type !== undefined || callsign_static !== undefined
        || callsign_min !== undefined || callsign_max !== undefined
        || callsign_prefix !== undefined
      ) {
        void syncDivisionRankCallsigns(id);
      }
      if (discord_role_id !== undefined) void syncDphDivisionDiscordRoles().catch(console.error);
    }

    if (move === "up" || move === "down") {
      const current = await pool.query(`SELECT id, sort_order, division_id FROM dph_division_ranks WHERE id = $1`, [id]);
      const row = current.rows[0];
      if (row) {
        const neighbor = await pool.query(
          move === "up"
            ? `SELECT id, sort_order FROM dph_division_ranks
               WHERE (division_id = $1 OR (division_id IS NULL AND $1 IS NULL)) AND sort_order < $2
               ORDER BY sort_order DESC LIMIT 1`
            : `SELECT id, sort_order FROM dph_division_ranks
               WHERE (division_id = $1 OR (division_id IS NULL AND $1 IS NULL)) AND sort_order > $2
               ORDER BY sort_order ASC LIMIT 1`,
          [row.division_id, row.sort_order]
        );
        if (neighbor.rows.length) {
          const n = neighbor.rows[0];
          await pool.query(
            `UPDATE dph_division_ranks SET sort_order = CASE WHEN id = $1 THEN $3 WHEN id = $2 THEN $4 END WHERE id IN ($1, $2)`,
            [id, n.id, n.sort_order, row.sort_order]
          );
        }
      }
    }

    const result = await pool.query(
      `SELECT ${DIVISION_RANK_SELECT} FROM dph_division_ranks WHERE id = $1`, [id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    req.log.error({ err }, "dph division-ranks PATCH error");
    res.status(500).json({ error: "Unable to update division rank." });
  }
});

router.delete("/dph/division-ranks/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid id." }); return; }
  try {
    const cur = await pool.query<{ name: string; division_id: number | null }>(
      `SELECT name, division_id FROM dph_division_ranks WHERE id = $1`, [id]
    );
    if (cur.rows.length) {
      const rankName = cur.rows[0].name;
      const affected = await pool.query<{ profile_id: number }>(
        `SELECT DISTINCT profile_id FROM dph_user_divisions WHERE lower(division_rank) = lower($1)
         UNION
         SELECT profile_id FROM dph_users WHERE lower(division_rank) = lower($1)`,
        [rankName]
      );
      await pool.query(`DELETE FROM dph_user_divisions WHERE lower(division_rank) = lower($1)`, [rankName]);
      await pool.query(`UPDATE dph_users SET division_rank = NULL WHERE lower(division_rank) = lower($1)`, [rankName]);
      for (const row of affected.rows) {
        const remaining = await loadDphDivisionAssignments([row.profile_id]);
        const list = remaining.get(row.profile_id) ?? [];
        await pool.query(
          `UPDATE dph_users SET division_rank = $2 WHERE profile_id = $1`,
          [row.profile_id, list[0]?.division_rank ?? null]
        );
      }
    }
    await pool.query(`DELETE FROM dph_division_ranks WHERE id = $1`, [id]);
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "dph division-ranks DELETE error");
    res.status(500).json({ error: "Unable to delete division rank." });
  }
});

router.post("/dph/division-ranks/:id/auto-assign-callsigns", async (req, res) => {
  const rankId = Number(req.params.id);
  if (!Number.isInteger(rankId) || rankId <= 0) { res.status(400).json({ error: "Invalid id." }); return; }
  try {
    const rankRes = await pool.query<{
      name: string; division_id: number | null; callsign_type: string | null;
      callsign_prefix: string | null; callsign_min: number | null; callsign_max: number | null;
    }>(
      `SELECT name, division_id, callsign_type, callsign_prefix, callsign_min, callsign_max
       FROM dph_division_ranks WHERE id = $1`, [rankId]
    );
    if (!rankRes.rows.length) { res.status(404).json({ error: "Division rank not found." }); return; }
    const { name: rankName, division_id, callsign_type, callsign_prefix, callsign_min, callsign_max } = rankRes.rows[0];
    if (callsign_type !== "dynamic") { res.status(400).json({ error: "Rank is not dynamic type." }); return; }

    const prefix = callsign_prefix?.trim() ?? "";
    const min = callsign_min ?? 0;
    const max = callsign_max ?? 0;
    const padLen = Math.max(String(max).length, 2);
    const join = (suffix: string) => (prefix ? `${prefix}-${suffix}` : suffix);

    const members = await loadDivisionRankMembers(division_id, rankName);
    const usedNums = new Set<number>();
    const results: { profile_id: number; callsign: string }[] = [];

    for (const member of members) {
      const cs = member.callsign ?? "";
      const parts = cs.split("-");
      const numStr = parts[parts.length - 1];
      const n = parseInt(numStr, 10);
      const hasValidPrefix = prefix ? cs.startsWith(prefix + "-") : parts.length === 1;
      const hasValidNum =
        !isNaN(n) && n >= min && n <= max && numStr === String(n).padStart(padLen, "0");
      if (hasValidPrefix && hasValidNum) {
        usedNums.add(n);
        results.push({ profile_id: member.id, callsign: cs });
      }
    }

    let next = min;
    for (const member of members) {
      if (results.some(r => r.profile_id === member.id)) continue;
      while (next <= max && usedNums.has(next)) next++;
      if (next > max) {
        results.push({ profile_id: member.id, callsign: member.callsign ?? DPH_DEFAULT_CALLSIGN });
        continue;
      }
      const callsign = join(String(next).padStart(padLen, "0"));
      await pool.query(`UPDATE dph_users SET callsign = $2 WHERE profile_id = $1`, [member.id, callsign]);
      usedNums.add(next);
      results.push({ profile_id: member.id, callsign });
      next++;
    }

    res.json({ results });
  } catch (err) {
    req.log.error({ err }, "dph division auto-assign-callsigns error");
    res.status(500).json({ error: "Unable to auto-assign callsigns." });
  }
});

router.post("/dph/division-ranks/:id/custom-callsigns/reorder", async (req, res) => {
  const rankId = Number(req.params.id);
  if (!Number.isInteger(rankId) || rankId <= 0) { res.status(400).json({ error: "Invalid id." }); return; }
  const { ids } = req.body as { ids?: number[] };
  if (!Array.isArray(ids)) { res.status(400).json({ error: "ids required." }); return; }
  try {
    await Promise.all(ids.map((csId, i) =>
      pool.query(
        `UPDATE dph_division_rank_custom_callsigns SET sort_order = $2 WHERE id = $1 AND division_rank_id = $3`,
        [csId, i, rankId]
      )
    ));
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "dph division custom-callsigns reorder error");
    res.status(500).json({ error: "Unable to reorder custom callsigns." });
  }
});

router.post("/dph/division-ranks/:id/custom-callsigns", async (req, res) => {
  const rankId = Number(req.params.id);
  if (!Number.isInteger(rankId) || rankId <= 0) { res.status(400).json({ error: "Invalid id." }); return; }
  const { callsign } = req.body as { callsign?: string };
  if (!callsign?.trim()) { res.status(400).json({ error: "Callsign is required." }); return; }
  try {
    const maxRes = await pool.query<{ mx: number }>(
      `SELECT COALESCE(MAX(sort_order), -1) + 1 AS mx FROM dph_division_rank_custom_callsigns WHERE division_rank_id = $1`,
      [rankId]
    );
    const result = await pool.query(
      `INSERT INTO dph_division_rank_custom_callsigns (division_rank_id, callsign, sort_order)
       VALUES ($1, $2, $3)
       RETURNING id, division_rank_id, callsign, assigned_profile_id, sort_order, NULL::text AS assigned_username`,
      [rankId, callsign.trim(), Number(maxRes.rows[0]?.mx ?? 0)]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    req.log.error({ err }, "dph division custom-callsigns POST error");
    res.status(500).json({ error: "Unable to add custom callsign." });
  }
});

router.patch("/dph/division-rank-callsigns/:csId", async (req, res) => {
  const csId = Number(req.params.csId);
  if (!Number.isInteger(csId) || csId <= 0) { res.status(400).json({ error: "Invalid id." }); return; }
  const { callsign, assigned_profile_id } = req.body as { callsign?: string; assigned_profile_id?: number | null };
  try {
    if (callsign !== undefined) {
      if (!callsign.trim()) { res.status(400).json({ error: "Callsign cannot be empty." }); return; }
      await pool.query(`UPDATE dph_division_rank_custom_callsigns SET callsign = $2 WHERE id = $1`, [csId, callsign.trim()]);
      const asgn = await pool.query<{ assigned_profile_id: number | null }>(
        `SELECT assigned_profile_id FROM dph_division_rank_custom_callsigns WHERE id = $1`, [csId]
      );
      const pid = asgn.rows[0]?.assigned_profile_id;
      if (pid) await pool.query(`UPDATE dph_users SET callsign = $2 WHERE profile_id = $1`, [pid, callsign.trim()]);
    }
    if (assigned_profile_id !== undefined) {
      const cur = await pool.query<{ assigned_profile_id: number | null; callsign: string }>(
        `SELECT assigned_profile_id, callsign FROM dph_division_rank_custom_callsigns WHERE id = $1`, [csId]
      );
      const prevPid = cur.rows[0]?.assigned_profile_id;
      const csText = cur.rows[0]?.callsign ?? "";
      if (prevPid && prevPid !== assigned_profile_id) {
        await pool.query(`UPDATE dph_users SET callsign = $2 WHERE profile_id = $1`, [prevPid, DPH_DEFAULT_CALLSIGN]);
      }
      await pool.query(
        `UPDATE dph_division_rank_custom_callsigns SET assigned_profile_id = $2 WHERE id = $1`,
        [csId, assigned_profile_id ?? null]
      );
      if (assigned_profile_id) {
        await pool.query(`UPDATE dph_users SET callsign = $2 WHERE profile_id = $1`, [assigned_profile_id, csText]);
      }
    }
    const updated = await pool.query(
      `SELECT cc.id, cc.division_rank_id, cc.callsign, cc.assigned_profile_id, cc.sort_order,
              COALESCE(d.username, p.username) AS assigned_username
       FROM dph_division_rank_custom_callsigns cc
       LEFT JOIN cad_user_profiles p ON p.id = cc.assigned_profile_id
       LEFT JOIN dph_users d ON d.profile_id = p.id
       WHERE cc.id = $1`, [csId]
    );
    res.json(updated.rows[0]);
  } catch (err) {
    req.log.error({ err }, "dph division-rank-callsigns PATCH error");
    res.status(500).json({ error: "Unable to update custom callsign." });
  }
});

router.delete("/dph/division-rank-callsigns/:csId", async (req, res) => {
  const csId = Number(req.params.csId);
  if (!Number.isInteger(csId) || csId <= 0) { res.status(400).json({ error: "Invalid id." }); return; }
  try {
    const cur = await pool.query<{ assigned_profile_id: number | null }>(
      `SELECT assigned_profile_id FROM dph_division_rank_custom_callsigns WHERE id = $1`, [csId]
    );
    const pid = cur.rows[0]?.assigned_profile_id;
    if (pid) await pool.query(`UPDATE dph_users SET callsign = $2 WHERE profile_id = $1`, [pid, DPH_DEFAULT_CALLSIGN]);
    await pool.query(`DELETE FROM dph_division_rank_custom_callsigns WHERE id = $1`, [csId]);
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "dph division-rank-callsigns DELETE error");
    res.status(500).json({ error: "Unable to delete custom callsign." });
  }
});

// ── Discord sync for DPH division assignments ─────────────────────────────────

/**
 * Sync DPH Division Roster assignments from Discord roles on the DPH guild.
 *
 * Membership gate: when a division has discord_role_id, the member must hold
 * that role to stay on the division roster (manual adds are preserved).
 * Rank placement: linked division-rank roles pick the highest hierarchy match;
 * holding only the division membership role grants the junior-most rank.
 */
export async function syncDphDivisionDiscordRoles(
  preloadedMembers?: DphGuildMember[],
): Promise<{ assigned: number; skipped: number; removed: number; errors: string[] }> {
  const tok = process.env.DISCORD_BOT_TOKEN;
  if (!tok) return { assigned: 0, skipped: 0, removed: 0, errors: ["No DISCORD_BOT_TOKEN configured"] };

  try {
    const allMembers = (
      preloadedMembers && DPH_DIVISION_GUILD_ID === DPH_GUILD_ID
    ) ? preloadedMembers : await fetchDphDivisionGuildMembers();

    const membershipDivs = await pool.query<{ id: number; discord_role_id: string }>(
      `SELECT id, discord_role_id FROM dph_divisions
       WHERE discord_role_id IS NOT NULL AND discord_role_id != ''`
    );
    const membershipRoleByDiv = new Map<number, string>();
    for (const d of membershipDivs.rows) membershipRoleByDiv.set(d.id, d.discord_role_id);
    const membershipDivIds = new Set(membershipRoleByDiv.keys());

    const rankLinks = await pool.query<{
      division_id: number; name: string; sort_order: number; discord_role_id: string;
    }>(
      `SELECT division_id, name, sort_order, discord_role_id
       FROM dph_division_ranks
       WHERE discord_role_id IS NOT NULL AND discord_role_id != '' AND division_id IS NOT NULL`
    );

    const defaultRankByDiv = new Map<number, { name: string; sort_order: number }>();
    const allDivRanks = await pool.query<{ division_id: number; name: string; sort_order: number }>(
      `SELECT division_id, name, sort_order FROM dph_division_ranks
       WHERE division_id IS NOT NULL ORDER BY sort_order DESC, id DESC`
    );
    for (const r of allDivRanks.rows) {
      if (!defaultRankByDiv.has(r.division_id)) {
        defaultRankByDiv.set(r.division_id, { name: r.name, sort_order: r.sort_order });
      }
    }

    if (rankLinks.rows.length === 0 && membershipDivIds.size === 0) {
      return { assigned: 0, skipped: 0, removed: 0, errors: [] };
    }

    const rankByRole = new Map<string, { division_id: number; division_rank: string; sort_order: number }>();
    for (const r of rankLinks.rows) {
      const existing = rankByRole.get(r.discord_role_id);
      if (!existing || r.sort_order < existing.sort_order) {
        rankByRole.set(r.discord_role_id, {
          division_id: r.division_id,
          division_rank: r.name,
          sort_order: r.sort_order,
        });
      }
    }

    const linkedRankNames = new Set(rankLinks.rows.map(r => r.name.toLowerCase()));
    const linkedDivisionIds = new Set<number>([
      ...rankLinks.rows.map(r => r.division_id),
      ...membershipDivIds,
    ]);

    type Desired = { division_id: number; division_rank: string; sort_order: number };
    const desiredFromRoles = (roles: string[]) => {
      const roleSet = new Set(roles);
      const desiredByDiv = new Map<number, Desired>();

      for (const roleId of roles) {
        const rankHit = rankByRole.get(roleId);
        if (!rankHit) continue;
        const membershipRole = membershipRoleByDiv.get(rankHit.division_id);
        if (membershipRole && !roleSet.has(membershipRole)) continue;
        const cur = desiredByDiv.get(rankHit.division_id);
        if (!cur || rankHit.sort_order < cur.sort_order) desiredByDiv.set(rankHit.division_id, rankHit);
      }

      for (const [divId, roleId] of membershipRoleByDiv) {
        if (!roleSet.has(roleId) || desiredByDiv.has(divId)) continue;
        const fallback = defaultRankByDiv.get(divId);
        if (!fallback) continue;
        desiredByDiv.set(divId, {
          division_id: divId,
          division_rank: fallback.name,
          sort_order: fallback.sort_order,
        });
      }

      return desiredByDiv;
    };

    const desiredByDiscordId = new Map<string, Map<number, Desired>>();
    const desiredByUsername = new Map<string, Map<number, Desired>>();
    for (const m of allMembers) {
      const desired = desiredFromRoles(m.roles);
      desiredByDiscordId.set(m.user.id, desired);
      desiredByUsername.set(m.user.username.toLowerCase(), desired);
    }

    const isManagedAssignment = (a: { division_id: number; division_rank: string; is_manual?: boolean }) => {
      if (a.is_manual) return false; // manually added — never auto-remove
      return linkedDivisionIds.has(a.division_id) || linkedRankNames.has(a.division_rank.toLowerCase());
    };

    let assigned = 0; let skipped = 0; let removed = 0; const errors: string[] = [];
    const processedProfiles = new Set<number>();

    const applyForProfile = async (
      profileId: number,
      displayName: string | null,
      desiredByDiv: Map<number, Desired>,
    ) => {
      if (processedProfiles.has(profileId)) return;
      processedProfiles.add(profileId);

      if (displayName) {
        await pool.query(
          `INSERT INTO dph_users (profile_id, username, status)
           VALUES ($1, $2, 'Active')
           ON CONFLICT (profile_id) DO UPDATE SET
             username = COALESCE(EXCLUDED.username, dph_users.username),
             status = COALESCE(dph_users.status, 'Active'),
             updated_at = NOW()`,
          [profileId, displayName]
        );
      }

      const existingMap = await loadDphDivisionAssignments([profileId]);
      const existing = existingMap.get(profileId) ?? [];
      const mergedMap = new Map<number, { division_id: number; division_rank: string; is_manual: boolean }>();

      for (const a of existing) {
        if (!a.is_manual) continue;
        mergedMap.set(a.division_id, {
          division_id: a.division_id,
          division_rank: a.division_rank,
          is_manual: true,
        });
      }
      const fromDiscord = [...desiredByDiv.values()];
      for (const a of fromDiscord) {
        const prev = mergedMap.get(a.division_id);
        mergedMap.set(a.division_id, {
          division_id: a.division_id,
          division_rank: a.division_rank,
          is_manual: prev?.is_manual ?? false,
        });
      }
      // Keep unmanaged (no Discord links) non-manual assignments as-is
      for (const a of existing) {
        if (mergedMap.has(a.division_id)) continue;
        if (!isManagedAssignment(a)) {
          mergedMap.set(a.division_id, {
            division_id: a.division_id,
            division_rank: a.division_rank,
            is_manual: Boolean(a.is_manual),
          });
        }
      }
      const merged = [...mergedMap.values()];

      const key = (list: Array<{ division_id: number; division_rank: string; is_manual?: boolean }>) =>
        list.map(a => `${a.division_id}:${a.division_rank}:${a.is_manual ? 1 : 0}`).sort().join("|");
      if (key(existing) === key(merged)) { skipped++; return; }

      const removedHere = existing.filter(a => isManagedAssignment(a) && !desiredByDiv.has(a.division_id)).length;
      removed += removedHere;
      await setDphMemberDivisionAssignments(profileId, merged);
      if (fromDiscord.length > 0 || removedHere > 0) assigned++;
    };

    for (const m of allMembers) {
      const desired = desiredByDiscordId.get(m.user.id) ?? new Map<number, Desired>();
      try {
        let profileId: number | null = null;
        if (desired.size > 0) {
          profileId = await ensureCadProfileForDphDiscordMember(m);
        } else {
          const found = await pool.query<{ id: number }>(
            `SELECT id FROM cad_user_profiles WHERE discord_id = $1 LIMIT 1`,
            [m.user.id]
          );
          profileId = found.rows[0]?.id ?? null;
          if (profileId == null) continue;
          const existingMap = await loadDphDivisionAssignments([profileId]);
          const existing = existingMap.get(profileId) ?? [];
          if (!existing.some(isManagedAssignment)) continue;
        }
        await applyForProfile(profileId, m.nick ?? m.user.username, desired);
      } catch (e) {
        errors.push(`discord_id ${m.user.id}: ${String(e)}`);
      }
    }

    const linkedAssignments = await pool.query<{
      profile_id: number; discord_id: string | null; discord_username: string | null;
    }>(
      `SELECT DISTINCT ud.profile_id, p.discord_id, p.discord_username
       FROM dph_user_divisions ud
       JOIN cad_user_profiles p ON p.id = ud.profile_id
       WHERE ud.division_id = ANY($1)
          OR lower(ud.division_rank) = ANY($2)`,
      [[...linkedDivisionIds], [...linkedRankNames]]
    );

    for (const row of linkedAssignments.rows) {
      if (processedProfiles.has(row.profile_id)) continue;
      try {
        let desired = new Map<number, Desired>();
        if (row.discord_id && desiredByDiscordId.has(row.discord_id)) {
          desired = desiredByDiscordId.get(row.discord_id)!;
        } else if (row.discord_username && desiredByUsername.has(row.discord_username.toLowerCase())) {
          desired = desiredByUsername.get(row.discord_username.toLowerCase())!;
        }
        await applyForProfile(row.profile_id, null, desired);
      } catch (e) {
        errors.push(`remove profile_id ${row.profile_id}: ${String(e)}`);
      }
    }

    await writeLog("dph_personnel", "System", "Division Discord role sync completed",
      `assigned=${assigned} skipped=${skipped} removed=${removed} errors=${errors.length}`);
    console.info(`[dph-division-sync] assigned=${assigned} skipped=${skipped} removed=${removed} errors=${errors.length}`);
    return { assigned, skipped, removed, errors };
  } catch (e) {
    console.error("[dph-division-sync] Error:", e);
    return { assigned: 0, skipped: 0, removed: 0, errors: [String(e)] };
  }
}

// ── GET /dph/division-discord-roles — Division guild role list ────────────────
router.get("/dph/division-discord-roles", async (req, res) => {
  try {
    res.json(await getDphDivisionGuildRoles());
  } catch (err) {
    req.log?.error?.({ err }, "dph/division-discord-roles GET error");
    // Soft-fail so the Division Panel still loads when the bot isn't in the guild yet
    res.json([]);
  }
});

// ── POST /dph/sync-division-discord-roles — manual trigger ───────────────────
router.post("/dph/sync-division-discord-roles", async (req, res) => {
  try {
    res.json(await syncDphDivisionDiscordRoles());
  } catch (err) {
    req.log?.error?.({ err }, "dph/sync-division-discord-roles error");
    res.status(500).json({ error: "Division sync failed." });
  }
});

// ── GET /dph/member-search — typeahead limited to DPH guild members ───────────
router.get("/dph/member-search", async (req, res) => {
  const q = String(req.query.q ?? "").trim().toLowerCase();
  if (q.length < 1) { res.json([]); return; }

  type SearchHit = {
    id: number | null; username: string; discord_username: string | null;
    discord_id: string | null; rank: string | null;
  };

  try {
    const cached = await ensureDphMembersCache();
    const guildDiscordIds = cached.map(m => m.id);
    const hits: SearchHit[] = [];
    const seenDiscordIds = new Set<string>();

    if (guildDiscordIds.length > 0) {
      const cadRes = await pool.query<{
        id: number; username: string; discord_username: string | null;
        discord_id: string | null; rank: string | null;
      }>(
        `SELECT id, username, discord_username, discord_id, rank
         FROM cad_user_profiles
         WHERE discord_id = ANY($1::text[])
           AND (username ILIKE $2 OR discord_username ILIKE $2 OR discord_id ILIKE $2)
         ORDER BY username LIMIT 20`,
        [guildDiscordIds, `%${q}%`]
      );
      for (const row of cadRes.rows) {
        hits.push({
          id: row.id, username: row.username, discord_username: row.discord_username,
          discord_id: row.discord_id, rank: row.rank,
        });
        if (row.discord_id) seenDiscordIds.add(row.discord_id);
      }
    }

    const remaining = 20 - hits.length;
    if (remaining > 0) {
      const discordHits = cached.filter(m => {
        if (seenDiscordIds.has(m.id)) return false;
        const display = (m.nick ?? m.username).toLowerCase();
        return m.username.toLowerCase().includes(q) || display.includes(q) || m.id.includes(q);
      });
      for (const m of discordHits.slice(0, remaining)) {
        hits.push({
          id: null, username: m.nick ?? m.username, discord_username: m.username,
          discord_id: m.id, rank: null,
        });
      }
    }

    res.json(hits.slice(0, 20));
  } catch (err) {
    req.log.error({ err }, "dph/member-search error");
    res.status(500).json({ error: "Search failed." });
  }
});

export default router;
