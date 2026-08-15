import { Router, type Request, type Response } from "express";
import { isUniqueViolation, pool } from "@workspace/db";
import { writeLog } from "../lib/audit-log";
import { isSuperAdminDiscordId } from "../lib/superadmin";
import { getDiscordGuildRoles, wantsDiscordRolesRefresh } from "../lib/discord-guild-roles-cache.js";
import { registerDiscordGuildSync } from "../lib/discord-realtime-sync.js";
import { sortStaffByRank } from "../lib/roster-sort.js";
import { buildLinkedRankByRoleId, pickHighestLinkedDiscordRole } from "../lib/discord-rank-pick.js";
import {
  clearAllStaffAccessPermissions,
  resetStaffMemberAccessPermissions,
} from "../lib/department-permissions.js";

const router = Router();

function asBool(v: unknown): boolean {
  return v === true || v === 1 || v === "1" || v === "t" || v === "true";
}

function normalizeStaffMemberRow<T extends Record<string, unknown>>(row: T): T {
  return {
    ...row,
    can_access_iab: asBool(row.can_access_iab),
    can_access_system_logs: asBool(row.can_access_system_logs),
    can_access_terms_privacy: asBool(row.can_access_terms_privacy),
    can_access_terminal_offline: asBool(row.can_access_terminal_offline),
    can_access_doc_dps_cad: asBool(row.can_access_doc_dps_cad),
  };
}

function normalizeStaffGroupRow<T extends Record<string, unknown>>(row: T): T {
  return {
    ...row,
    staff_access: row.staff_access === undefined ? true : asBool(row.staff_access),
    admin_access: asBool(row.admin_access),
    doc_access: asBool(row.doc_access),
  };
}

function requestDiscordId(req: Request): string | null {
  const raw = req.headers["x-discord-id"];
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  return null;
}

function requestIsSuperAdmin(req: Request): boolean {
  return isSuperAdminDiscordId(requestDiscordId(req));
}

async function groupIsLocked(groupId: number | null | undefined): Promise<boolean> {
  if (groupId == null || !Number.isInteger(groupId) || groupId <= 0) return false;
  const r = await pool.query<{ locked: boolean }>(
    `SELECT locked FROM staff_rank_groups WHERE id = $1 LIMIT 1`,
    [groupId],
  );
  return (r.rowCount ?? 0) > 0 && !!r.rows[0].locked;
}

/** Reject non-superadmin mutations that touch a locked (Executive Team) group. */
async function denyUnlessSuperAdminForLocked(
  req: Request,
  res: Response,
  groupId: number | null | undefined,
): Promise<boolean> {
  if (!(await groupIsLocked(groupId))) return false;
  if (requestIsSuperAdmin(req)) return false;
  res.status(403).json({ error: "Only superadmins can manage the Executive Team." });
  return true;
}

// ─── Staff Discord Guild ───────────────────────────────────────────────────────
// Guild whose roles drive automatic rank assignment.
const STAFF_GUILD_ID = process.env.STAFF_DISCORD_GUILD_ID ?? "1411760639428399194";

// Cache of all guild members — populated by the background sync so the
// member-search endpoint never needs to re-paginate for a search query.
type StaffMemberCacheEntry = { id: string; username: string; nick: string | null };
const staffMembersCache: { members: StaffMemberCacheEntry[]; fetchedAt: number } =
  { members: [], fetchedAt: 0 };

async function staffDiscordFetch(url: string, init: RequestInit = {}): Promise<globalThis.Response> {
  const tok = process.env.DISCORD_BOT_TOKEN ?? "";
  const headers = { Authorization: `Bot ${tok}`, ...(init.headers as Record<string, string> | undefined) };
  let r = await fetch(url, { ...init, headers });
  if (r.status === 429) {
    const body = await r.json().catch(() => ({})) as { retry_after?: number };
    await new Promise(res => setTimeout(res, Math.min((body.retry_after ?? 1) * 1000 + 200, 10_000)));
    r = await fetch(url, { ...init, headers });
  }
  return r;
}

async function getStaffGuildRoles(refresh = false): Promise<Array<{ id: string; name: string; position: number }>> {
  return getDiscordGuildRoles(STAFF_GUILD_ID, { refresh });
}

const STAFF_MEMBERS_TTL_MS = 5 * 60 * 1000; // 5 min — used by Add Staff Member typeahead
let _staffMembersFetchRunning: Promise<StaffMemberCacheEntry[]> | null = null;

type StaffGuildMember = { user: { id: string; username: string; avatar?: string | null }; nick?: string | null; roles: string[] };

/** Paginate staff guild (1411760639428399194) and refresh the in-memory member cache. */
async function fetchStaffGuildMembers(): Promise<StaffGuildMember[]> {
  const tok = process.env.DISCORD_BOT_TOKEN;
  if (!tok) throw new Error("No DISCORD_BOT_TOKEN configured");

  let allMembers: StaffGuildMember[] = [];
  let after = "0";
  for (;;) {
    const url = `https://discord.com/api/v10/guilds/${STAFF_GUILD_ID}/members?limit=1000${after !== "0" ? `&after=${after}` : ""}`;
    const r = await staffDiscordFetch(url);
    if (!r.ok) throw new Error(`Staff members fetch failed: ${r.status}`);
    const batch = (await r.json()) as StaffGuildMember[];
    if (batch.length === 0) break;
    allMembers = allMembers.concat(batch);
    if (batch.length < 1000) break;
    after = batch[batch.length - 1].user.id;
  }

  staffMembersCache.members = allMembers.map(m => ({
    id: m.user.id,
    username: m.user.username,
    nick: m.nick ?? null,
  }));
  staffMembersCache.fetchedAt = Date.now();
  return allMembers;
}

/** Persist Discord avatars onto matching CAD profiles (by discord_id). Only writes when changed. */
async function refreshCadAvatarsFromGuildMembers(
  members: Array<{ user: { id: string; username: string; avatar?: string | null } }>,
): Promise<void> {
  const withAvatar = members.filter(m => (m.user.avatar?.trim() ?? "") !== "");
  if (withAvatar.length === 0) return;

  const ids = withAvatar.map(m => m.user.id);
  let existing = new Map<string, { avatar_hash: string | null; discord_username: string | null }>();
  try {
    const { rows } = await pool.query<{
      discord_id: string; avatar_hash: string | null; discord_username: string | null;
    }>(
      `SELECT discord_id, avatar_hash, discord_username
         FROM cad_user_profiles
        WHERE discord_id = ANY($1::text[])`,
      [ids],
    );
    existing = new Map(rows.map(r => [r.discord_id, r]));
  } catch { /* fall through — skip bulk refresh if lookup fails */ return; }

  for (const m of withAvatar) {
    const avatar = m.user.avatar!.trim();
    const row = existing.get(m.user.id);
    if (!row) continue;
    const usernameMissing = !row.discord_username?.trim();
    if (row.avatar_hash === avatar && !usernameMissing) continue;
    try {
      await pool.query(
        `UPDATE cad_user_profiles
         SET avatar_hash = $1,
             discord_username = CASE
               WHEN discord_username IS NULL OR discord_username = '' THEN $2
               ELSE discord_username
             END
         WHERE discord_id = $3`,
        [avatar, m.user.username, m.user.id],
      );
    } catch { /* non-fatal */ }
  }
}

/** Ensure the staff guild member cache is warm (for Add Staff Member search). */
async function ensureStaffMembersCache(force = false): Promise<StaffMemberCacheEntry[]> {
  const fresh =
    !force &&
    staffMembersCache.members.length > 0 &&
    Date.now() - staffMembersCache.fetchedAt < STAFF_MEMBERS_TTL_MS;
  if (fresh) return staffMembersCache.members;

  if (!_staffMembersFetchRunning) {
    _staffMembersFetchRunning = fetchStaffGuildMembers()
      .then(() => staffMembersCache.members)
      .finally(() => { _staffMembersFetchRunning = null; });
  }
  return _staffMembersFetchRunning;
}

async function ensureCadProfileForStaffDiscordMember(
  m: { user: { id: string; username: string; avatar?: string | null }; nick?: string | null },
): Promise<{ profileId: number; staffRank: string | null; staffRole: string | null; username: string | null }> {
  const avatar = m.user.avatar?.trim() ?? "";
  let p = await pool.query<{ id: number; staff_rank: string | null; staff_role: string | null; username: string | null; discord_id: string | null }>(
    `SELECT id, staff_rank, staff_role, username, discord_id FROM cad_user_profiles WHERE discord_id = $1 LIMIT 1`,
    [m.user.id],
  );
  if (p.rows.length === 0 && m.user.username) {
    p = await pool.query<{ id: number; staff_rank: string | null; staff_role: string | null; username: string | null; discord_id: string | null }>(
      `SELECT id, staff_rank, staff_role, username, discord_id FROM cad_user_profiles
       WHERE lower(discord_username) = lower($1) LIMIT 1`,
      [m.user.username],
    );
  }
  if (p.rows.length > 0) {
    const profileId = p.rows[0].id;
    await pool.query(
      `UPDATE cad_user_profiles SET
         discord_id = CASE WHEN discord_id IS NULL OR discord_id = '' THEN $1 ELSE discord_id END,
         discord_username = CASE WHEN discord_username IS NULL OR discord_username = '' THEN $2 ELSE discord_username END,
         avatar_hash = CASE WHEN $3 != '' THEN $3 ELSE avatar_hash END
       WHERE id = $4`,
      [m.user.id, m.user.username, avatar, profileId],
    );
    return {
      profileId,
      staffRank: p.rows[0].staff_rank,
      staffRole: p.rows[0].staff_role,
      username: p.rows[0].username,
    };
  }

  const displayName = m.nick ?? m.user.username;
  const placeholderEmail = `discord_${m.user.id}@placeholder.dojcad`;
  try {
    // Plain INSERT — SQLite's partial unique index on discord_id does not support
    // Postgres-style ON CONFLICT (discord_id) from this path.
    const created = await pool.query<{ id: number }>(
      `INSERT INTO cad_user_profiles
         (auth_user_id, username, email, discord_username, discord_id, avatar_hash,
          community_code, rank, role, password_salt, password_hash, whitelisted, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'DISCORD', 'Member', 'Community Members', '', '', false, NOW(), NOW())
       RETURNING id`,
      [`discord-${m.user.id}`, displayName, placeholderEmail, m.user.username, m.user.id, avatar],
    );
    return { profileId: created.rows[0].id, staffRank: null, staffRole: null, username: displayName };
  } catch {
    const again = await pool.query<{ id: number; staff_rank: string | null; staff_role: string | null; username: string | null }>(
      `SELECT id, staff_rank, staff_role, username FROM cad_user_profiles WHERE discord_id = $1 OR email = $2 LIMIT 1`,
      [m.user.id, placeholderEmail],
    );
    if (again.rows.length > 0) {
      return {
        profileId: again.rows[0].id,
        staffRank: again.rows[0].staff_rank,
        staffRole: again.rows[0].staff_role,
        username: again.rows[0].username,
      };
    }
    throw new Error(`Unable to create CAD profile for Discord user ${m.user.id}`);
  }
}

async function syncStaffDiscordRoles(): Promise<{ assigned: number; skipped: number; removed: number; errors: string[] }> {
  const tok = process.env.DISCORD_BOT_TOKEN;
  if (!tok) return { assigned: 0, skipped: 0, removed: 0, errors: ["No DISCORD_BOT_TOKEN configured"] };
  try {
    // 1. Get all ranks linked to a Discord role (include sort_order so we can
    //    pick the highest-ranked role when a member holds more than one)
    const ranksRes = await pool.query<{ name: string; discord_role_id: string; group_id: number | null; sort_order: number }>(
      `SELECT name, discord_role_id, group_id, sort_order FROM staff_ranks WHERE discord_role_id IS NOT NULL AND discord_role_id != ''`
    );

    const groupsRes = await pool.query<{ id: number; name: string; sort_order: number }>(
      `SELECT id, name, sort_order FROM staff_rank_groups`,
    );
    const groupNameById = new Map(groupsRes.rows.map(g => [g.id, g.name]));
    const groupSortById = new Map(groupsRes.rows.map(g => [g.id, Number(g.sort_order ?? 999_999)]));
    const rankMap = buildLinkedRankByRoleId(ranksRes.rows, groupSortById, groupNameById);
    const linkedRoleIds = [...rankMap.keys()];

    // 2. Always refresh staff guild members first (needed for Add Staff search
    //    even when no ranks are Discord-linked yet).
    const allMembers = await fetchStaffGuildMembers();
    // Keep roster avatars in sync with Discord for every CAD profile we can match.
    await refreshCadAvatarsFromGuildMembers(allMembers);

    let assigned = 0; let skipped = 0; let removed = 0; const errors: string[] = [];

    // 3. Assign staff ranks to matching CAD profiles
    if (linkedRoleIds.length > 0) {
      for (const m of allMembers) {
        // Collect every linked role this member holds, then pick the one with
        // the lowest sort_order (= highest position in the rank hierarchy).
        const matchingRids = m.roles.filter(r => linkedRoleIds.includes(r));
        if (matchingRids.length === 0) continue;
        const rid = pickHighestLinkedDiscordRole(matchingRids, rankMap);
        if (!rid) continue;
        const { rankName, groupName } = rankMap.get(rid)!;
        try {
          const displayName = m.nick ?? m.user.username;
          const { profileId, staffRank, staffRole, username } = await ensureCadProfileForStaffDiscordMember(m);
          if (
            staffRank === rankName
            && (staffRole ?? null) === (groupName ?? null)
            && username === displayName
          ) {
            skipped++;
            continue;
          }

          await pool.query(
            `UPDATE cad_user_profiles
             SET username = $2, staff_rank = $3, staff_role = $4
             WHERE id = $1`,
            [profileId, displayName, rankName, groupName]
          );
          assigned++;
        } catch (e) { errors.push(`discord_id ${m.user.id}: ${String(e)}`); }
      }
    }

    // 4. Remove staff ranks from members whose linked Discord role was taken away
    const linkedRankNames = ranksRes.rows.map(r => r.name);
    if (linkedRankNames.length > 0) {
      const staffWithLinkedRank = await pool.query<{
        id: number; discord_id: string | null; discord_username: string | null; staff_rank: string;
      }>(
        `SELECT id, discord_id, discord_username, staff_rank
         FROM cad_user_profiles
         WHERE staff_rank = ANY($1::text[])`,
        [linkedRankNames],
      );

      // Build sets of members who still hold a linked role
      const activeByDiscordId = new Set<string>(
        allMembers
          .filter(m => m.roles.some(r => linkedRoleIds.includes(r)))
          .map(m => m.user.id)
      );
      const activeByUsername = new Set<string>(
        allMembers
          .filter(m => m.roles.some(r => linkedRoleIds.includes(r)))
          .map(m => m.user.username.toLowerCase())
      );

      for (const row of staffWithLinkedRank.rows) {
        const stillHasRole =
          (row.discord_id != null && activeByDiscordId.has(row.discord_id)) ||
          (row.discord_id == null && row.discord_username != null &&
            activeByUsername.has(row.discord_username.toLowerCase()));

        if (!stillHasRole) {
          try {
            await pool.query(
              `UPDATE cad_user_profiles SET staff_rank = NULL, staff_role = NULL WHERE id = $1`,
              [row.id]
            );
            removed++;
          } catch (e) { errors.push(`remove profile_id ${row.id}: ${String(e)}`); }
        }
      }
    }

    await writeLog("staff", "System", "Discord role sync completed",
      `assigned=${assigned} skipped=${skipped} removed=${removed} errors=${errors.length}`);
    console.info(`[staff-sync] assigned=${assigned} skipped=${skipped} removed=${removed} errors=${errors.length}`);
    return { assigned, skipped, removed, errors };
  } catch (e) {
    console.error("[staff-sync] Error:", e);
    return { assigned: 0, skipped: 0, removed: 0, errors: [String(e)] };
  }
}

// ── One-time migrations ───────────────────────────────────────────────────────
(async () => {
  try {
    await pool.query(
      `ALTER TABLE staff_rank_groups ADD COLUMN IF NOT EXISTS staff_access boolean NOT NULL DEFAULT true`
    );
    await pool.query(
      `ALTER TABLE staff_rank_groups ADD COLUMN IF NOT EXISTS admin_access boolean NOT NULL DEFAULT false`
    );
    await pool.query(
      `ALTER TABLE staff_rank_groups ADD COLUMN IF NOT EXISTS doc_access boolean NOT NULL DEFAULT false`
    );
    // Ensure the locked Executive Team group always has both access flags
    await pool.query(
      `UPDATE staff_rank_groups SET admin_access = true WHERE locked = true`
    );
    // Separate DPS and Staff rank/role fields on user profiles
    await pool.query(`ALTER TABLE cad_user_profiles ADD COLUMN IF NOT EXISTS dps_rank   text`);
    await pool.query(`ALTER TABLE cad_user_profiles ADD COLUMN IF NOT EXISTS dps_role   text`);
    await pool.query(`ALTER TABLE cad_user_profiles ADD COLUMN IF NOT EXISTS staff_rank text`);
    await pool.query(`ALTER TABLE cad_user_profiles ADD COLUMN IF NOT EXISTS staff_role text`);
    // Back-fill dps_rank from legacy rank for existing DPS personnel (non-Member)
    await pool.query(
      `UPDATE cad_user_profiles SET dps_rank = rank
       WHERE dps_rank IS NULL AND lower(rank) != 'member'`
    );
    // Back-fill staff fields for members already assigned to a staff group
    await pool.query(
      `UPDATE cad_user_profiles
       SET staff_rank = rank, staff_role = role
       WHERE staff_role IS NULL
         AND role IN (SELECT name FROM staff_rank_groups)`
    );
  } catch (e) {
    console.error("Staff groups migration failed:", e);
  }
  // Independent — runs even if the block above errored
  try {
    await pool.query(
      `ALTER TABLE cad_user_profiles ADD COLUMN IF NOT EXISTS staff_appointed_date date`
    );
  } catch (e) {
    console.error("staff_appointed_date migration failed:", e);
  }
  try {
    await pool.query(
      `ALTER TABLE cad_user_profiles ADD COLUMN IF NOT EXISTS can_access_iab boolean NOT NULL DEFAULT false`
    );
  } catch (e) {
    console.error("can_access_iab migration failed:", e);
  }
  try {
    await pool.query(
      `ALTER TABLE cad_user_profiles ADD COLUMN IF NOT EXISTS can_access_system_logs boolean NOT NULL DEFAULT false`
    );
    await pool.query(
      `ALTER TABLE cad_user_profiles ADD COLUMN IF NOT EXISTS can_access_terms_privacy boolean NOT NULL DEFAULT false`
    );
  } catch (e) {
    console.error("admin tab access migration failed:", e);
  }
  try {
    await pool.query(
      `ALTER TABLE cad_user_profiles ADD COLUMN IF NOT EXISTS can_access_terminal_offline boolean NOT NULL DEFAULT false`
    );
  } catch (e) {
    console.error("can_access_terminal_offline migration failed:", e);
  }
  try {
    await pool.query(
      `ALTER TABLE cad_user_profiles ADD COLUMN IF NOT EXISTS can_access_doc_dps_cad boolean NOT NULL DEFAULT false`
    );
  } catch (e) {
    console.error("can_access_doc_dps_cad migration failed:", e);
  }
  // Discord role link column
  try {
    await pool.query(`ALTER TABLE staff_ranks ADD COLUMN IF NOT EXISTS discord_role_id text`);
    await pool.query(`ALTER TABLE staff_ranks ADD COLUMN IF NOT EXISTS color_hex text`);
  } catch (e) {
    console.error("discord_role_id/color_hex migration failed:", e);
  }
  // Unique index on discord_id (partial — allows multiple NULLs) so ON CONFLICT works
  try {
    await pool.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS cad_user_profiles_discord_id_unique
       ON cad_user_profiles (discord_id)
       WHERE discord_id IS NOT NULL`
    );
  } catch (e) {
    console.error("discord_id unique index migration failed:", e);
  }
})();

// ── Background sync: assign/remove ranks based on linked Discord roles ─────────
// Guard prevents overlapping runs. Gateway handles realtime updates; this interval
// is a fallback when the Gateway is disconnected (default 60s, min 10s).
const STAFF_SYNC_INTERVAL_MS = Math.max(
  10_000,
  Number(process.env.STAFF_SYNC_INTERVAL_MS) || 60_000,
);
let _staffSyncRunning = false;
async function guardedStaffSync() {
  if (_staffSyncRunning) return;
  _staffSyncRunning = true;
  try { await syncStaffDiscordRoles(); } catch (e) { console.error("[staff-sync]", e); }
  finally { _staffSyncRunning = false; }
}
setTimeout(() => {
  void guardedStaffSync();
  setInterval(() => void guardedStaffSync(), STAFF_SYNC_INTERVAL_MS);
}, 30_000);

registerDiscordGuildSync(STAFF_GUILD_ID, "staff", () => syncStaffDiscordRoles());

// ── Search users (typeahead) — staff guild only (legacy alias of member-search)
router.get("/staff/users/search", async (req, res) => {
  const q = String(req.query.q ?? "").trim().toLowerCase();
  if (!q) { res.json([]); return; }
  try {
    const cached = await ensureStaffMembersCache();
    const staffDiscordIds = cached.map(m => m.id);
    if (staffDiscordIds.length === 0) { res.json([]); return; }

    const r = await pool.query(
      `SELECT id, username, discord_username, discord_id, rank, role
       FROM cad_user_profiles
       WHERE discord_id = ANY($1::text[])
         AND (username ILIKE $2 OR discord_username ILIKE $2 OR discord_id ILIKE $2)
       ORDER BY username LIMIT 8`,
      [staffDiscordIds, `%${q}%`]
    );
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: "Search failed." });
  }
});

// ── GET /staff/roster — list staff members ────────────────────────────────────
router.get("/staff/roster", async (req, res) => {
  const all = req.query.all === "1";
  try {
    const groupsRes = await pool.query<{ name: string }>(`SELECT name FROM staff_rank_groups`);
    const ranksRes = await pool.query<{ name: string; sort_order: number }>(
      `SELECT name, sort_order FROM staff_ranks`,
    );
    const groupNames = groupsRes.rows.map(r => String(r.name).trim().toLowerCase()).filter(Boolean);
    const rankNames = ranksRes.rows.map(r => String(r.name).trim().toLowerCase()).filter(Boolean);
    const rankOrderByName = new Map(
      ranksRes.rows.map(r => [String(r.name).trim().toLowerCase(), Number(r.sort_order ?? 999_999)]),
    );

    const r = await pool.query(
      `SELECT p.id, p.username, p.discord_username, p.discord_id, p.avatar_hash,
              p.staff_rank, p.staff_role, p.status, p.staff_appointed_date,
              COALESCE(p.can_access_iab, false) AS can_access_iab,
              COALESCE(p.can_access_system_logs, false) AS can_access_system_logs,
              COALESCE(p.can_access_terms_privacy, false) AS can_access_terms_privacy,
              COALESCE(p.can_access_terminal_offline, false) AS can_access_terminal_offline,
              COALESCE(p.can_access_doc_dps_cad, false) AS can_access_doc_dps_cad
       FROM cad_user_profiles p
       LEFT JOIN staff_ranks sr ON lower(sr.name) = lower(COALESCE(p.staff_rank, ''))
       WHERE (
         lower(COALESCE(p.staff_role, '')) = ANY($1::text[])
         OR (
           p.staff_rank IS NOT NULL AND p.staff_rank != ''
           AND lower(p.staff_rank) = ANY($2::text[])
         )
       )
         ${all ? "" : "AND lower(COALESCE(p.status, 'active')) != 'inactive'"}
       ORDER BY COALESCE(sr.sort_order, 999999), p.username`,
      [groupNames, rankNames],
    );
    res.json(sortStaffByRank(r.rows.map(normalizeStaffMemberRow), rankOrderByName));
  } catch (err) {
    req.log?.error?.({ err }, "staff/roster GET error");
    res.status(500).json({ error: "Unable to load staff roster." });
  }
});

// ── POST /staff/roster/:id/permissions/clear — revoke Access Permissions for one member
router.post("/staff/roster/:id/permissions/clear", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id." }); return;
  }
  try {
    const check = await pool.query(
      `SELECT id FROM cad_user_profiles WHERE id = $1 LIMIT 1`,
      [id],
    );
    if (!check.rows.length) {
      res.status(404).json({ error: "Member not found." }); return;
    }
    await resetStaffMemberAccessPermissions(pool, id);
    const actor = (req.body as Record<string, unknown>).actor as string
      || (req.headers["x-actor"] as string)
      || "Admin";
    void writeLog(
      "staff",
      actor,
      "Cleared access permissions",
      String(id),
    );
    res.json({
      ok: true,
      id,
      can_access_iab: false,
      can_access_system_logs: false,
      can_access_terms_privacy: false,
      can_access_terminal_offline: false,
      can_access_doc_dps_cad: false,
    });
  } catch (err) {
    req.log.error({ err }, "staff permissions clear error");
    res.status(500).json({ error: "Unable to clear access permissions." });
  }
});

// ── POST /staff/permissions/clear-all — revoke all individual Access Permissions grants
router.post("/staff/permissions/clear-all", async (req, res) => {
  try {
    const cleared = await clearAllStaffAccessPermissions(pool);
    const actor = (req.body as Record<string, unknown>).actor as string
      || (req.headers["x-actor"] as string)
      || "Admin";
    void writeLog(
      "staff",
      actor,
      "Cleared all individual access permissions",
      `members=${cleared}`,
    );
    res.json({ ok: true, members: cleared });
  } catch (err) {
    req.log.error({ err }, "staff permissions clear-all error");
    res.status(500).json({ error: "Unable to clear permission grants." });
  }
});

// ── PATCH /staff/roster/:id/iab-access — toggle DPS Internal Affairs access ───
router.patch("/staff/roster/:id/iab-access", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id." }); return;
  }
  const { can_access_iab } = req.body as { can_access_iab?: boolean };
  if (typeof can_access_iab !== "boolean") {
    res.status(400).json({ error: "can_access_iab (boolean) is required." }); return;
  }
  try {
    const result = await pool.query(
      `UPDATE cad_user_profiles
          SET can_access_iab = $2, updated_at = NOW()
        WHERE id = $1
        RETURNING id, username, can_access_iab`,
      [id, can_access_iab],
    );
    if (!result.rows.length) {
      res.status(404).json({ error: "Member not found." }); return;
    }
    const actor = (req.body as Record<string, unknown>).actor as string
      || (req.headers["x-actor"] as string)
      || "Admin";
    void writeLog(
      "staff",
      actor,
      can_access_iab ? "Granted DPS Internal Affairs access" : "Revoked DPS Internal Affairs access",
      String(result.rows[0].username ?? id),
    );
    res.json(normalizeStaffMemberRow({
      id: result.rows[0].id,
      can_access_iab: Boolean(result.rows[0].can_access_iab),
    }));
  } catch (err) {
    req.log.error({ err }, "staff iab-access PATCH error");
    res.status(500).json({ error: "Unable to update Internal Affairs access." });
  }
});

// ── PATCH /staff/roster/:id/terminal-offline-access — sign-in during lockdown ──
router.patch("/staff/roster/:id/terminal-offline-access", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id." }); return;
  }
  const body = req.body as { can_access_terminal_offline?: boolean; actor?: string };
  if (typeof body.can_access_terminal_offline !== "boolean") {
    res.status(400).json({ error: "can_access_terminal_offline (boolean) is required." });
    return;
  }
  try {
    const result = await pool.query(
      `UPDATE cad_user_profiles SET
          can_access_terminal_offline = $2,
          updated_at = NOW()
        WHERE id = $1
        RETURNING id, username, can_access_terminal_offline`,
      [id, body.can_access_terminal_offline],
    );
    if (!result.rows.length) {
      res.status(404).json({ error: "Member not found." }); return;
    }
    const actor = body.actor
      || (req.headers["x-actor"] as string)
      || "Admin";
    void writeLog(
      "staff",
      actor,
      body.can_access_terminal_offline
        ? "Granted terminal lockdown access"
        : "Revoked terminal lockdown access",
      String(result.rows[0].username ?? id),
    );
    res.json(normalizeStaffMemberRow({
      id: result.rows[0].id,
      can_access_terminal_offline: Boolean(result.rows[0].can_access_terminal_offline),
    }));
  } catch (err) {
    req.log.error({ err }, "staff terminal-offline-access PATCH error");
    res.status(500).json({ error: "Unable to update terminal lockdown access." });
  }
});

// ── PATCH /staff/roster/:id/admin-tab-access — System Logs / Terms & Privacy ──
router.patch("/staff/roster/:id/admin-tab-access", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id." }); return;
  }
  const body = req.body as {
    can_access_system_logs?: boolean;
    can_access_terms_privacy?: boolean;
    actor?: string;
  };
  const hasLogs = typeof body.can_access_system_logs === "boolean";
  const hasTerms = typeof body.can_access_terms_privacy === "boolean";
  if (!hasLogs && !hasTerms) {
    res.status(400).json({
      error: "can_access_system_logs or can_access_terms_privacy (boolean) is required.",
    });
    return;
  }
  try {
    const result = await pool.query(
      `UPDATE cad_user_profiles SET
          can_access_system_logs = CASE WHEN $2::boolean IS NOT NULL THEN $2 ELSE can_access_system_logs END,
          can_access_terms_privacy = CASE WHEN $3::boolean IS NOT NULL THEN $3 ELSE can_access_terms_privacy END,
          updated_at = NOW()
        WHERE id = $1
        RETURNING id, username, can_access_system_logs, can_access_terms_privacy`,
      [
        id,
        hasLogs ? body.can_access_system_logs : null,
        hasTerms ? body.can_access_terms_privacy : null,
      ],
    );
    if (!result.rows.length) {
      res.status(404).json({ error: "Member not found." }); return;
    }
    const actor = body.actor
      || (req.headers["x-actor"] as string)
      || "Admin";
    if (hasLogs) {
      void writeLog(
        "staff",
        actor,
        body.can_access_system_logs
          ? "Granted System Logs access"
          : "Revoked System Logs access",
        String(result.rows[0].username ?? id),
      );
    }
    if (hasTerms) {
      void writeLog(
        "staff",
        actor,
        body.can_access_terms_privacy
          ? "Granted Terms of Service & Privacy Policy access"
          : "Revoked Terms of Service & Privacy Policy access",
        String(result.rows[0].username ?? id),
      );
    }
    res.json(normalizeStaffMemberRow({
      id: result.rows[0].id,
      can_access_system_logs: Boolean(result.rows[0].can_access_system_logs),
      can_access_terms_privacy: Boolean(result.rows[0].can_access_terms_privacy),
    }));
  } catch (err) {
    req.log.error({ err }, "staff admin-tab-access PATCH error");
    res.status(500).json({ error: "Unable to update admin tab access." });
  }
});

// ── PATCH /staff/roster/:id/doc-dps-cad-access — view DOC & DPS CAD terminals ─
router.patch("/staff/roster/:id/doc-dps-cad-access", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id." }); return;
  }
  const { can_access_doc_dps_cad } = req.body as { can_access_doc_dps_cad?: boolean };
  if (typeof can_access_doc_dps_cad !== "boolean") {
    res.status(400).json({ error: "can_access_doc_dps_cad (boolean) is required." }); return;
  }
  try {
    const result = await pool.query(
      `UPDATE cad_user_profiles
          SET can_access_doc_dps_cad = $2, updated_at = NOW()
        WHERE id = $1
        RETURNING id, username, can_access_doc_dps_cad`,
      [id, can_access_doc_dps_cad],
    );
    if (!result.rows.length) {
      res.status(404).json({ error: "Member not found." }); return;
    }
    const actor = (req.body as Record<string, unknown>).actor as string
      || (req.headers["x-actor"] as string)
      || "Admin";
    void writeLog(
      "staff",
      actor,
      can_access_doc_dps_cad ? "Granted DOC & DPS CAD view access" : "Revoked DOC & DPS CAD view access",
      String(result.rows[0].username ?? id),
    );
    res.json(normalizeStaffMemberRow({
      id: result.rows[0].id,
      can_access_doc_dps_cad: Boolean(result.rows[0].can_access_doc_dps_cad),
    }));
  } catch (err) {
    req.log.error({ err }, "staff doc-dps-cad-access PATCH error");
    res.status(500).json({ error: "Unable to update DOC & DPS CAD access." });
  }
});

// ── POST /staff/roster — add / promote a member to a staff rank ───────────────
router.post("/staff/roster", async (req, res) => {
  const { id, discord_id, discord_username, nick, rank, status, appointed_date, actor } =
    req.body as { id?: number; discord_id?: string; discord_username?: string; nick?: string; rank?: string; status?: string; appointed_date?: string; actor?: string };

  if (!rank?.trim()) {
    res.status(400).json({ error: "rank is required." }); return;
  }
  if (!id && !discord_id) {
    res.status(400).json({ error: "Either id or discord_id is required." }); return;
  }

  try {
    // Resolve which group this rank belongs to → becomes the role
    const rankRow = await pool.query<{ group_id: number | null }>(
      `SELECT sr.group_id FROM staff_ranks sr WHERE lower(sr.name) = lower($1) LIMIT 1`,
      [rank.trim()]
    );
    if ((rankRow.rowCount ?? 0) === 0) {
      res.status(400).json({ error: "Unknown staff rank." }); return;
    }
    const groupId = rankRow.rows[0].group_id;
    let role = "Staff";
    let groupLocked = false;
    if (groupId) {
      const grp = await pool.query<{ name: string; locked: boolean }>(
        `SELECT name, locked FROM staff_rank_groups WHERE id = $1`, [groupId]
      );
      if ((grp.rowCount ?? 0) > 0) {
        role = grp.rows[0].name;
        groupLocked = grp.rows[0].locked;
      }
    }

    // Resolve the CAD profile ID — create one if needed for Discord-only members
    let profileId: number = id ?? 0;
    if (!id && discord_id) {
      // Try to find an existing profile by discord_id or discord_username
      let existing = await pool.query<{ id: number }>(
        `SELECT id FROM cad_user_profiles WHERE discord_id = $1 LIMIT 1`, [discord_id]
      );
      if ((existing.rowCount ?? 0) === 0 && discord_username) {
        existing = await pool.query<{ id: number }>(
          `SELECT id FROM cad_user_profiles WHERE lower(discord_username) = lower($1) LIMIT 1`,
          [discord_username]
        );
      }
      if ((existing.rowCount ?? 0) > 0) {
        profileId = existing.rows[0].id;
        // Back-fill discord_id if missing
        await pool.query(
          `UPDATE cad_user_profiles SET discord_id = $1, discord_username = COALESCE(discord_username, $2) WHERE id = $3`,
          [discord_id, discord_username ?? null, profileId]
        );
      } else {
        // Create a minimal CAD profile for this Discord member
        const displayName = nick ?? discord_username ?? discord_id;
        const placeholderEmail = `discord_${discord_id}@placeholder.dojcad`;
        const newProfile = await pool.query<{ id: number }>(
          `INSERT INTO cad_user_profiles (username, email, discord_username, discord_id, rank, role, whitelisted, created_at, updated_at)
           VALUES ($1, $2, $3, $4, 'Member', 'Community Members', false, NOW(), NOW())
           RETURNING id`,
          [displayName, placeholderEmail, discord_username ?? null, discord_id]
        );
        profileId = newProfile.rows[0].id;
      }
    }

    const result = await pool.query(
      `UPDATE cad_user_profiles
       SET staff_rank = $2, staff_role = $3,
           status               = COALESCE($4::text, status),
           staff_appointed_date = COALESCE($5::text::date, staff_appointed_date),
           whitelisted          = CASE WHEN $6 THEN TRUE ELSE whitelisted END,
           updated_at           = NOW()
       WHERE id = $1
       RETURNING id, username, discord_username, discord_id, staff_rank, staff_role, status, staff_appointed_date`,
      [profileId, rank.trim(), role, status?.trim() ?? null, appointed_date || null, groupLocked]
    );
    if ((result.rowCount ?? 0) === 0) {
      res.status(404).json({ error: "Member not found." }); return;
    }
    const added = result.rows[0] as { username: string };
    void writeLog("staff", actor || "Admin", "Added staff member", `${added.username} → ${rank?.trim()}`);
    res.json(result.rows[0]);
  } catch (err) {
    req.log.error({ err }, "staff POST error");
    res.status(500).json({ error: "Unable to add staff member." });
  }
});

// ── PATCH /staff/roster/:id — update a staff member's rank ───────────────────
router.patch("/staff/roster/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { rank, status, appointed_date, actor } = req.body as {
    rank?: string; status?: string; appointed_date?: string; actor?: string;
  };

  const logActor = actor || (typeof req.headers["x-actor"] === "string" ? req.headers["x-actor"] : "Admin");
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id." }); return;
  }
  try {
    let role: string | undefined;
    let groupLocked = false;
    if (rank?.trim()) {
      const rankRow = await pool.query<{ group_id: number | null }>(
        `SELECT group_id FROM staff_ranks WHERE lower(name) = lower($1) LIMIT 1`,
        [rank.trim()]
      );
      if ((rankRow.rowCount ?? 0) > 0 && rankRow.rows[0].group_id) {
        const grp = await pool.query<{ name: string; locked: boolean }>(
          `SELECT name, locked FROM staff_rank_groups WHERE id = $1`,
          [rankRow.rows[0].group_id]
        );
        if ((grp.rowCount ?? 0) > 0) {
          role = grp.rows[0].name;
          groupLocked = grp.rows[0].locked;
        }
      }
    }
    // Staff roster does not use callsigns — leave cad_user_profiles.callsign untouched
    // (that field remains for DPS / department personnel).
    const result = await pool.query(
      `UPDATE cad_user_profiles SET
         staff_rank     = CASE WHEN $2::text IS NOT NULL THEN $2 ELSE staff_rank END,
         staff_role     = CASE WHEN $3::text IS NOT NULL THEN $3 ELSE staff_role END,
         status         = CASE WHEN $4::text IS NOT NULL THEN $4 ELSE status END,
         staff_appointed_date = CASE WHEN $5::text IS NOT NULL THEN $5::date ELSE staff_appointed_date END,
         whitelisted          = CASE WHEN $6 THEN TRUE ELSE whitelisted END,
         updated_at           = NOW()
       WHERE id = $1
       RETURNING id, username, discord_username, discord_id, staff_rank, staff_role, status, staff_appointed_date`,
      [id, rank?.trim() ?? null, role ?? null,
       status?.trim() ?? null, appointed_date || null, groupLocked]
    );
    if ((result.rowCount ?? 0) === 0) {
      res.status(404).json({ error: "Member not found." }); return;
    }
    const updated = result.rows[0] as { username: string };
    void writeLog("staff", logActor, "Updated staff member", `${updated.username} (ID: ${id})${rank ? ` → ${rank.trim()}` : ""}`);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: "Unable to update staff member." });
  }
});

// ── DELETE /staff/roster/:id — demote member back to community ────────────────
router.delete("/staff/roster/:id", async (req, res) => {
  const id = Number(req.params.id);
  const actor = typeof req.headers["x-actor"] === "string" ? req.headers["x-actor"] : "Admin";
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id." }); return;
  }
  try {
    const nameRow = await pool.query<{ username: string }>(
      `SELECT username FROM cad_user_profiles WHERE id = $1`, [id]
    );
    await pool.query(
      `UPDATE cad_user_profiles SET staff_rank = NULL, staff_role = NULL, updated_at = NOW() WHERE id = $1`,
      [id]
    );
    const username = nameRow.rows[0]?.username ?? `ID ${id}`;
    void writeLog("staff", actor, "Removed staff member", username);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Unable to remove staff member." });
  }
});

// ── GET /staff/groups ─────────────────────────────────────────────────────────
router.get("/staff/groups", async (_req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, name, sort_order, locked, staff_access, admin_access, doc_access
       FROM staff_rank_groups ORDER BY sort_order, id`
    );
    res.json(r.rows.map(normalizeStaffGroupRow));
  } catch (err) {
    res.status(500).json({ error: "Unable to load groups." });
  }
});

// ── POST /staff/groups ────────────────────────────────────────────────────────
router.post("/staff/groups", async (req, res) => {
  const { name, actor } = req.body as { name?: string; actor?: string };
  const logActor = actor || "Admin";
  if (!name?.trim()) { res.status(400).json({ error: "Name is required." }); return; }
  try {
    const mx = await pool.query(`SELECT COALESCE(MAX(sort_order), 0) AS m FROM staff_rank_groups`);
    const r = await pool.query(
      `INSERT INTO staff_rank_groups (name, sort_order, locked, staff_access, admin_access, doc_access)
       VALUES ($1, $2, FALSE, TRUE, FALSE, FALSE)
       RETURNING id, name, sort_order, locked, staff_access, admin_access, doc_access`,
      [name.trim(), (mx.rows[0].m as number) + 1]
    );
    void writeLog("staff", logActor, "Created staff group", name.trim());
    res.status(201).json(r.rows[0]);
  } catch (err: unknown) {
    const pg = err as { code?: string };
    if (pg.code === "23505") { res.status(409).json({ error: "A group with that name already exists." }); return; }
    res.status(500).json({ error: "Unable to add group." });
  }
});

// ── POST /staff/groups/reorder ────────────────────────────────────────────────
router.post("/staff/groups/reorder", async (req, res) => {
  const { ids } = req.body as { ids?: number[] };
  if (!Array.isArray(ids) || ids.length === 0) {
    res.status(400).json({ error: "ids required." }); return;
  }
  try {
    // Locked groups stay at sort_order 0; unlocked get new sort_orders
    const locked = await pool.query<{ id: number }>(
      `SELECT id FROM staff_rank_groups WHERE locked = TRUE`
    );
    const lockedIds = new Set(locked.rows.map(r => r.id));
    let unlocked_order = locked.rows.length;
    await Promise.all(
      ids.map((id) => {
        if (lockedIds.has(id)) {
          return pool.query(`UPDATE staff_rank_groups SET sort_order = 0 WHERE id = $1`, [id]);
        }
        return pool.query(`UPDATE staff_rank_groups SET sort_order = $1 WHERE id = $2`, [unlocked_order++, id]);
      })
    );
    const r = await pool.query(
      `SELECT id, name, sort_order, locked, staff_access, admin_access, doc_access
       FROM staff_rank_groups ORDER BY sort_order, id`
    );
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: "Unable to reorder groups." });
  }
});

// ── PATCH /staff/groups/:id — rename (non-locked only) ───────────────────────
router.patch("/staff/groups/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { name, actor } = req.body as { name?: string; actor?: string };
  const logActor = actor || "Admin";
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id." }); return;
  }
  if (!name?.trim()) { res.status(400).json({ error: "Name is required." }); return; }
  try {
    const check = await pool.query<{ locked: boolean }>(
      `SELECT locked FROM staff_rank_groups WHERE id = $1`, [id]
    );
    if ((check.rowCount ?? 0) === 0) { res.status(404).json({ error: "Group not found." }); return; }
    if (check.rows[0].locked) {
      res.status(403).json({ error: "The Executive Team group cannot be renamed." }); return;
    }
    // Also update role on members who belong to this group
    const old = await pool.query<{ name: string }>(
      `SELECT name FROM staff_rank_groups WHERE id = $1`, [id]
    );
    const oldName = old.rows[0].name;
    await pool.query(
      `UPDATE cad_user_profiles SET role = $1 WHERE role = $2`,
      [name.trim(), oldName]
    );
    const r = await pool.query(
      `UPDATE staff_rank_groups SET name = $2 WHERE id = $1
       RETURNING id, name, sort_order, locked, staff_access, admin_access, doc_access`,
      [id, name.trim()]
    );
    void writeLog("staff", logActor, "Renamed staff group", `"${oldName}" → "${name.trim()}"`);
    res.json(normalizeStaffGroupRow(r.rows[0]));
  } catch (err: unknown) {
    const pg = err as { code?: string };
    if (pg.code === "23505") { res.status(409).json({ error: "A group with that name already exists." }); return; }
    res.status(500).json({ error: "Unable to rename group." });
  }
});

// ── PATCH /staff/groups/:id/access — toggle staff_access / admin_access ───────
router.patch("/staff/groups/:id/access", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id." }); return;
  }
  const { staff_access, admin_access, doc_access } = req.body as {
    staff_access?: boolean; admin_access?: boolean; doc_access?: boolean;
  };
  if (staff_access === undefined && admin_access === undefined && doc_access === undefined) {
    res.status(400).json({ error: "staff_access, admin_access, or doc_access is required." }); return;
  }
  try {
    if (await denyUnlessSuperAdminForLocked(req, res, id)) return;
    const r = await pool.query(
      `UPDATE staff_rank_groups SET
         staff_access = CASE WHEN $2::boolean IS NOT NULL THEN $2 ELSE staff_access END,
         admin_access = CASE WHEN $3::boolean IS NOT NULL THEN $3 ELSE admin_access END,
         doc_access   = CASE WHEN $4::boolean IS NOT NULL THEN $4 ELSE doc_access   END
       WHERE id = $1
       RETURNING id, name, sort_order, locked, staff_access, admin_access, doc_access`,
      [id, staff_access ?? null, admin_access ?? null, doc_access ?? null]
    );
    if ((r.rowCount ?? 0) === 0) { res.status(404).json({ error: "Group not found." }); return; }
    const actor =
      (typeof req.headers["x-actor"] === "string" && req.headers["x-actor"])
      || (typeof (req.body as { actor?: string }).actor === "string" && (req.body as { actor?: string }).actor)
      || "Admin";
    const groupName = String(r.rows[0].name ?? id);
    if (typeof staff_access === "boolean") {
      void writeLog(
        "staff",
        actor,
        staff_access ? "Granted Staff Portal group access" : "Revoked Staff Portal group access",
        groupName,
      );
    }
    if (typeof admin_access === "boolean") {
      void writeLog(
        "staff",
        actor,
        admin_access ? "Granted Admin Portal group access" : "Revoked Admin Portal group access",
        groupName,
      );
    }
    if (typeof doc_access === "boolean") {
      void writeLog(
        "staff",
        actor,
        doc_access ? "Granted DOC group access" : "Revoked DOC group access",
        groupName,
      );
    }
    res.json(normalizeStaffGroupRow(r.rows[0]));
  } catch (err) {
    res.status(500).json({ error: "Unable to update group access." });
  }
});

// ── DELETE /staff/groups/:id — delete non-locked group ───────────────────────
router.delete("/staff/groups/:id", async (req, res) => {
  const id = Number(req.params.id);
  const actor = typeof req.headers["x-actor"] === "string" ? req.headers["x-actor"] : "Admin";
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id." }); return;
  }
  try {
    const check = await pool.query<{ locked: boolean; name: string }>(
      `SELECT locked, name FROM staff_rank_groups WHERE id = $1`, [id]
    );
    if ((check.rowCount ?? 0) === 0) { res.status(404).json({ error: "Group not found." }); return; }
    if (check.rows[0].locked) {
      res.status(403).json({ error: "The Executive Team group cannot be deleted." }); return;
    }
    // Demote any members in this group back to community
    await pool.query(
      `UPDATE cad_user_profiles SET rank = '', role = '' WHERE lower(role) = lower($1)`,
      [check.rows[0].name]
    );
    // Fully delete all ranks belonging to this group
    await pool.query(`DELETE FROM staff_ranks WHERE group_id = $1`, [id]);
    await pool.query(`DELETE FROM staff_rank_groups WHERE id = $1`, [id]);
    void writeLog("staff", actor, "Deleted staff group", check.rows[0].name);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Unable to delete group." });
  }
});

// ── POST /staff/assign-discord-roles — CAD rank → Discord role (reverse sync) ─
// Reads every CAD profile that has a staff_rank linked to a discord_role_id and
// grants that Discord role in the staff guild via the bot token.
router.post("/staff/assign-discord-roles", async (_req, res) => {
  const tok = process.env.DISCORD_BOT_TOKEN;
  if (!tok) { res.status(503).json({ error: "No DISCORD_BOT_TOKEN configured." }); return; }

  try {
    // All ranks that have a Discord role linked
    const ranksRes = await pool.query<{ name: string; discord_role_id: string }>(
      `SELECT name, discord_role_id FROM staff_ranks
       WHERE discord_role_id IS NOT NULL AND discord_role_id != ''`
    );
    if (ranksRes.rows.length === 0) {
      res.json({ assigned: 0, skipped: 0, errors: ["No ranks are linked to a Discord role yet."] });
      return;
    }

    // Map rank name → discord role id
    const rankToRole = new Map(
      ranksRes.rows
        .map(r => [r.name.toLowerCase(), r.discord_role_id.trim()] as const)
        .filter(([, roleId]) => roleId.length > 0),
    );

    // All CAD profiles with a staff_rank and a discord_id
    const profilesRes = await pool.query<{ discord_id: string; staff_rank: string }>(
      `SELECT discord_id, staff_rank FROM cad_user_profiles
       WHERE staff_rank IS NOT NULL AND discord_id IS NOT NULL AND discord_id != ''`
    );

    const allLinkedRoleIds = ranksRes.rows.map(r => r.discord_role_id);
    let assigned = 0; let skipped = 0; let removed = 0; const errors: string[] = [];

    for (const profile of profilesRes.rows) {
      const targetRoleId = rankToRole.get(profile.staff_rank.toLowerCase());

      // Remove stale linked rank roles so promotions/demotion in CAD stay in sync.
      for (const roleId of allLinkedRoleIds) {
        if (targetRoleId && roleId === targetRoleId) continue;
        const delUrl = `https://discord.com/api/v10/guilds/${STAFF_GUILD_ID}/members/${profile.discord_id}/roles/${roleId}`;
        const dr = await staffDiscordFetch(delUrl, { method: "DELETE" });
        if (dr.status === 204 || dr.ok) removed++;
        else if (dr.status !== 404) errors.push(`remove ${profile.discord_id}/${roleId}: HTTP ${dr.status}`);
      }

      if (!targetRoleId) { skipped++; continue; }

      const putUrl = `https://discord.com/api/v10/guilds/${STAFF_GUILD_ID}/members/${profile.discord_id}/roles/${targetRoleId}`;
      const r = await staffDiscordFetch(putUrl, { method: "PUT" });
      if (r.status === 204 || r.ok) {
        assigned++;
      } else if (r.status === 404) {
        skipped++;
      } else {
        errors.push(`discord_id ${profile.discord_id}: HTTP ${r.status}`);
      }
    }

    console.info(`[staff-assign-roles] assigned=${assigned} skipped=${skipped} removed=${removed} errors=${errors.length}`);
    res.json({ assigned, skipped, removed, errors });
  } catch (e) {
    console.error("[staff-assign-roles] Error:", e);
    res.status(500).json({ error: String(e) });
  }
});

// ── GET /staff/member-search — typeahead limited to staff guild members ────────
// Returns a combined list of:
//   • CAD profiles whose discord_id is in the staff guild
//   • Discord-only guild members not yet in CAD
// Results are filtered to the query string `q` and capped at 20.
router.get("/staff/member-search", async (req, res) => {
  const q = String(req.query.q ?? "").trim().toLowerCase();
  if (q.length < 1) { res.json([]); return; }

  type SearchHit = {
    id: number | null; username: string; discord_username: string | null;
    discord_id: string | null; nick: string | null; rank: string | null;
    source: "cad" | "discord";
  };

  try {
    const cached = await ensureStaffMembersCache();
    const staffDiscordIds = cached.map(m => m.id);
    const hits: SearchHit[] = [];
    const seenDiscordIds = new Set<string>();

    // 1. CAD profiles whose discord_id is in the staff guild
    if (staffDiscordIds.length > 0) {
      const cadRes = await pool.query<{
        id: number; username: string; discord_username: string | null;
        discord_id: string | null; staff_rank: string | null; rank: string | null;
      }>(
        `SELECT id, username, discord_username, discord_id, staff_rank, rank
         FROM cad_user_profiles
         WHERE discord_id = ANY($1::text[])
           AND (username ILIKE $2 OR discord_username ILIKE $2 OR discord_id ILIKE $2)
         ORDER BY username LIMIT 20`,
        [staffDiscordIds, `%${q}%`]
      );
      for (const row of cadRes.rows) {
        hits.push({ id: row.id, username: row.username, discord_username: row.discord_username,
          discord_id: row.discord_id, nick: null, rank: row.staff_rank ?? row.rank, source: "cad" });
        if (row.discord_id) seenDiscordIds.add(row.discord_id);
      }
    }

    // 2. Discord-only guild members not yet in CAD
    const remaining = 20 - hits.length;
    if (remaining > 0) {
      const discordHits = cached.filter(m => {
        if (seenDiscordIds.has(m.id)) return false;
        const display = (m.nick ?? m.username).toLowerCase();
        return m.username.toLowerCase().includes(q)
          || display.includes(q)
          || m.id.includes(q);
      });
      for (const m of discordHits.slice(0, remaining)) {
        hits.push({ id: null, username: m.nick ?? m.username, discord_username: m.username,
          discord_id: m.id, nick: m.nick, rank: null, source: "discord" });
      }
    }

    res.json(hits.slice(0, 20));
  } catch (err) {
    req.log.error({ err }, "staff/member-search error");
    res.status(500).json({ error: "Search failed." });
  }
});

// ── GET /staff/discord-roles ──────────────────────────────────────────────────
router.get("/staff/discord-roles", async (req, res) => {
  if (!process.env.DISCORD_BOT_TOKEN) { res.json([]); return; }
  try {
    const refresh = wantsDiscordRolesRefresh(req.query as Record<string, unknown>);
    res.json(await getStaffGuildRoles(refresh));
  } catch (err) {
    req.log?.error?.({ err }, "staff/discord-roles GET error");
    res.status(500).json({ error: "Unable to load Discord roles." });
  }
});

// ── POST /staff/sync-discord-roles ────────────────────────────────────────────
router.post("/staff/sync-discord-roles", async (_req, res) => {
  try {
    res.json(await syncStaffDiscordRoles());
  } catch (err) {
    res.status(500).json({ error: "Sync failed." });
  }
});

// ── GET /staff/ranks ──────────────────────────────────────────────────────────
router.get("/staff/ranks", async (_req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, name, sort_order, group_id, color_hex, discord_role_id
       FROM staff_ranks ORDER BY sort_order, id`
    );
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: "Unable to load ranks." });
  }
});

// ── POST /staff/ranks ─────────────────────────────────────────────────────────
router.post("/staff/ranks", async (req, res) => {
  const { name, group_id, color_hex, discord_role_id, actor } =
    req.body as { name?: string; group_id?: number; color_hex?: string; discord_role_id?: string; actor?: string };
  const logActor = actor || "Admin";
  if (!name?.trim()) { res.status(400).json({ error: "Name is required." }); return; }
  try {
    if (await denyUnlessSuperAdminForLocked(req, res, group_id ?? null)) return;
    const mx = await pool.query(`SELECT COALESCE(MAX(sort_order), -1) AS m FROM staff_ranks`);
    const r = await pool.query(
      `INSERT INTO staff_ranks (name, sort_order, group_id, color_hex, discord_role_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, sort_order, group_id, color_hex, discord_role_id`,
      [name.trim(), (mx.rows[0].m as number) + 1, group_id ?? null, color_hex ?? null, discord_role_id ?? null]
    );
    void writeLog("staff", logActor, "Created staff rank", name.trim());
    // Immediately sync assignments for this new rank if it has a Discord role linked
    if (discord_role_id) void syncStaffDiscordRoles().catch(console.error);
    res.status(201).json(r.rows[0]);
  } catch (err: unknown) {
    req.log.error({ err }, "staff ranks POST error");
    if (isUniqueViolation(err)) { res.status(409).json({ error: "A rank with that name already exists." }); return; }
    res.status(500).json({ error: "Unable to add rank." });
  }
});

// ── POST /staff/ranks/reorder ─────────────────────────────────────────────────
router.post("/staff/ranks/reorder", async (req, res) => {
  const { ids } = req.body as { ids?: number[] };
  if (!Array.isArray(ids) || ids.length === 0) {
    res.status(400).json({ error: "ids required." }); return;
  }
  try {
    // If any rank belongs to a locked group, only superadmins may reorder.
    const lockedHit = await pool.query<{ id: number }>(
      `SELECT r.id FROM staff_ranks r
       JOIN staff_rank_groups g ON g.id = r.group_id
       WHERE r.id = ANY($1::int[]) AND g.locked = TRUE
       LIMIT 1`,
      [ids],
    );
    if ((lockedHit.rowCount ?? 0) > 0 && !requestIsSuperAdmin(req)) {
      res.status(403).json({ error: "Only superadmins can reorder Executive Team ranks." }); return;
    }
    await Promise.all(ids.map((id, i) =>
      pool.query(`UPDATE staff_ranks SET sort_order = $1 WHERE id = $2`, [i, id])
    ));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Unable to reorder ranks." });
  }
});

// ── PATCH /staff/ranks/:id ────────────────────────────────────────────────────
router.patch("/staff/ranks/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { name, group_id, color_hex } =
    req.body as { name?: string; group_id?: number | null; color_hex?: string };
  // discord_role_id: only update when the key is explicitly present
  const hasDiscordRole = Object.prototype.hasOwnProperty.call(req.body, "discord_role_id");
  const discordRoleId  = hasDiscordRole ? (req.body.discord_role_id as string | null) : undefined;
  const hasGroupId = Object.prototype.hasOwnProperty.call(req.body, "group_id");
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id." }); return;
  }
  try {
    const existing = await pool.query<{ group_id: number | null }>(
      `SELECT group_id FROM staff_ranks WHERE id = $1 LIMIT 1`, [id]
    );
    if ((existing.rowCount ?? 0) === 0) { res.status(404).json({ error: "Rank not found." }); return; }
    if (await denyUnlessSuperAdminForLocked(req, res, existing.rows[0].group_id)) return;
    if (hasGroupId && await denyUnlessSuperAdminForLocked(req, res, group_id ?? null)) return;

    // If name is changing, update members who have this rank
    if (name?.trim()) {
      const old = await pool.query<{ name: string }>(
        `SELECT name FROM staff_ranks WHERE id = $1`, [id]
      );
      if ((old.rowCount ?? 0) > 0) {
        await pool.query(
          `UPDATE cad_user_profiles SET staff_rank = $1 WHERE lower(staff_rank) = lower($2)`,
          [name.trim(), old.rows[0].name]
        );
      }
    }
    const r = await pool.query(
      `UPDATE staff_ranks SET
         name            = CASE WHEN $2::text    IS NOT NULL THEN $2    ELSE name            END,
         group_id        = CASE WHEN $3::boolean             THEN $4    ELSE group_id        END,
         color_hex       = CASE WHEN $5::text    IS NOT NULL THEN $5    ELSE color_hex       END,
         discord_role_id = CASE WHEN $6::boolean             THEN $7    ELSE discord_role_id END
       WHERE id = $1
       RETURNING id, name, sort_order, group_id, color_hex, discord_role_id`,
      [id, name?.trim() ?? null, hasGroupId, group_id ?? null, color_hex ?? null,
       hasDiscordRole, discordRoleId ?? null]
    );
    if ((r.rowCount ?? 0) === 0) { res.status(404).json({ error: "Rank not found." }); return; }
    if (hasDiscordRole) void syncStaffDiscordRoles().catch(console.error);
    res.json(normalizeStaffGroupRow(r.rows[0]));
  } catch (err: unknown) {
    const pg = err as { code?: string };
    if (pg.code === "23505") { res.status(409).json({ error: "That name is already taken." }); return; }
    res.status(500).json({ error: "Unable to update rank." });
  }
});

// ── DELETE /staff/ranks/:id ───────────────────────────────────────────────────
router.delete("/staff/ranks/:id", async (req, res) => {
  const id = Number(req.params.id);
  const actor = typeof req.headers["x-actor"] === "string" ? req.headers["x-actor"] : "Admin";
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id." }); return;
  }
  try {
    const check = await pool.query<{ name: string; group_id: number | null }>(
      `SELECT name, group_id FROM staff_ranks WHERE id = $1`, [id]
    );
    if ((check.rowCount ?? 0) === 0) { res.status(404).json({ error: "Rank not found." }); return; }
    const { name, group_id } = check.rows[0];
    if (await denyUnlessSuperAdminForLocked(req, res, group_id)) return;
    // Clear the title from any members who held this rank; leave their group (role) intact
    await pool.query(
      `UPDATE cad_user_profiles SET rank = '' WHERE lower(rank) = lower($1)`,
      [name]
    );
    await pool.query(`DELETE FROM staff_ranks WHERE id = $1`, [id]);
    void writeLog("staff", actor, "Deleted staff rank", name);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Unable to delete rank." });
  }
});

// ── Staff events ──────────────────────────────────────────────────────────────
const ensureStaffEvents = pool.query(`
  CREATE TABLE IF NOT EXISTS staff_events (
    id                  SERIAL PRIMARY KEY,
    title               TEXT NOT NULL,
    event_date          DATE NOT NULL,
    event_time          TEXT,
    location            TEXT,
    purpose             TEXT,
    hosted_by           TEXT,
    hosting_department  TEXT NOT NULL DEFAULT 'DOJ Staff',
    is_public           BOOLEAN NOT NULL DEFAULT false,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`).then(() => pool.query(`ALTER TABLE staff_events ADD COLUMN IF NOT EXISTS hosted_by TEXT`))
  .then(() => pool.query(`ALTER TABLE staff_events ADD COLUMN IF NOT EXISTS hosting_department TEXT`))
  .catch(() => {});

function mapStaffEvent(row: Record<string, unknown>) {
  return {
    ...row,
    event_date: String(row.event_date ?? "").slice(0, 10),
    hosting_department: (row.hosting_department as string) || "DOJ Staff",
    is_public: Boolean(row.is_public),
  };
}

router.get("/staff/events", async (req, res) => {
  await ensureStaffEvents;
  try {
    const publicOnly = req.query.public === "true";
    const result = await pool.query(
      `SELECT id, title, event_date, event_time, location, purpose,
              hosted_by, hosting_department, is_public, created_at
       FROM staff_events
       ${publicOnly ? "WHERE is_public = true" : ""}
       ORDER BY event_date ASC, event_time ASC`
    );
    res.json(result.rows.map((row) => mapStaffEvent(row as Record<string, unknown>)));
  } catch {
    res.status(500).json({ error: "Unable to load events." });
  }
});

router.post("/staff/events", async (req, res) => {
  await ensureStaffEvents;
  const { title, event_date, event_time, location, purpose, is_public, hosted_by } = req.body as {
    title?: string; event_date?: string; event_time?: string;
    location?: string; purpose?: string; is_public?: boolean; hosted_by?: string;
  };
  if (!title?.trim() || !event_date) {
    res.status(400).json({ error: "title and event_date are required." }); return;
  }
  try {
    const r = await pool.query(
      `INSERT INTO staff_events (title, event_date, event_time, location, purpose, is_public, hosted_by, hosting_department)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, title, event_date, event_time, location, purpose, hosted_by, hosting_department, is_public, created_at`,
      [
        title.trim(), event_date, event_time || null, location?.trim() || null, purpose?.trim() || null,
        is_public === true, hosted_by?.trim() || null, "DOJ Staff",
      ]
    );
    res.status(201).json(mapStaffEvent(r.rows[0] as Record<string, unknown>));
  } catch (err) {
    req.log.error({ err }, "staff/events POST error");
    res.status(500).json({ error: "Unable to create event." });
  }
});

router.patch("/staff/events/:id", async (req, res) => {
  await ensureStaffEvents;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid id." }); return; }
  const { title, event_date, event_time, location, purpose, is_public, hosted_by } = req.body as {
    title?: string; event_date?: string; event_time?: string;
    location?: string; purpose?: string; is_public?: boolean; hosted_by?: string;
  };
  if (!title?.trim() || !event_date) {
    res.status(400).json({ error: "title and event_date are required." }); return;
  }
  try {
    const r = await pool.query(
      `UPDATE staff_events SET title=$1, event_date=$2, event_time=$3, location=$4, purpose=$5, is_public=$6,
         hosted_by=$7, hosting_department=$8
       WHERE id=$9
       RETURNING id, title, event_date, event_time, location, purpose, hosted_by, hosting_department, is_public, created_at`,
      [
        title.trim(), event_date, event_time || null, location?.trim() || null, purpose?.trim() || null,
        is_public === true, hosted_by?.trim() || null, "DOJ Staff", id,
      ]
    );
    if (!r.rows.length) { res.status(404).json({ error: "Event not found." }); return; }
    res.json(mapStaffEvent(r.rows[0] as Record<string, unknown>));
  } catch (err) {
    req.log.error({ err }, "staff/events PATCH error");
    res.status(500).json({ error: "Unable to update event." });
  }
});

router.delete("/staff/events/:id", async (req, res) => {
  await ensureStaffEvents;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid id." }); return; }
  try {
    await pool.query(`DELETE FROM staff_events WHERE id=$1`, [id]);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Unable to delete event." });
  }
});

export default router;
