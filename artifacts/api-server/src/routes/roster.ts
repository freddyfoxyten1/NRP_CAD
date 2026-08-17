import { Router } from "express";
import { isUniqueViolation, isMongoStore, pool } from "@workspace/db";
import { writeLog } from "../lib/audit-log.js";
import { getDiscordGuildRoles, wantsDiscordRolesRefresh } from "../lib/discord-guild-roles-cache.js";
import { registerDiscordGuildSync } from "../lib/discord-realtime-sync.js";
import { sortByCallsignThenUsername, sortDepartmentPersonnel } from "../lib/roster-sort.js";
import { buildLinkedRankByRoleId, pickHighestLinkedDiscordRole } from "../lib/discord-rank-pick.js";
import {
  clearAllDpsPermissionGrants,
  dpsRosterRowExists,
  resetDpsMemberAccessPermissions,
  resetDpsMemberPermissionGrants,
} from "../lib/department-permissions.js";
import {
  listDpsDivisionRanksMongo,
  listDpsDivisionsMongo,
  listDpsEquipmentCategoriesMongo,
  listDpsEquipmentMongo,
  listDpsEventsMongo,
  listDpsFleetCategoriesMongo,
  listDpsFleetMongo,
  listDpsPersonnelMongo,
  listDpsRankGroupsMongo,
  listDpsRanksMongo,
  getDpsContentMongo,
  getDpsDivisionInfoMongo,
  getDpsDivisionRankDetailMongo,
  getDpsRankDetailMongo,
  loadDpsDivisionAssignmentsMongo,
  searchDpsMembersMongo,
} from "../lib/dps-roster-mongo.js";
import { normalizeGroupRow, normalizeRankGroupId, normalizeRankRow } from "../lib/roster-normalize.js";

const router = Router();

// ─── DPS Discord Guild ────────────────────────────────────────────────────────
const DPS_GUILD_ID = process.env.DPS_DISCORD_GUILD_ID ?? "1469131277612486791";
/** Guild used for Division Roster Discord role links — defaults to the DPS guild. */
const DIVISION_GUILD_ID = process.env.DIVISION_DISCORD_GUILD_ID ?? DPS_GUILD_ID;

const UNIT_KEYS = ["pob", "iab", "hsu", "sru", "fou"] as const;
type UnitKey = (typeof UNIT_KEYS)[number];

function unitKeyFromDivision(name: string, unitKey?: string | null): UnitKey | null {
  const explicit = (unitKey ?? "").trim().toLowerCase();
  if ((UNIT_KEYS as readonly string[]).includes(explicit)) return explicit as UnitKey;
  const n = name.trim().toLowerCase();
  if (n === "pob" || n.includes("patrol")) return "pob";
  if (n === "iab" || n.includes("internal affairs")) return "iab";
  if (n === "hsu" || n.includes("high speed")) return "hsu";
  if (n === "sru" || n.includes("special response")) return "sru";
  if (n === "fou" || n.includes("field operations")) return "fou";
  return null;
}

/** When division_rank changes, mirror that onto personnel roster unit flags (POB/IAB/…). */
async function syncPersonnelUnitFromDivisionRank(
  profileId: number,
  previousDivisionRank: string | null,
  nextDivisionRank: string | null,
): Promise<void> {
  const lookup = async (rankName: string | null) => {
    if (!rankName?.trim()) return null as { name: string; unit_key: string | null } | null;
    const res = await pool.query<{ name: string; unit_key: string | null }>(
      `SELECT dd.name, dd.unit_key
       FROM dps_division_ranks dr
       JOIN dps_divisions dd ON dd.id = dr.division_id
       WHERE lower(dr.name) = lower($1)
       LIMIT 1`,
      [rankName.trim()]
    );
    return res.rows[0] ?? null;
  };

  const prev = await lookup(previousDivisionRank);
  const next = await lookup(nextDivisionRank);
  const prevKey = prev ? unitKeyFromDivision(prev.name, prev.unit_key) : null;
  const nextKey = next ? unitKeyFromDivision(next.name, next.unit_key) : null;

  if (prevKey && prevKey !== nextKey) {
    await pool.query(`UPDATE dps_users SET ${prevKey} = false WHERE profile_id = $1`, [profileId]);
  }
  if (nextKey) {
    await pool.query(`UPDATE dps_users SET ${nextKey} = true WHERE profile_id = $1`, [profileId]);
  }
}

type DivisionAssignment = {
  division_id: number;
  division_name: string;
  division_rank: string;
  unit_key: string | null;
  sort_order: number;
  is_manual?: boolean;
  can_edit_resources?: boolean;
  can_edit_roster?: boolean;
  can_edit_info?: boolean;
};

async function loadDivisionAssignments(profileIds: number[]): Promise<Map<number, DivisionAssignment[]>> {
  const map = new Map<number, DivisionAssignment[]>();
  if (profileIds.length === 0) return map;

  if (isMongoStore()) {
    return await loadDpsDivisionAssignmentsMongo(profileIds) as Map<number, DivisionAssignment[]>;
  }

  const res = await pool.query<{
    profile_id: number;
    division_id: number;
    division_name: string;
    division_rank: string;
    unit_key: string | null;
    sort_order: number;
    is_manual: boolean | number | null;
    can_edit_resources: boolean | number | null;
    can_edit_roster: boolean | number | null;
    can_edit_info: boolean | number | null;
  }>(
    `SELECT ud.profile_id, ud.division_id, dd.name AS division_name, ud.division_rank,
            dd.unit_key, COALESCE(dd.sort_order, 999) AS sort_order,
            COALESCE(ud.is_manual, false) AS is_manual,
            COALESCE(ud.can_edit_resources, false) AS can_edit_resources,
            COALESCE(ud.can_edit_roster, false) AS can_edit_roster,
            COALESCE(ud.can_edit_info, false) AS can_edit_info
     FROM dps_user_divisions ud
     JOIN dps_divisions dd ON dd.id = ud.division_id
     WHERE ud.profile_id = ANY($1)
     ORDER BY dd.sort_order, dd.id`,
    [profileIds]
  );
  for (const row of res.rows) {
    const list = map.get(row.profile_id) ?? [];
    list.push({
      division_id: row.division_id,
      division_name: row.division_name,
      division_rank: row.division_rank,
      unit_key: row.unit_key,
      sort_order: row.sort_order,
      is_manual: Boolean(row.is_manual),
      can_edit_resources: Boolean(row.can_edit_resources),
      can_edit_roster: Boolean(row.can_edit_roster),
      can_edit_info: Boolean(row.can_edit_info),
    });
    map.set(row.profile_id, list);
  }
  return map;
}

/** Recompute POB/IAB/… flags from the member's full multi-division assignment set. */
async function syncPersonnelUnitsFromAssignments(profileId: number): Promise<void> {
  const res = await pool.query<{ name: string; unit_key: string | null }>(
    `SELECT dd.name, dd.unit_key
     FROM dps_user_divisions ud
     JOIN dps_divisions dd ON dd.id = ud.division_id
     WHERE ud.profile_id = $1`,
    [profileId]
  );
  const active = new Set<UnitKey>();
  for (const row of res.rows) {
    const key = unitKeyFromDivision(row.name, row.unit_key);
    if (key) active.add(key);
  }
  for (const key of UNIT_KEYS) {
    await pool.query(
      `UPDATE dps_users SET ${key} = $2 WHERE profile_id = $1`,
      [profileId, active.has(key)]
    );
  }
}

/**
 * Replace a member's division assignments.
 * One rank per division; multiple divisions allowed.
 * Also mirrors the first assignment onto dps_users.division_rank for compatibility.
 * Preserves is_manual / permission flags for divisions that remain unless explicitly overridden.
 */
async function setMemberDivisionAssignments(
  profileId: number,
  assignments: Array<{
    division_id: number;
    division_rank: string;
    is_manual?: boolean;
    can_edit_resources?: boolean;
    can_edit_roster?: boolean;
    can_edit_info?: boolean;
  }>,
): Promise<DivisionAssignment[]> {
  const existingFlags = await pool.query<{
    division_id: number;
    is_manual: boolean | number | null;
    can_edit_resources: boolean | number | null;
    can_edit_roster: boolean | number | null;
    can_edit_info: boolean | number | null;
  }>(
    `SELECT division_id,
            COALESCE(is_manual, false) AS is_manual,
            COALESCE(can_edit_resources, false) AS can_edit_resources,
            COALESCE(can_edit_roster, false) AS can_edit_roster,
            COALESCE(can_edit_info, false) AS can_edit_info
     FROM dps_user_divisions WHERE profile_id = $1`,
    [profileId]
  );
  const flagMap = new Map(existingFlags.rows.map(r => [r.division_id, {
    is_manual: Boolean(r.is_manual),
    can_edit_resources: Boolean(r.can_edit_resources),
    can_edit_roster: Boolean(r.can_edit_roster),
    can_edit_info: Boolean(r.can_edit_info),
  }]));

  // Validate ranks belong to their divisions
  const cleaned: Array<{
    division_id: number;
    division_rank: string;
    is_manual: boolean;
    can_edit_resources: boolean;
    can_edit_roster: boolean;
    can_edit_info: boolean;
  }> = [];
  const seen = new Set<number>();
  for (const a of assignments) {
    const divisionId = Number(a.division_id);
    const rankName = String(a.division_rank ?? "").trim();
    if (!Number.isInteger(divisionId) || divisionId <= 0 || !rankName) continue;
    if (seen.has(divisionId)) continue;
    const ok = await pool.query(
      `SELECT 1 AS ok FROM dps_division_ranks
       WHERE division_id = $1 AND lower(name) = lower($2) LIMIT 1`,
      [divisionId, rankName]
    );
    if (!ok.rows.length) continue;
    seen.add(divisionId);
    const prev = flagMap.get(divisionId);
    cleaned.push({
      division_id: divisionId,
      division_rank: rankName,
      is_manual: a.is_manual !== undefined ? Boolean(a.is_manual) : (prev?.is_manual ?? false),
      can_edit_resources: a.can_edit_resources !== undefined
        ? Boolean(a.can_edit_resources)
        : (prev?.can_edit_resources ?? false),
      can_edit_roster: a.can_edit_roster !== undefined
        ? Boolean(a.can_edit_roster)
        : (prev?.can_edit_roster ?? false),
      can_edit_info: a.can_edit_info !== undefined
        ? Boolean(a.can_edit_info)
        : (prev?.can_edit_info ?? false),
    });
  }

  await pool.query(`DELETE FROM dps_user_divisions WHERE profile_id = $1`, [profileId]);
  for (const a of cleaned) {
    await pool.query(
      `INSERT INTO dps_user_divisions
         (profile_id, division_id, division_rank, is_manual, can_edit_resources, can_edit_roster, can_edit_info)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [profileId, a.division_id, a.division_rank, a.is_manual, a.can_edit_resources, a.can_edit_roster, a.can_edit_info]
    );
  }

  const primary = cleaned[0]?.division_rank ?? null;
  await pool.query(
    `UPDATE dps_users SET division_rank = $2, updated_at = NOW() WHERE profile_id = $1`,
    [profileId, primary]
  );
  await syncPersonnelUnitsFromAssignments(profileId);

  const map = await loadDivisionAssignments([profileId]);
  return map.get(profileId) ?? [];
}

/** Migrate legacy single division_rank into dps_user_divisions (idempotent). */
async function migrateLegacyDivisionAssignments(): Promise<void> {
  try {
    await pool.query(`
      INSERT INTO dps_user_divisions (profile_id, division_id, division_rank)
      SELECT u.profile_id, dr.division_id, u.division_rank
      FROM dps_users u
      JOIN dps_division_ranks dr ON lower(dr.name) = lower(u.division_rank)
      WHERE u.division_rank IS NOT NULL AND trim(u.division_rank) != ''
        AND dr.division_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM dps_user_divisions x
          WHERE x.profile_id = u.profile_id AND x.division_id = dr.division_id
        )
    `);
  } catch (err) {
    console.warn("[dps] legacy division assignment migrate skipped:", err);
  }
}

// Cache of all DPS guild members — populated by the background sync so the
// member-search endpoint never needs to re-paginate for a search query.
type DpsMemberCacheEntry = { id: string; username: string; nick: string | null };
const dpsMembersCache: { members: DpsMemberCacheEntry[]; fetchedAt: number } =
  { members: [], fetchedAt: 0 };

async function dpsDiscordFetch(url: string): Promise<globalThis.Response> {
  const tok = process.env.DISCORD_BOT_TOKEN ?? "";
  let r = await fetch(url, { headers: { Authorization: `Bot ${tok}` } });
  if (r.status === 429) {
    const body = await r.json().catch(() => ({})) as { retry_after?: number };
    await new Promise(res => setTimeout(res, Math.min((body.retry_after ?? 1) * 1000 + 200, 10_000)));
    r = await fetch(url, { headers: { Authorization: `Bot ${tok}` } });
  }
  return r;
}

async function getDpsGuildRoles(refresh = false): Promise<Array<{ id: string; name: string; position: number }>> {
  return getDiscordGuildRoles(DPS_GUILD_ID, { refresh });
}

async function getDivisionGuildRoles(refresh = false): Promise<Array<{ id: string; name: string; position: number }>> {
  if (DIVISION_GUILD_ID === DPS_GUILD_ID) return getDpsGuildRoles(refresh);
  return getDiscordGuildRoles(DIVISION_GUILD_ID, { refresh });
}

// Auto-assign a callsign to a member based on their rank's callsign configuration.
async function autoAssignCallsign(rankName: string, profileId: number): Promise<string | null> {
  try {
    const res = await pool.query<{
      callsign_prefix: string | null; callsign_type: string | null;
      callsign_static: string | null; callsign_min: number | null; callsign_max: number | null;
    }>(`SELECT callsign_prefix, callsign_type, callsign_static, callsign_min, callsign_max
        FROM dps_ranks WHERE lower(name) = lower($1) LIMIT 1`, [rankName]);
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    const prefix = r.callsign_prefix?.trim() ?? '';
    const join = (suffix: string) => prefix ? `${prefix}-${suffix}` : suffix;

    if (r.callsign_type === 'custom') return null; // manual assignment only
    if (!r.callsign_type || r.callsign_type === 'static') {
      return r.callsign_static ? join(r.callsign_static) : null;
    }
    if (r.callsign_type === 'dynamic' && r.callsign_min !== null && r.callsign_max !== null) {
      const used = await pool.query<{ callsign: string }>(
        `SELECT callsign FROM dps_users WHERE dps_rank = $1 AND profile_id != $2`, [rankName, profileId]
      );
      const usedNums = new Set<number>();
      for (const row of used.rows) {
        const parts = row.callsign.split('-');
        const n = parseInt(parts[parts.length - 1], 10);
        if (!isNaN(n)) usedNums.add(n);
      }
      const padLen = Math.max(String(r.callsign_max).length, 2);
      for (let n = r.callsign_min; n <= r.callsign_max; n++) {
        if (!usedNums.has(n)) return join(String(n).padStart(padLen, '0'));
      }
      return null; // range exhausted
    }
  } catch { /* non-fatal */ }
  return null;
}

const DPS_MEMBERS_TTL_MS = 5 * 60 * 1000; // 5 min — used by Add Officer typeahead
let _dpsMembersFetchRunning: Promise<DpsMemberCacheEntry[]> | null = null;

type DpsGuildMember = { user: { id: string; username: string; avatar?: string | null }; nick?: string | null; roles: string[] };

/** Paginate DPS guild (1469131277612486791) and refresh the in-memory member cache. */
async function fetchDpsGuildMembers(): Promise<DpsGuildMember[]> {
  const tok = process.env.DISCORD_BOT_TOKEN;
  if (!tok) throw new Error("No DISCORD_BOT_TOKEN configured");

  let allMembers: DpsGuildMember[] = [];
  let after = "0";
  for (;;) {
    const url = `https://discord.com/api/v10/guilds/${DPS_GUILD_ID}/members?limit=1000${after !== "0" ? `&after=${after}` : ""}`;
    const r = await dpsDiscordFetch(url);
    if (!r.ok) throw new Error(`DPS members fetch failed: ${r.status}`);
    const batch = (await r.json()) as DpsGuildMember[];
    if (batch.length === 0) break;
    allMembers = allMembers.concat(batch);
    if (batch.length < 1000) break;
    after = batch[batch.length - 1].user.id;
  }

  dpsMembersCache.members = allMembers.map(m => ({
    id: m.user.id,
    username: m.user.username,
    nick: m.nick ?? null,
  }));
  dpsMembersCache.fetchedAt = Date.now();
  return allMembers;
}

/** Paginate the division guild when it differs from the main DPS guild. */
async function fetchDivisionGuildMembers(): Promise<DpsGuildMember[]> {
  if (DIVISION_GUILD_ID === DPS_GUILD_ID) return fetchDpsGuildMembers();

  const tok = process.env.DISCORD_BOT_TOKEN;
  if (!tok) throw new Error("No DISCORD_BOT_TOKEN configured");

  let allMembers: DpsGuildMember[] = [];
  let after = "0";
  for (;;) {
    const url = `https://discord.com/api/v10/guilds/${DIVISION_GUILD_ID}/members?limit=1000${after !== "0" ? `&after=${after}` : ""}`;
    const r = await dpsDiscordFetch(url);
    if (!r.ok) throw new Error(`Division members fetch failed: ${r.status}`);
    const batch = (await r.json()) as DpsGuildMember[];
    if (batch.length === 0) break;
    allMembers = allMembers.concat(batch);
    if (batch.length < 1000) break;
    after = batch[batch.length - 1].user.id;
  }
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

/** Ensure the DPS guild member cache is warm (for Add Officer search). */
async function ensureDpsMembersCache(force = false): Promise<DpsMemberCacheEntry[]> {
  const fresh =
    !force &&
    dpsMembersCache.members.length > 0 &&
    Date.now() - dpsMembersCache.fetchedAt < DPS_MEMBERS_TTL_MS;
  if (fresh) return dpsMembersCache.members;

  if (!_dpsMembersFetchRunning) {
    _dpsMembersFetchRunning = fetchDpsGuildMembers()
      .then(() => dpsMembersCache.members)
      .finally(() => { _dpsMembersFetchRunning = null; });
  }
  return _dpsMembersFetchRunning;
}

async function ensureCadProfileForDiscordMember(
  m: { user: { id: string; username: string; avatar?: string | null }; nick?: string | null },
): Promise<number> {
  const avatar = m.user.avatar?.trim() ?? "";
  let p = await pool.query<{ id: number; discord_id: string | null }>(
    `SELECT id, discord_id FROM cad_user_profiles WHERE discord_id = $1 LIMIT 1`,
    [m.user.id],
  );
  if (p.rows.length === 0 && m.user.username) {
    p = await pool.query<{ id: number; discord_id: string | null }>(
      `SELECT id, discord_id FROM cad_user_profiles
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
    return profileId;
  }

  const displayName = m.nick ?? m.user.username;
  const placeholderEmail = `discord_${m.user.id}@placeholder.dojcad`;
  try {
    // Plain INSERT — SQLite's partial unique index on discord_id does not support
    // Postgres-style ON CONFLICT (discord_id) WHERE … from this path.
    const created = await pool.query<{ id: number }>(
      `INSERT INTO cad_user_profiles
         (auth_user_id, username, email, discord_username, discord_id, avatar_hash,
          community_code, rank, role, password_salt, password_hash, whitelisted, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'DISCORD', 'Member', 'Community Members', '', '', false, NOW(), NOW())
       RETURNING id`,
      [`discord-${m.user.id}`, displayName, placeholderEmail, m.user.username, m.user.id, avatar],
    );
    return created.rows[0].id;
  } catch {
    const again = await pool.query<{ id: number }>(
      `SELECT id FROM cad_user_profiles WHERE discord_id = $1 OR email = $2 LIMIT 1`,
      [m.user.id, placeholderEmail],
    );
    if (again.rows.length > 0) return again.rows[0].id;
    throw new Error(`Unable to create CAD profile for Discord user ${m.user.id}`);
  }
}

async function syncDpsDiscordRoles(preloadedMembers?: DpsGuildMember[]): Promise<{ assigned: number; skipped: number; removed: number; errors: string[] }> {
  const tok = process.env.DISCORD_BOT_TOKEN;
  if (!tok) return { assigned: 0, skipped: 0, removed: 0, errors: ["No DISCORD_BOT_TOKEN configured"] };
  try {
    // 1. Always refresh DPS guild members first (needed for Add Officer search even
    //    when no ranks are Discord-linked yet).
    const allMembers = preloadedMembers ?? await fetchDpsGuildMembers();
    // Keep roster avatars in sync with Discord for every CAD profile we can match.
    if (!preloadedMembers) {
      await refreshCadAvatarsFromGuildMembers(allMembers);
    }

    // 2. Get all DPS ranks linked to a Discord role
    const ranksRes = await pool.query<{ name: string; discord_role_id: string; group_id: number | null; sort_order: number }>(
      `SELECT name, discord_role_id, group_id, sort_order FROM dps_ranks WHERE discord_role_id IS NOT NULL AND discord_role_id != ''`
    );
    if (ranksRes.rows.length === 0) return { assigned: 0, skipped: 0, removed: 0, errors: [] };

    const groupsRes = await pool.query<{ id: number; name: string; sort_order: number }>(
      `SELECT id, name, sort_order FROM dps_rank_groups`,
    );
    const groupNameById = new Map(groupsRes.rows.map(g => [g.id, g.name]));
    const groupSortById = new Map(groupsRes.rows.map(g => [g.id, Number(g.sort_order ?? 999_999)]));
    const rankMap = buildLinkedRankByRoleId(ranksRes.rows, groupSortById, groupNameById);
    const linkedRoleIds = [...rankMap.keys()];

    // 3. Assign DPS ranks to matching CAD profiles
    let assigned = 0; let skipped = 0; let removed = 0; const errors: string[] = [];

    // Track which Discord IDs currently hold any linked role (used for removal step)
    const activeDiscordIds = new Set<string>();

    for (const m of allMembers) {
      // Prefer the highest hierarchy match (group order, then rank order) when several match.
      const matchingRids = m.roles.filter(r => linkedRoleIds.includes(r));
      if (matchingRids.length === 0) continue;
      const rid = pickHighestLinkedDiscordRole(matchingRids, rankMap);
      if (!rid) continue;
      activeDiscordIds.add(m.user.id);
      const { rankName, groupName } = rankMap.get(rid)!;
      try {
        const profileId = await ensureCadProfileForDiscordMember(m);

        const displayName = m.nick ?? m.user.username;
        const existing = await pool.query<{ dps_rank: string | null; dps_role: string | null; username: string | null }>(
          `SELECT dps_rank, dps_role, username FROM dps_users WHERE profile_id = $1 LIMIT 1`,
          [profileId]
        );
        const isNewRosterMember = existing.rows.length === 0;
        if (
          existing.rows.length > 0
          && existing.rows[0].dps_rank === rankName
          && (existing.rows[0].dps_role ?? null) === (groupName ?? null)
          && existing.rows[0].username === displayName
        ) {
          skipped++;
          continue;
        }

        // Upsert the dps_users row with the new rank/role + auto-assign callsign
        const newCallsign = await autoAssignCallsign(rankName, profileId);
        if (newCallsign) {
          await pool.query(
            `INSERT INTO dps_users (profile_id, username, dps_rank, dps_role, callsign, status)
             VALUES ($1, $2, $3, $4, $5, 'Active')
             ON CONFLICT (profile_id) DO UPDATE SET
               username   = EXCLUDED.username,
               dps_rank   = EXCLUDED.dps_rank,
               dps_role   = EXCLUDED.dps_role,
               callsign   = EXCLUDED.callsign,
               status     = COALESCE(dps_users.status, 'Active'),
               updated_at = NOW()`,
            [profileId, displayName, rankName, groupName, newCallsign]
          );
        } else {
          await pool.query(
            `INSERT INTO dps_users (profile_id, username, dps_rank, dps_role, status)
             VALUES ($1, $2, $3, $4, 'Active')
             ON CONFLICT (profile_id) DO UPDATE SET
               username   = EXCLUDED.username,
               dps_rank   = EXCLUDED.dps_rank,
               dps_role   = EXCLUDED.dps_role,
               status     = COALESCE(dps_users.status, 'Active'),
               updated_at = NOW()`,
            [profileId, displayName, rankName, groupName]
          );
        }
        // Also mirror onto cad_user_profiles for convenience
        await pool.query(
          `UPDATE cad_user_profiles
           SET dps_rank = $2, dps_role = $3${newCallsign ? ', callsign = $4' : ''}
           WHERE id = $1`,
          newCallsign ? [profileId, rankName, groupName, newCallsign] : [profileId, rankName, groupName]
        );
        if (isNewRosterMember) {
          await resetDpsMemberPermissionGrants(pool, profileId);
        }
        assigned++;
      } catch (e) { errors.push(`discord_id ${m.user.id}: ${String(e)}`); }
    }

    // 4. Remove ranks from members whose linked Discord role was taken away
    // Find all dps_users rows whose rank is tied to a Discord role
    const linkedRankNames = ranksRes.rows.map(r => r.name);
    const linkedRes = linkedRankNames.length === 0
      ? { rows: [] as Array<{ profile_id: number; discord_id: string | null; discord_username: string | null; dps_rank: string }> }
      : await pool.query<{
          profile_id: number; discord_id: string | null; discord_username: string | null; dps_rank: string;
        }>(
          `SELECT u.profile_id, p.discord_id, p.discord_username, u.dps_rank
           FROM dps_users u
           JOIN cad_user_profiles p ON p.id = u.profile_id
           WHERE u.dps_rank = ANY($1::text[])`,
          [linkedRankNames],
        );

    // Build a quick lookup: discordUsername → is active (for username-matched profiles)
    const activeByUsername = new Set<string>(
      allMembers
        .filter(m => m.roles.some(r => linkedRoleIds.includes(r)))
        .map(m => m.user.username.toLowerCase())
    );

    for (const row of linkedRes.rows) {
      const stillHasRole =
        (row.discord_id != null && activeDiscordIds.has(row.discord_id)) ||
        (row.discord_id == null && row.discord_username != null &&
          activeByUsername.has(row.discord_username.toLowerCase()));

      if (!stillHasRole) {
        try {
          await pool.query(`DELETE FROM dps_user_divisions WHERE profile_id = $1`, [row.profile_id]);
          await pool.query(`DELETE FROM dps_users WHERE profile_id = $1`, [row.profile_id]);
          await pool.query(
            `UPDATE cad_user_profiles SET dps_rank = NULL, dps_role = NULL, callsign = NULL WHERE id = $1`,
            [row.profile_id]
          );
          removed++;
        } catch (e) { errors.push(`remove profile_id ${row.profile_id}: ${String(e)}`); }
      }
    }

    await writeLog("dps_personnel", "System", "Discord role sync completed",
      `assigned=${assigned} skipped=${skipped} removed=${removed} errors=${errors.length}`);
    console.info(`[dps-sync] assigned=${assigned} skipped=${skipped} removed=${removed} errors=${errors.length}`);
    return { assigned, skipped, removed, errors };
  } catch (e) {
    console.error("[dps-sync] Error:", e);
    return { assigned: 0, skipped: 0, removed: 0, errors: [String(e)] };
  }
}

/**
 * Sync Division Roster assignments from Discord roles on the DPS guild.
 *
 * Membership gate: when a division has discord_role_id, the member must hold
 * that role to stay on the division roster (manual adds are preserved).
 * Rank placement: linked division-rank roles pick the highest hierarchy match;
 * if they only have the division membership role, they get the junior-most rank.
 */
async function syncDivisionDiscordRoles(
  preloadedMembers?: DpsGuildMember[],
): Promise<{ assigned: number; skipped: number; removed: number; errors: string[] }> {
  const tok = process.env.DISCORD_BOT_TOKEN;
  if (!tok) return { assigned: 0, skipped: 0, removed: 0, errors: ["No DISCORD_BOT_TOKEN configured"] };

  try {
    const allMembers = (
      preloadedMembers && DIVISION_GUILD_ID === DPS_GUILD_ID
    ) ? preloadedMembers : await fetchDivisionGuildMembers();

    const membershipDivs = await pool.query<{ id: number; discord_role_id: string }>(
      `SELECT id, discord_role_id FROM dps_divisions
       WHERE discord_role_id IS NOT NULL AND discord_role_id != ''`
    );
    const membershipRoleByDiv = new Map<number, string>();
    for (const d of membershipDivs.rows) membershipRoleByDiv.set(d.id, d.discord_role_id);
    const membershipDivIds = new Set(membershipRoleByDiv.keys());

    const rankLinks = await pool.query<{
      division_id: number; name: string; sort_order: number; discord_role_id: string;
    }>(
      `SELECT division_id, name, sort_order, discord_role_id
       FROM dps_division_ranks
       WHERE discord_role_id IS NOT NULL AND discord_role_id != '' AND division_id IS NOT NULL`
    );

    const defaultRankByDiv = new Map<number, { name: string; sort_order: number }>();
    const allDivRanks = await pool.query<{ division_id: number; name: string; sort_order: number }>(
      `SELECT division_id, name, sort_order FROM dps_division_ranks
       WHERE division_id IS NOT NULL ORDER BY sort_order DESC, id DESC`
    );
    for (const r of allDivRanks.rows) {
      // First row per division (DESC sort_order) = junior-most fallback rank
      if (!defaultRankByDiv.has(r.division_id)) {
        defaultRankByDiv.set(r.division_id, { name: r.name, sort_order: r.sort_order });
      }
    }

    if (rankLinks.rows.length === 0 && membershipDivIds.size === 0) {
      return { assigned: 0, skipped: 0, removed: 0, errors: [] };
    }

    const rankByRole = new Map<string, { division_id: number; division_rank: string; sort_order: number }>();
    for (const r of rankLinks.rows) {
      const sortOrder = Number(r.sort_order ?? 999_999);
      const existing = rankByRole.get(r.discord_role_id);
      if (!existing || sortOrder < existing.sort_order) {
        rankByRole.set(r.discord_role_id, {
          division_id: r.division_id,
          division_rank: r.name,
          sort_order: sortOrder,
        });
      }
    }

    const linkedRankNames = new Set(rankLinks.rows.map(r => r.name.toLowerCase()));
    const linkedDivisionIds = new Set<number>([
      ...rankLinks.rows.map(r => r.division_id),
      ...membershipDivIds,
    ]);

    const desiredFromRoles = (roles: string[]) => {
      const roleSet = new Set(roles);
      const desiredByDiv = new Map<number, { division_id: number; division_rank: string; sort_order: number }>();

      for (const roleId of roles) {
        const rankHit = rankByRole.get(roleId);
        if (!rankHit) continue;
        const membershipRole = membershipRoleByDiv.get(rankHit.division_id);
        // If the division has a membership role, require it in addition to the rank role
        if (membershipRole && !roleSet.has(membershipRole)) continue;
        const cur = desiredByDiv.get(rankHit.division_id);
        if (!cur || rankHit.sort_order < cur.sort_order) {
          desiredByDiv.set(rankHit.division_id, rankHit);
        }
      }

      // Division membership role alone → junior-most rank
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

    const desiredByDiscordId = new Map<string, Map<number, { division_id: number; division_rank: string; sort_order: number }>>();
    const desiredByUsername = new Map<string, Map<number, { division_id: number; division_rank: string; sort_order: number }>>();
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
      desiredByDiv: Map<number, { division_id: number; division_rank: string; sort_order: number }>,
    ) => {
      if (processedProfiles.has(profileId)) return;
      processedProfiles.add(profileId);

      if (displayName) {
        const isNewRosterMember = !(await dpsRosterRowExists(pool, profileId));
        await pool.query(
          `INSERT INTO dps_users (profile_id, username, status)
           VALUES ($1, $2, 'Active')
           ON CONFLICT (profile_id) DO UPDATE SET
             username = COALESCE(EXCLUDED.username, dps_users.username),
             status = COALESCE(dps_users.status, 'Active'),
             updated_at = NOW()`,
          [profileId, displayName]
        );
        if (isNewRosterMember) {
          await resetDpsMemberPermissionGrants(pool, profileId);
        }
      }

      const existingMap = await loadDivisionAssignments([profileId]);
      const existing = existingMap.get(profileId) ?? [];
      const manual = existing
        .filter(a => a.is_manual)
        .map(a => ({ division_id: a.division_id, division_rank: a.division_rank, is_manual: true as const }));

      const fromDiscord = [...desiredByDiv.values()].map(a => ({
        division_id: a.division_id,
        division_rank: a.division_rank,
        is_manual: false as const,
      }));

      const mergedMap = new Map<number, { division_id: number; division_rank: string; is_manual: boolean }>();
      for (const a of manual) mergedMap.set(a.division_id, a);
      for (const a of fromDiscord) {
        // Discord placement overwrites rank but keeps manual flag if they were manually added
        const prev = mergedMap.get(a.division_id);
        mergedMap.set(a.division_id, {
          ...a,
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

      const beforeKey = existing.map(a => `${a.division_id}:${a.division_rank}:${a.is_manual ? 1 : 0}`).sort().join("|");
      const afterKey = merged.map(a => `${a.division_id}:${a.division_rank}:${a.is_manual ? 1 : 0}`).sort().join("|");
      if (beforeKey === afterKey) {
        skipped++;
        return;
      }

      const removedHere = existing.filter(a => isManagedAssignment(a) && !desiredByDiv.has(a.division_id)).length;
      removed += removedHere;
      await setMemberDivisionAssignments(profileId, merged);
      if (fromDiscord.length > 0 || removedHere > 0) assigned++;
    };

    for (const m of allMembers) {
      const desired = desiredByDiscordId.get(m.user.id) ?? new Map();
      try {
        let profileId: number | null = null;
        if (desired.size > 0) {
          profileId = await ensureCadProfileForDiscordMember(m);
        } else {
          const found = await pool.query<{ id: number }>(
            `SELECT id FROM cad_user_profiles WHERE discord_id = $1 LIMIT 1`,
            [m.user.id]
          );
          profileId = found.rows[0]?.id ?? null;
          if (profileId == null) continue;
          const existingMap = await loadDivisionAssignments([profileId]);
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
       FROM dps_user_divisions ud
       JOIN cad_user_profiles p ON p.id = ud.profile_id
       WHERE ud.division_id = ANY($1)
          OR lower(ud.division_rank) = ANY($2)`,
      [[...linkedDivisionIds], [...linkedRankNames]]
    );

    for (const row of linkedAssignments.rows) {
      if (processedProfiles.has(row.profile_id)) continue;
      try {
        let desired = new Map<number, { division_id: number; division_rank: string; sort_order: number }>();
        if (row.discord_id && desiredByDiscordId.has(row.discord_id)) {
          desired = desiredByDiscordId.get(row.discord_id)!;
        } else if (row.discord_username && desiredByUsername.has(row.discord_username.toLowerCase())) {
          desired = desiredByUsername.get(row.discord_username.toLowerCase())!;
        } else {
          desired = new Map();
        }
        await applyForProfile(row.profile_id, null, desired);
      } catch (e) {
        errors.push(`remove profile_id ${row.profile_id}: ${String(e)}`);
      }
    }

    await writeLog("dps_personnel", "System", "Division Discord role sync completed",
      `assigned=${assigned} skipped=${skipped} removed=${removed} errors=${errors.length}`);
    console.info(`[division-sync] assigned=${assigned} skipped=${skipped} removed=${removed} errors=${errors.length}`);
    return { assigned, skipped, removed, errors };
  } catch (e) {
    console.error("[division-sync] Error:", e);
    return { assigned: 0, skipped: 0, removed: 0, errors: [String(e)] };
  }
}

// ── One-time migration: create dps_users, add username column, back-fill ──────
(async () => {
  if (isMongoStore()) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dps_users (
        id             serial PRIMARY KEY,
        profile_id     integer NOT NULL REFERENCES cad_user_profiles(id) ON DELETE CASCADE,
        username       text,
        dps_rank       text,
        dps_role       text,
        callsign       text NOT NULL DEFAULT '4D-XX',
        status         text NOT NULL DEFAULT 'Active',
        appointed_date date,
        pob            boolean NOT NULL DEFAULT false,
        iab            boolean NOT NULL DEFAULT false,
        hsu            boolean NOT NULL DEFAULT false,
        sru            boolean NOT NULL DEFAULT false,
        fou            boolean NOT NULL DEFAULT false,
        certifications text[] NOT NULL DEFAULT '{}',
        created_at     timestamptz NOT NULL DEFAULT NOW(),
        updated_at     timestamptz NOT NULL DEFAULT NOW(),
        UNIQUE (profile_id)
      )
    `);
    // Ensure username column exists for databases created before this migration
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dps_divisions (
        id              serial PRIMARY KEY,
        name            text NOT NULL,
        sort_order      integer NOT NULL DEFAULT 0,
        discord_role_id text,
        unit_key        text
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dps_division_ranks (
        id              serial PRIMARY KEY,
        division_id     integer REFERENCES dps_divisions(id) ON DELETE CASCADE,
        name            text NOT NULL,
        sort_order      integer NOT NULL DEFAULT 0,
        color_hex       text,
        insignia_url    text,
        discord_role_id text
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dps_user_divisions (
        id              serial PRIMARY KEY,
        profile_id      integer NOT NULL REFERENCES cad_user_profiles(id) ON DELETE CASCADE,
        division_id     integer NOT NULL REFERENCES dps_divisions(id) ON DELETE CASCADE,
        division_rank   text NOT NULL,
        is_manual       boolean NOT NULL DEFAULT false,
        can_edit_resources boolean NOT NULL DEFAULT false,
        can_edit_roster boolean NOT NULL DEFAULT false,
        can_edit_info boolean NOT NULL DEFAULT false,
        UNIQUE (profile_id, division_id)
      )
    `);
    await pool.query(`ALTER TABLE dps_user_divisions ADD COLUMN IF NOT EXISTS is_manual boolean NOT NULL DEFAULT false`);
    await pool.query(`ALTER TABLE dps_user_divisions ADD COLUMN IF NOT EXISTS can_edit_resources boolean NOT NULL DEFAULT false`);
    await pool.query(`ALTER TABLE dps_user_divisions ADD COLUMN IF NOT EXISTS can_edit_roster boolean NOT NULL DEFAULT false`);
    await pool.query(`ALTER TABLE dps_user_divisions ADD COLUMN IF NOT EXISTS can_edit_info boolean NOT NULL DEFAULT false`);
    await pool.query(`ALTER TABLE dps_divisions ADD COLUMN IF NOT EXISTS discord_role_id text`);
    await pool.query(`ALTER TABLE dps_divisions ADD COLUMN IF NOT EXISTS unit_key text`);
    await pool.query(`ALTER TABLE dps_divisions ADD COLUMN IF NOT EXISTS info_content text NOT NULL DEFAULT '{"sections":[]}'`);
    await pool.query(`ALTER TABLE dps_division_ranks ADD COLUMN IF NOT EXISTS discord_role_id text`);
    await pool.query(`ALTER TABLE dps_division_ranks ADD COLUMN IF NOT EXISTS callsign_prefix text`);
    await pool.query(`ALTER TABLE dps_division_ranks ADD COLUMN IF NOT EXISTS callsign_type text`);
    await pool.query(`ALTER TABLE dps_division_ranks ADD COLUMN IF NOT EXISTS callsign_static text`);
    await pool.query(`ALTER TABLE dps_division_ranks ADD COLUMN IF NOT EXISTS callsign_min integer`);
    await pool.query(`ALTER TABLE dps_division_ranks ADD COLUMN IF NOT EXISTS callsign_max integer`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dps_division_rank_custom_callsigns (
        id                  serial PRIMARY KEY,
        division_rank_id    integer NOT NULL REFERENCES dps_division_ranks(id) ON DELETE CASCADE,
        callsign            text NOT NULL,
        assigned_profile_id integer REFERENCES cad_user_profiles(id) ON DELETE SET NULL,
        sort_order          integer NOT NULL DEFAULT 0,
        created_at          timestamptz NOT NULL DEFAULT NOW()
      )
    `);
    // Backfill personnel unit keys for known division names
    for (const [needle, key] of [
      ["patrol", "pob"],
      ["internal affairs", "iab"],
      ["high speed", "hsu"],
      ["special response", "sru"],
      ["field operations", "fou"],
    ] as const) {
      await pool.query(
        `UPDATE dps_divisions SET unit_key = $1
         WHERE unit_key IS NULL AND lower(name) LIKE $2`,
        [key, `%${needle}%`]
      );
    }
    await migrateLegacyDivisionAssignments();
    await pool.query(`ALTER TABLE dps_users ADD COLUMN IF NOT EXISTS username text`);
    await pool.query(`ALTER TABLE dps_users ADD COLUMN IF NOT EXISTS division_rank text`);
    await pool.query(`ALTER TABLE dps_users ADD COLUMN IF NOT EXISTS can_view_all_resources boolean NOT NULL DEFAULT false`);
    await pool.query(`ALTER TABLE cad_user_profiles ADD COLUMN IF NOT EXISTS can_access_iab boolean NOT NULL DEFAULT false`);
    // Panel-access flag on rank groups (controls who sees the Department Panel button)
    await pool.query(`ALTER TABLE dps_rank_groups ADD COLUMN IF NOT EXISTS panel_access boolean NOT NULL DEFAULT false`);
    // Division oversight — title + ranks can view all division resources/rosters even when restricted
    await pool.query(`ALTER TABLE dps_rank_groups ADD COLUMN IF NOT EXISTS division_oversight boolean NOT NULL DEFAULT false`);
    // DPS titles/ranks are user-defined only — remove any legacy Executive Team title group.
    await pool.query(
      `DELETE FROM dps_ranks
       WHERE group_id IN (SELECT id FROM dps_rank_groups WHERE lower(name) = 'executive team')`,
    );
    await pool.query(`DELETE FROM dps_rank_groups WHERE lower(name) = 'executive team'`);
    await pool.query(`ALTER TABLE dps_ranks ADD COLUMN IF NOT EXISTS discord_role_id text`);
    await pool.query(`ALTER TABLE dps_ranks ADD COLUMN IF NOT EXISTS callsign_type text`);
    await pool.query(`ALTER TABLE dps_ranks ADD COLUMN IF NOT EXISTS callsign_static text`);
    await pool.query(`ALTER TABLE dps_ranks ADD COLUMN IF NOT EXISTS callsign_min integer`);
    await pool.query(`ALTER TABLE dps_ranks ADD COLUMN IF NOT EXISTS callsign_max integer`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dps_rank_custom_callsigns (
        id                  serial PRIMARY KEY,
        rank_id             integer NOT NULL REFERENCES dps_ranks(id) ON DELETE CASCADE,
        callsign            text NOT NULL,
        assigned_profile_id integer REFERENCES cad_user_profiles(id) ON DELETE SET NULL,
        created_at          timestamptz NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`ALTER TABLE dps_rank_custom_callsigns ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0`);
    // Image adjustment columns for fleet vehicles
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dps_fleet_categories (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dps_fleet (
        id SERIAL PRIMARY KEY,
        name TEXT,
        year TEXT,
        category TEXT NOT NULL DEFAULT 'General',
        category_sort INTEGER NOT NULL DEFAULT 0,
        image_url TEXT,
        image_scale REAL NOT NULL DEFAULT 1,
        image_position_x REAL NOT NULL DEFAULT 50,
        image_position_y REAL NOT NULL DEFAULT 50,
        who_can_drive TEXT NOT NULL DEFAULT '[]',
        restrict_to_divisions TEXT NOT NULL DEFAULT '[]',
        liveries TEXT NOT NULL DEFAULT '[]',
        notes TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0
      )
    `);
    await pool.query(`ALTER TABLE dps_fleet ADD COLUMN IF NOT EXISTS year TEXT`);
    await pool.query(`ALTER TABLE dps_fleet ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'General'`);
    await pool.query(`ALTER TABLE dps_fleet ADD COLUMN IF NOT EXISTS category_sort INTEGER NOT NULL DEFAULT 0`);
    await pool.query(`ALTER TABLE dps_fleet ADD COLUMN IF NOT EXISTS image_url TEXT`);
    await pool.query(`ALTER TABLE dps_fleet ADD COLUMN IF NOT EXISTS image_scale REAL NOT NULL DEFAULT 1`);
    await pool.query(`ALTER TABLE dps_fleet ADD COLUMN IF NOT EXISTS image_position_x REAL NOT NULL DEFAULT 50`);
    await pool.query(`ALTER TABLE dps_fleet ADD COLUMN IF NOT EXISTS image_position_y REAL NOT NULL DEFAULT 50`);
    await pool.query(`ALTER TABLE dps_fleet ADD COLUMN IF NOT EXISTS who_can_drive TEXT NOT NULL DEFAULT '[]'`);
    await pool.query(`ALTER TABLE dps_fleet ADD COLUMN IF NOT EXISTS restrict_to_divisions TEXT NOT NULL DEFAULT '[]'`);
    await pool.query(`ALTER TABLE dps_fleet ADD COLUMN IF NOT EXISTS liveries TEXT NOT NULL DEFAULT '[]'`);
    await pool.query(`ALTER TABLE dps_fleet ADD COLUMN IF NOT EXISTS notes TEXT`);
    await pool.query(`ALTER TABLE dps_fleet ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0`);

    // Equipment roster tables
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dps_equipment_categories (
        id         SERIAL PRIMARY KEY,
        name       TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dps_equipment (
        id                   SERIAL PRIMARY KEY,
        name                 TEXT NOT NULL,
        quantity             TEXT,
        category             TEXT NOT NULL DEFAULT 'General',
        category_sort        INTEGER NOT NULL DEFAULT 0,
        image_url            TEXT,
        who_can_use          TEXT[] NOT NULL DEFAULT '{}',
        restrict_to_divisions TEXT[] NOT NULL DEFAULT '{}',
        notes                TEXT,
        sort_order           INTEGER NOT NULL DEFAULT 0
      )
    `);
    // Image adjustment columns for equipment
    await pool.query(`ALTER TABLE dps_equipment ADD COLUMN IF NOT EXISTS image_scale REAL NOT NULL DEFAULT 1`);
    await pool.query(`ALTER TABLE dps_equipment ADD COLUMN IF NOT EXISTS image_position_x REAL NOT NULL DEFAULT 50`);
    await pool.query(`ALTER TABLE dps_equipment ADD COLUMN IF NOT EXISTS image_position_y REAL NOT NULL DEFAULT 50`);

    // Department event calendar
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dps_events (
        id          SERIAL PRIMARY KEY,
        title       TEXT NOT NULL,
        event_date  DATE NOT NULL,
        event_time  TEXT,
        location    TEXT,
        purpose     TEXT,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`ALTER TABLE dps_events ADD COLUMN IF NOT EXISTS is_public boolean NOT NULL DEFAULT false`);
    await pool.query(`ALTER TABLE dps_events ADD COLUMN IF NOT EXISTS hosted_by TEXT`);
    await pool.query(`ALTER TABLE dps_events ADD COLUMN IF NOT EXISTS hosting_department TEXT`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dps_content (
        key     TEXT PRIMARY KEY,
        content JSONB NOT NULL DEFAULT '{}'
      )
    `);

    // Back-fill DPS personnel from cad_user_profiles (idempotent).
    // NOTE: table alias on the source is required — without it Postgres treats
    // bare column names as references to the INSERT target when they share names.
    try {
      await pool.query(`
        INSERT INTO dps_users
          (profile_id, username, dps_rank, dps_role, callsign, status, appointed_date,
           pob, iab, hsu, sru, fou, certifications)
        SELECT
          p.id,
          p.username,
          p.dps_rank,
          p.dps_role,
          COALESCE(p.callsign, '4D-XX'),
          COALESCE(p.status, 'Active'),
          p.appointed_date,
          COALESCE(p.pob, false),
          COALESCE(p.iab, false),
          COALESCE(p.hsu, false),
          COALESCE(p.sru, false),
          COALESCE(p.fou, false),
          COALESCE(p.certifications, '{}')
        FROM cad_user_profiles p
        WHERE p.dps_rank IS NOT NULL
        ON CONFLICT (profile_id) DO UPDATE SET
          username = EXCLUDED.username
      `);
    } catch (backfillErr) {
      console.warn("dps_users back-fill skipped (columns may not exist yet):", backfillErr);
    }
  } catch (e) {
    console.error("dps_users migration failed:", e);
  }
})();

// ── Background sync: assign DPS ranks based on linked Discord roles ───────────
// Guard prevents overlapping runs. Interval is intentionally minutes (not seconds):
// each cycle paginates the full Discord guild and writes to SQLite synchronously,
// which otherwise starves every API request on the shared event loop.
const DPS_SYNC_INTERVAL_MS = Math.max(
  10_000,
  Number(process.env.DPS_SYNC_INTERVAL_MS) || 60_000,
);
let _dpsSyncRunning = false;
async function guardedDpsSync() {
  if (_dpsSyncRunning) return;
  _dpsSyncRunning = true;
  try {
    const members = await fetchDpsGuildMembers();
    await refreshCadAvatarsFromGuildMembers(members);
    await syncDpsDiscordRoles(members);
    await syncDivisionDiscordRoles(members);
  } catch (e) { console.error("[dps-sync]", e); }
  finally { _dpsSyncRunning = false; }
}
setTimeout(() => {
  void guardedDpsSync();
  setInterval(() => void guardedDpsSync(), DPS_SYNC_INTERVAL_MS);
}, 45_000);

registerDiscordGuildSync(DPS_GUILD_ID, "dps-personnel", async () => {
  const members = await fetchDpsGuildMembers();
  await refreshCadAvatarsFromGuildMembers(members);
  await syncDpsDiscordRoles(members);
});
registerDiscordGuildSync(DPS_GUILD_ID, "dps-division", async () => {
  const members = await fetchDpsGuildMembers();
  await syncDivisionDiscordRoles(
    DIVISION_GUILD_ID === DPS_GUILD_ID ? members : undefined,
  );
});
if (DIVISION_GUILD_ID !== DPS_GUILD_ID) {
  registerDiscordGuildSync(DIVISION_GUILD_ID, "dps-division-guild", async () => {
    await syncDivisionDiscordRoles();
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const rankOrderSubquery = `
  COALESCE(
    (SELECT sort_order FROM dps_ranks WHERE lower(name) = lower(d.dps_rank)),
    999
  )
`;

function formatDpsPersonnelRows(
  rows: Record<string, unknown>[],
  assignmentMap: Map<number, DivisionAssignment[]>,
) {
  const sortedRows = sortDepartmentPersonnel(
    rows,
    (row) => Number(row.group_sort_order ?? 999),
    (row) => Number(row.rank_sort_order ?? 999),
    (row) => (row.callsign as string | null | undefined) ?? null,
    (row) => String(row.username ?? ""),
  );
  const seenIds = new Set<number>();
  const uniqueRows = sortedRows.filter((row) => {
    const id = Number(row.id);
    if (seenIds.has(id)) return false;
    seenIds.add(id);
    return true;
  });
  return uniqueRows.map((row) => {
    const id = Number(row.id);
    const assignments = assignmentMap.get(id) ?? [];
    const primary = assignments[0];
    return {
      ...row,
      can_view_all_resources: Boolean(row.can_view_all_resources),
      can_access_iab: Boolean(row.can_access_iab),
      division_assignments: assignments,
      division_rank: primary?.division_rank ?? row.division_rank ?? null,
      division_name: primary?.division_name ?? row.division_name ?? null,
      division_names: assignments.map(a => a.division_name),
    };
  });
}

async function loadDpsPersonnelViaMongo(includeAll: boolean): Promise<Record<string, unknown>[]> {
  const rows = await listDpsPersonnelMongo(includeAll);
  const ids = rows.map(r => Number(r.id));
  let assignmentMap = new Map<number, DivisionAssignment[]>();
  try {
    assignmentMap = await loadDivisionAssignments(ids);
  } catch {
    assignmentMap = new Map();
  }
  return formatDpsPersonnelRows(rows, assignmentMap);
}

async function loadDpsPersonnelViaMongoWithRetry(includeAll: boolean): Promise<Record<string, unknown>[]> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await loadDpsPersonnelViaMongo(includeAll);
    } catch (err) {
      lastErr = err;
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
      }
    }
  }
  throw lastErr;
}

// ── GET personnel (pass ?all=1 to include inactive) ───────────────────────────
// Only users with a dps_users row are department personnel.
router.get("/roster", async (req, res) => {
  try {
    const includeAll = req.query.all === "1";

    if (isMongoStore()) {
      try {
        res.json(await loadDpsPersonnelViaMongoWithRetry(includeAll));
        return;
      } catch (mongoErr) {
        req.log.error({ err: mongoErr }, "roster GET native Mongo failed");
        res.status(500).json({ error: "Unable to load roster." });
        return;
      }
    }

    const where = includeAll ? "" : "WHERE lower(d.status) != 'inactive'";
    const orderBy = `ORDER BY COALESCE(rg.sort_order, 999), ${rankOrderSubquery},
                d.callsign,
                COALESCE(d.username, p.username)`;
    try {
      const result = await pool.query(
        `SELECT p.id, COALESCE(d.username, p.username) AS username,
                p.discord_username, p.discord_id, p.avatar_hash,
                d.callsign, d.dps_rank, d.dps_role, d.division_rank, d.status, d.appointed_date,
                d.pob, d.iab, d.hsu, d.sru, d.fou, d.certifications,
                COALESCE(d.can_view_all_resources, false) AS can_view_all_resources,
                COALESCE(p.can_access_iab, false) AS can_access_iab,
                p.staff_role,
                CASE
                  WHEN rg.name IS NOT NULL AND lower(rg.name) != 'community members' THEN rg.name
                  ELSE NULL
                END AS group_name,
                COALESCE(rg.sort_order, 999)  AS group_sort_order,
                COALESCE(dr.sort_order, 999)  AS rank_sort_order
         FROM cad_user_profiles p
         JOIN dps_users d ON d.profile_id = p.id
         LEFT JOIN dps_ranks dr ON lower(dr.name) = lower(d.dps_rank)
         LEFT JOIN dps_rank_groups rg ON dr.group_id = rg.id
         ${where}
         ${orderBy}`
      );
      const ids = result.rows.map((r: { id: number }) => r.id);
      let assignmentMap = new Map<number, DivisionAssignment[]>();
      try {
        assignmentMap = await loadDivisionAssignments(ids);
      } catch (assignErr) {
        req.log.warn({ err: assignErr }, "roster GET division assignments load failed");
      }
      res.json(formatDpsPersonnelRows(result.rows as Record<string, unknown>[], assignmentMap));
    } catch (joinErr) {
      // Fallback if division tables/columns are missing on an older DB
      req.log.warn({ err: joinErr }, "roster GET division join failed — falling back");
      const result = await pool.query(
        `SELECT p.id, COALESCE(d.username, p.username) AS username,
                p.discord_username, p.discord_id, p.avatar_hash,
                d.callsign, d.dps_rank, d.dps_role, d.status, d.appointed_date,
                d.pob, d.iab, d.hsu, d.sru, d.fou, d.certifications,
                COALESCE(d.can_view_all_resources, false) AS can_view_all_resources,
                COALESCE(p.can_access_iab, false) AS can_access_iab,
                p.staff_role,
                CASE
                  WHEN rg.name IS NOT NULL AND lower(rg.name) != 'community members' THEN rg.name
                  ELSE NULL
                END AS group_name,
                COALESCE(rg.sort_order, 999)  AS group_sort_order,
                NULL AS division_name,
                999 AS division_sort_order,
                NULL AS division_rank
         FROM cad_user_profiles p
         JOIN dps_users d ON d.profile_id = p.id
         LEFT JOIN dps_ranks dr ON lower(dr.name) = lower(d.dps_rank)
         LEFT JOIN dps_rank_groups rg ON dr.group_id = rg.id
         ${where}
         ${orderBy}`
      );
      res.json(result.rows.map((row: Record<string, unknown>) => ({
        ...row,
        can_view_all_resources: Boolean(row.can_view_all_resources),
        can_access_iab: Boolean(row.can_access_iab),
      })));
    }
  } catch (err) {
    req.log.error({ err }, "roster GET error");
    res.status(500).json({ error: "Unable to load roster." });
  }
});

// ── POST /roster/:id/permissions/clear — revoke Access Permissions for one member ─
router.post("/roster/:id/permissions/clear", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid id." }); return; }
  try {
    const exists = await dpsRosterRowExists(pool, id);
    if (!exists) { res.status(404).json({ error: "Member not found." }); return; }
    await resetDpsMemberAccessPermissions(pool, id);
    const actor = (req.body as Record<string, unknown>).actor as string
      || (req.headers["x-actor"] as string)
      || "Admin";
    await writeLog(
      "dps_personnel",
      actor,
      "Cleared access permissions",
      `Profile id: ${id}`,
    );
    res.json({ ok: true, id, can_view_all_resources: false, can_access_iab: false });
  } catch (err) {
    req.log.error({ err }, "roster permissions clear error");
    res.status(500).json({ error: "Unable to clear access permissions." });
  }
});

// ── POST /roster/permissions/clear-all — revoke all individual permission grants ─
router.post("/roster/permissions/clear-all", async (req, res) => {
  try {
    const counts = await clearAllDpsPermissionGrants(pool);
    const actor = (req.body as Record<string, unknown>).actor as string
      || (req.headers["x-actor"] as string)
      || "Admin";
    await writeLog(
      "dps_personnel",
      actor,
      "Cleared all individual permission grants",
      `resources=${counts.resources} iab=${counts.iab} divisionEditors=${counts.divisionEditors} titleGroups=${counts.titleGroups}`,
    );
    res.json({ ok: true, ...counts });
  } catch (err) {
    req.log.error({ err }, "roster permissions clear-all error");
    res.status(500).json({ error: "Unable to clear permission grants." });
  }
});

// ── PATCH /roster/:id/resource-access — toggle view-all-normal-resources ──────
router.patch("/roster/:id/resource-access", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid id." }); return; }
  const { can_view_all_resources } = req.body as { can_view_all_resources?: boolean };
  if (typeof can_view_all_resources !== "boolean") {
    res.status(400).json({ error: "can_view_all_resources (boolean) is required." });
    return;
  }
  try {
    const result = await pool.query(
      `UPDATE dps_users
          SET can_view_all_resources = $2, updated_at = NOW()
        WHERE profile_id = $1
        RETURNING profile_id AS id, can_view_all_resources`,
      [id, can_view_all_resources],
    );
    if ((result.rowCount ?? 0) === 0) { res.status(404).json({ error: "Member not found." }); return; }
    const actor = (req.body as Record<string, unknown>).actor as string
      || (req.headers["x-actor"] as string)
      || "Admin";
    await writeLog(
      "dps_personnel",
      actor,
      can_view_all_resources ? "Granted view-all resources access" : "Revoked view-all resources access",
      `Profile id: ${id}`,
    );
    res.json({
      id,
      can_view_all_resources: Boolean(result.rows[0].can_view_all_resources),
    });
  } catch (err) {
    req.log.error({ err }, "roster resource-access PATCH error");
    res.status(500).json({ error: "Unable to update resource access." });
  }
});

// ── PATCH /roster/:id/iab-access — toggle DPS Internal Affairs portal access ──
router.patch("/roster/:id/iab-access", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid id." }); return; }
  const { can_access_iab } = req.body as { can_access_iab?: boolean };
  if (typeof can_access_iab !== "boolean") {
    res.status(400).json({ error: "can_access_iab (boolean) is required." });
    return;
  }
  try {
    const result = await pool.query(
      `UPDATE cad_user_profiles
          SET can_access_iab = $2, updated_at = NOW()
        WHERE id = $1
        RETURNING id, can_access_iab`,
      [id, can_access_iab],
    );
    if ((result.rowCount ?? 0) === 0) { res.status(404).json({ error: "Member not found." }); return; }
    const actor = (req.body as Record<string, unknown>).actor as string
      || (req.headers["x-actor"] as string)
      || "Admin";
    await writeLog(
      "dps_personnel",
      actor,
      can_access_iab ? "Granted DPS Internal Affairs access" : "Revoked DPS Internal Affairs access",
      `Profile id: ${id}`,
    );
    res.json({
      id,
      can_access_iab: Boolean(result.rows[0].can_access_iab),
    });
  } catch (err) {
    req.log.error({ err }, "roster iab-access PATCH error");
    res.status(500).json({ error: "Unable to update Internal Affairs access." });
  }
});

// ── GET /roster/member-search — typeahead limited to DPS guild members ────────
// Returns only members who are actually in the DPS Discord guild, cross-
// referenced against CAD profiles. Mirrors the staff /staff/member-search
// endpoint so officers can only be added from the correct server.
router.get("/roster/member-search", async (req, res) => {
  const q = String(req.query.q ?? "").trim().toLowerCase();
  if (q.length < 1) { res.json([]); return; }

  type SearchHit = {
    id: number | null; username: string; discord_username: string | null;
    discord_id: string | null; rank: string | null;
  };

  try {
    const cached = await ensureDpsMembersCache();
    const guildDiscordIds = cached.map(m => m.id);

    if (isMongoStore()) {
      const hits = await searchDpsMembersMongo(q, guildDiscordIds) as SearchHit[];
      const seenDiscordIds = new Set(hits.map(h => h.discord_id).filter(Boolean) as string[]);
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
          hits.push({
            id: null,
            username: m.nick ?? m.username,
            discord_username: m.username,
            discord_id: m.id,
            rank: null,
          });
        }
      }
      res.json(hits.slice(0, 20));
      return;
    }

    const hits: SearchHit[] = [];
    const seenDiscordIds = new Set<string>();

    // 1. CAD profiles whose discord_id is in the DPS guild
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
        hits.push({ id: row.id, username: row.username, discord_username: row.discord_username,
          discord_id: row.discord_id, rank: row.rank });
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
          discord_id: m.id, rank: null });
      }
    }

    res.json(hits.slice(0, 20));
  } catch (err) {
    req.log.error({ err }, "roster/member-search error");
    res.status(500).json({ error: "Search failed." });
  }
});

// ── GET /roster/users/search — same guild filter as member-search (legacy alias)
router.get("/roster/users/search", async (req, res) => {
  const q = String(req.query.q ?? "").trim().toLowerCase();
  if (!q) { res.json([]); return; }
  try {
    const cached = await ensureDpsMembersCache();
    const guildDiscordIds = cached.map(m => m.id);
    if (guildDiscordIds.length === 0) { res.json([]); return; }

    const result = await pool.query(
      `SELECT id, username, discord_username, discord_id, rank, avatar_hash
       FROM cad_user_profiles
       WHERE discord_id = ANY($1::text[])
         AND (username ILIKE $2 OR discord_username ILIKE $2 OR discord_id ILIKE $2)
       ORDER BY username
       LIMIT 8`,
      [guildDiscordIds, `%${q}%`]
    );
    res.json(result.rows);
  } catch (err) {
    req.log.error({ err }, "users/search GET error");
    res.status(500).json({ error: "Search failed." });
  }
});

// ── PATCH — update a member's DPS fields ─────────────────────────────────────
router.patch("/roster/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid id." }); return; }

  const { dps_rank, dps_role, division_rank, division_assignments, callsign, status, appointed_date, pob, iab, hsu, sru, fou, certifications } =
    req.body as Record<string, unknown>;

  // Coerce empty strings to null so Postgres date/array casts don't blow up
  const safeDate = (appointed_date && String(appointed_date).trim()) ? appointed_date : null;
  // Allow clearing division assignment with empty string
  const resolvedDivisionRank =
    division_rank === undefined ? undefined
      : (division_rank === null || String(division_rank).trim() === '') ? null
        : String(division_rank);

  const resolvedAssignments = Array.isArray(division_assignments)
    ? (division_assignments as Array<{ division_id?: number; division_rank?: string }>)
        .map(a => ({
          division_id: Number(a.division_id),
          division_rank: String(a.division_rank ?? "").trim(),
        }))
        .filter(a => Number.isInteger(a.division_id) && a.division_id > 0 && a.division_rank)
    : undefined;

  try {
    // ── Auto-assign callsign when the rank is changing ────────────────────────
    // If the rank is being changed, derive the callsign from the new rank's
    // configuration rather than trusting whatever the frontend sent (the frontend
    // doesn't know which numbers in a dynamic range are already taken).
    let resolvedCallsign: unknown = callsign ?? null;
    if (dps_rank) {
      const cur = await pool.query<{ dps_rank: string | null }>(
        `SELECT dps_rank FROM dps_users WHERE profile_id = $1 LIMIT 1`, [id]
      );
      const currentRank = cur.rows[0]?.dps_rank ?? null;
      if (String(dps_rank).toLowerCase() !== (currentRank ?? '').toLowerCase()) {
        const auto = await autoAssignCallsign(String(dps_rank), id);
        if (auto !== null) resolvedCallsign = auto;
      }
    }

    let previousDivisionRank: string | null = null;
    if (resolvedAssignments === undefined && resolvedDivisionRank !== undefined) {
      const prev = await pool.query<{ division_rank: string | null }>(
        `SELECT division_rank FROM dps_users WHERE profile_id = $1 LIMIT 1`,
        [id]
      );
      previousDivisionRank = prev.rows[0]?.division_rank ?? null;
    }

    const upd = await pool.query(
      `UPDATE dps_users SET
         dps_rank       = COALESCE($2, dps_rank),
         dps_role       = COALESCE($3, dps_role),
         callsign       = COALESCE($4, callsign),
         status         = COALESCE($5, status),
         appointed_date = COALESCE($6::date, appointed_date),
         pob            = COALESCE($7::boolean, pob),
         iab            = COALESCE($8::boolean, iab),
         hsu            = COALESCE($9::boolean, hsu),
         sru            = COALESCE($10::boolean, sru),
         fou            = COALESCE($11::boolean, fou),
         certifications = COALESCE($12::text[], certifications),
         division_rank  = CASE WHEN $13::boolean THEN $14 ELSE division_rank END,
         updated_at     = NOW()
       WHERE profile_id = $1`,
      [id, dps_rank ?? null, dps_role ?? null, resolvedCallsign,
       status ?? null, safeDate, pob ?? null, iab ?? null, hsu ?? null,
       sru ?? null, fou ?? null, certifications ?? null,
       // When using multi-assignments, setMemberDivisionAssignments owns division_rank
       resolvedAssignments === undefined && resolvedDivisionRank !== undefined,
       resolvedDivisionRank ?? null]
    );
    if ((upd.rowCount ?? 0) === 0) { res.status(404).json({ error: "Member not found." }); return; }

    let assignmentsOut: DivisionAssignment[] = [];
    if (resolvedAssignments !== undefined) {
      try {
        assignmentsOut = await setMemberDivisionAssignments(id, resolvedAssignments);
      } catch (syncErr) {
        req.log.error({ err: syncErr }, "multi-division assignment failed");
      }
    } else if (resolvedDivisionRank !== undefined) {
      // Legacy single-rank path: replace assignments with that one rank (or clear)
      try {
        if (resolvedDivisionRank === null) {
          assignmentsOut = await setMemberDivisionAssignments(id, []);
        } else {
          const rankMeta = await pool.query<{ division_id: number }>(
            `SELECT division_id FROM dps_division_ranks WHERE lower(name) = lower($1) LIMIT 1`,
            [resolvedDivisionRank]
          );
          if (rankMeta.rows[0]?.division_id) {
            // Keep other divisions; upsert this rank into its division
            const existing = await loadDivisionAssignments([id]);
            const current = existing.get(id) ?? [];
            const next = current
              .filter(a => a.division_id !== rankMeta.rows[0].division_id)
              .map(a => ({ division_id: a.division_id, division_rank: a.division_rank }));
            next.push({ division_id: rankMeta.rows[0].division_id, division_rank: resolvedDivisionRank });
            assignmentsOut = await setMemberDivisionAssignments(id, next);
          } else {
            await syncPersonnelUnitFromDivisionRank(id, previousDivisionRank, resolvedDivisionRank);
          }
        }
      } catch (syncErr) {
        req.log.error({ err: syncErr }, "division → personnel unit sync failed");
      }
    }

    const result = await pool.query(
      `SELECT p.id, COALESCE(u.username, p.username) AS username,
              p.discord_username, p.discord_id,
              u.callsign, u.dps_rank, u.dps_role, u.division_rank, u.status, u.appointed_date,
              u.pob, u.iab, u.hsu, u.sru, u.fou, u.certifications
       FROM dps_users u
       JOIN cad_user_profiles p ON p.id = u.profile_id
       WHERE u.profile_id = $1`,
      [id]
    );
    if (assignmentsOut.length === 0 && resolvedAssignments === undefined && resolvedDivisionRank === undefined) {
      const map = await loadDivisionAssignments([id]).catch(() => new Map());
      assignmentsOut = map.get(id) ?? [];
    }
    const actor = (req.body as Record<string, unknown>).actor as string || (req.headers['x-actor'] as string) || 'Admin';
    await writeLog('dps_personnel', actor, 'Updated officer record', `${result.rows[0].username} — rank: ${result.rows[0].dps_rank}`);
    res.json({
      ...result.rows[0],
      division_assignments: assignmentsOut,
      division_names: assignmentsOut.map(a => a.division_name),
      division_name: assignmentsOut[0]?.division_name ?? null,
      division_rank: assignmentsOut[0]?.division_rank ?? result.rows[0].division_rank ?? null,
    });
  } catch (err) {
    req.log.error({ err }, "roster PATCH error");
    res.status(500).json({ error: "Unable to update member." });
  }
});

// ── POST — add/promote an officer ────────────────────────────────────────────
// Upsert: if the username already exists (e.g. signed in via Discord) we
// add/update their dps_users row instead of rejecting.
// If they don't exist yet, a new manual cad_user_profiles account is created
// and a dps_users row is inserted for it.
router.post("/roster", async (req, res) => {
  const { username, discord_username = "", discord_id = "",
          dps_rank = "Unranked", dps_role = "", callsign = "4D-XX", status = "Active", appointed_date } =
    req.body as Record<string, string>;

  if (!username?.trim()) { res.status(400).json({ error: "Username is required." }); return; }

  try {
    const existing = await pool.query<{ id: number }>(
      `SELECT id FROM cad_user_profiles WHERE lower(username) = lower($1) LIMIT 1`,
      [username.trim()]
    );

    if ((existing.rowCount ?? 0) > 0) {
      const profileId = existing.rows[0].id;

      // Update discord info on the profile if supplied
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

      // Fetch canonical username from profile for storage in dps_users
      const profileRow = await pool.query<{ username: string }>(
        `SELECT username FROM cad_user_profiles WHERE id = $1`, [profileId]
      );
      const canonicalUsername = profileRow.rows[0]?.username ?? username.trim();

      const isNewRosterMember = !(await dpsRosterRowExists(pool, profileId));

      // Upsert the dps_users row (stores username directly).
      // Two-step (not INSERT…RETURNING CTE) so local SQLite works the same as Postgres.
      await pool.query(
        `INSERT INTO dps_users (profile_id, username, dps_rank, dps_role, callsign, status, appointed_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7::date)
         ON CONFLICT (profile_id) DO UPDATE SET
           username       = EXCLUDED.username,
           dps_rank       = EXCLUDED.dps_rank,
           dps_role       = CASE WHEN EXCLUDED.dps_role != '' THEN EXCLUDED.dps_role ELSE dps_users.dps_role END,
           callsign       = EXCLUDED.callsign,
           status         = EXCLUDED.status,
           appointed_date = EXCLUDED.appointed_date,
           updated_at     = NOW()`,
        [profileId, canonicalUsername, dps_rank, dps_role.trim(), callsign.trim(), status, appointed_date || null]
      );
      if (isNewRosterMember) {
        await resetDpsMemberPermissionGrants(pool, profileId);
      }
      const result = await pool.query(
        `SELECT p.id, COALESCE(u.username, p.username) AS username,
                p.discord_username, p.discord_id,
                u.callsign, u.dps_rank, u.dps_role, u.status, u.appointed_date,
                u.pob, u.iab, u.hsu, u.sru, u.fou, u.certifications
         FROM dps_users u
         JOIN cad_user_profiles p ON p.id = u.profile_id
         WHERE u.profile_id = $1`,
        [profileId]
      );
      const actor = (req.body as Record<string, string>).actor || (req.headers['x-actor'] as string) || 'Admin';
      await writeLog('dps_personnel', actor, 'Added/updated officer', `${result.rows[0].username} — ${dps_rank}`);
      res.json(result.rows[0]);
    } else {
      // New user — create a manual cad_user_profiles entry, then insert into dps_users
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
        `INSERT INTO dps_users (profile_id, username, dps_rank, dps_role, callsign, status, appointed_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7::date)`,
        [profileId, username.trim(), dps_rank, dps_role.trim(), callsign.trim(), status, appointed_date || null]
      );
      await resetDpsMemberPermissionGrants(pool, profileId);
      const result = await pool.query(
        `SELECT p.id, COALESCE(u.username, p.username) AS username,
                p.discord_username, p.discord_id,
                u.callsign, u.dps_rank, u.dps_role, u.status, u.appointed_date,
                u.pob, u.iab, u.hsu, u.sru, u.fou, u.certifications
         FROM dps_users u
         JOIN cad_user_profiles p ON p.id = u.profile_id
         WHERE u.profile_id = $1`,
        [profileId]
      );
      const actor = (req.body as Record<string, string>).actor || (req.headers['x-actor'] as string) || 'Admin';
      await writeLog('dps_personnel', actor, 'Added new officer', `${username.trim()} — ${dps_rank}`);
      res.status(201).json(result.rows[0]);
    }
  } catch (err) {
    req.log.error({ err }, "roster POST error");
    res.status(500).json({ error: "Unable to add officer." });
  }
});

// ── DELETE — remove a member from the DPS roster ─────────────────────────────
// For manual accounts (community_code = 'MANUAL') the cad_user_profiles row is
// also deleted (cascades to dps_users via FK).
// For real CAD accounts the dps_users row is deleted and the profile is kept.
router.delete("/roster/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid id." }); return; }
  try {
    // Check if this is a manual-only account
    const profileRes = await pool.query<{ community_code: string }>(
      `SELECT community_code FROM cad_user_profiles WHERE id = $1`, [id]
    );
    if ((profileRes.rowCount ?? 0) === 0) { res.status(404).json({ error: "Member not found." }); return; }

    const usernameRes = await pool.query<{ username: string }>(
      `SELECT COALESCE(d.username, p.username) AS username FROM cad_user_profiles p LEFT JOIN dps_users d ON d.profile_id = p.id WHERE p.id = $1`, [id]
    );
    const removedName = usernameRes.rows[0]?.username ?? String(id);

    if (profileRes.rows[0].community_code === "MANUAL") {
      await pool.query(`DELETE FROM cad_user_profiles WHERE id = $1`, [id]);
    } else {
      await pool.query(`DELETE FROM dps_users WHERE profile_id = $1`, [id]);
    }
    const actor = (req.headers['x-actor'] as string) || 'Admin';
    await writeLog('dps_personnel', actor, 'Removed officer from roster', removedName);
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "roster DELETE error");
    res.status(500).json({ error: "Unable to remove member." });
  }
});

// ── GET /roster/discord-roles — DPS guild role list for dropdowns ─────────────
router.get("/roster/discord-roles", async (req, res) => {
  try {
    const refresh = wantsDiscordRolesRefresh(req.query as Record<string, unknown>);
    res.json(await getDpsGuildRoles(refresh));
  } catch (err) {
    req.log?.error?.({ err }, "roster/discord-roles GET error");
    res.status(500).json({ error: "Failed to fetch DPS Discord roles." });
  }
});

// ── GET /roster/division-discord-roles — Division guild role list ─────────────
router.get("/roster/division-discord-roles", async (req, res) => {
  try {
    const refresh = wantsDiscordRolesRefresh(req.query as Record<string, unknown>);
    res.json(await getDivisionGuildRoles(refresh));
  } catch (err) {
    req.log?.error?.({ err }, "division-discord-roles GET error");
    // Soft-fail so the Division Panel still loads when the bot isn't in the guild yet
    res.json([]);
  }
});

// ── POST /roster/sync-discord-roles — manual trigger for DPS role sync ────────
router.post("/roster/sync-discord-roles", async (_req, res) => {
  try {
    const members = await fetchDpsGuildMembers();
    await refreshCadAvatarsFromGuildMembers(members);
    const dps = await syncDpsDiscordRoles(members);
    const divisions = await syncDivisionDiscordRoles(members);
    res.json({ ...dps, divisions });
  } catch (err) {
    res.status(500).json({ error: "Sync failed." });
  }
});

// ── POST /roster/sync-division-discord-roles — division roster Discord sync ───
router.post("/roster/sync-division-discord-roles", async (_req, res) => {
  try {
    res.json(await syncDivisionDiscordRoles());
  } catch (err) {
    res.status(500).json({ error: "Division sync failed." });
  }
});

// ── GET ranks — ordered list ──────────────────────────────────────────────────
router.get("/roster/ranks", async (_req, res) => {
  try {
    if (isMongoStore()) {
      res.json(await listDpsRanksMongo());
      return;
    }
    const result = await pool.query(
      `SELECT id, name, sort_order, group_id, color_hex, callsign_prefix, insignia_url, discord_role_id,
              callsign_type, callsign_static, callsign_min, callsign_max
       FROM dps_ranks ORDER BY sort_order, id`
    );
    res.json(result.rows.map(r => normalizeRankRow(r as Record<string, unknown>)));
  } catch (err) {
    res.status(500).json({ error: "Unable to load ranks." });
  }
});

// ── GET ranks/:id — single rank detail with member list ───────────────────────
router.get("/roster/ranks/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid id." }); return; }
  try {
    if (isMongoStore()) {
      try {
        const detail = await getDpsRankDetailMongo(id);
        if (!detail) { res.status(404).json({ error: "Rank not found." }); return; }
        res.json(detail);
        return;
      } catch (mongoErr) {
        req.log.warn({ err: mongoErr }, "ranks/:id mongo loader failed — falling back to SQL bridge");
      }
    }
    const rankRes = await pool.query(
      `SELECT id, name, sort_order, group_id, color_hex, callsign_prefix, insignia_url, discord_role_id,
              callsign_type, callsign_static, callsign_min, callsign_max
       FROM dps_ranks WHERE id = $1`, [id]
    );
    if (rankRes.rowCount === 0) { res.status(404).json({ error: "Rank not found." }); return; }
    const rank = rankRes.rows[0];

    // Members whose DPS rank name matches (case-insensitive)
    const membersRes = await pool.query(
      `SELECT p.id, COALESCE(d.username, p.username) AS username,
              p.discord_username, p.discord_id, p.avatar_hash,
              d.callsign, d.dps_rank, d.status
       FROM cad_user_profiles p
       JOIN dps_users d ON d.profile_id = p.id
       WHERE lower(d.dps_rank) = lower($1)
       ORDER BY COALESCE(d.username, p.username)`, [rank.name]
    );
    const csRes = await pool.query(
      `SELECT cc.id, cc.rank_id, cc.callsign, cc.assigned_profile_id,
              COALESCE(d.username, p.username) AS assigned_username
       FROM dps_rank_custom_callsigns cc
       LEFT JOIN cad_user_profiles p ON p.id = cc.assigned_profile_id
       LEFT JOIN dps_users d ON d.profile_id = p.id
       WHERE cc.rank_id = $1
       ORDER BY cc.sort_order, cc.id`, [id]
    );
    let members = membersRes.rows;
    if (rank.callsign_type === 'dynamic') {
      members = [...members].sort((a, b) => {
        const nA = parseInt((a.callsign ?? '').split('-').pop() ?? '', 10);
        const nB = parseInt((b.callsign ?? '').split('-').pop() ?? '', 10);
        if (!isNaN(nA) && !isNaN(nB)) return nA - nB;
        return (a.callsign ?? '').localeCompare(b.callsign ?? '');
      });
    }
    res.json({
      ...normalizeRankRow(rank as Record<string, unknown>),
      members,
      custom_callsigns: csRes.rows,
    });
  } catch (err) {
    req.log.error({ err }, "ranks/:id GET error");
    res.status(500).json({ error: "Unable to load rank." });
  }
});

// ── POST ranks/reorder — bulk reorder by ID array ────────────────────────────
router.post("/roster/ranks/reorder", async (req, res) => {
  const { ids } = req.body as { ids?: number[] };
  if (!Array.isArray(ids) || ids.length === 0) {
    res.status(400).json({ error: "ids must be a non-empty array." }); return;
  }
  try {
    // Assign sort_order 0, 1, 2 … in the supplied order
    await Promise.all(
      ids.map((id, i) =>
        pool.query(`UPDATE dps_ranks SET sort_order = $2 WHERE id = $1`, [id, i])
      )
    );
    const result = await pool.query(
      `SELECT id, name, sort_order, group_id, color_hex, callsign_prefix, insignia_url
       FROM dps_ranks WHERE id = ANY($1) ORDER BY sort_order`,
      [ids]
    );
    res.json(result.rows.map(r => normalizeRankRow(r as Record<string, unknown>)));
  } catch (err) {
    req.log.error({ err }, "ranks reorder error");
    res.status(500).json({ error: "Unable to reorder ranks." });
  }
});

// ── POST ranks — add a new rank (optionally to a group) ───────────────────────
router.post("/roster/ranks", async (req, res) => {
  const { name, group_id, color_hex, callsign_prefix, insignia_url, discord_role_id,
          callsign_type, callsign_static, callsign_min, callsign_max } =
    req.body as { name?: string; group_id?: number; color_hex?: string; callsign_prefix?: string;
                  insignia_url?: string; discord_role_id?: string; callsign_type?: string;
                  callsign_static?: string; callsign_min?: number; callsign_max?: number };
  if (!name?.trim()) { res.status(400).json({ error: "Name is required." }); return; }
  try {
    const maxRes = await pool.query(`SELECT COALESCE(MAX(sort_order), -1) AS mx FROM dps_ranks`);
    const nextOrder = Number(maxRes.rows[0].mx) + 1;
    const csMin = callsign_min !== undefined ? (parseInt(String(callsign_min)) || null) : null;
    const csMax = callsign_max !== undefined ? (parseInt(String(callsign_max)) || null) : null;
    const result = await pool.query(
      `INSERT INTO dps_ranks (name, sort_order, group_id, color_hex, callsign_prefix, insignia_url, discord_role_id,
                              callsign_type, callsign_static, callsign_min, callsign_max)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id, name, sort_order, group_id, color_hex, callsign_prefix, insignia_url, discord_role_id,
                 callsign_type, callsign_static, callsign_min, callsign_max`,
      [name.trim(), nextOrder, group_id ?? null, color_hex ?? null, callsign_prefix?.trim() ?? null,
       insignia_url?.trim() ?? null, discord_role_id?.trim() || null,
       callsign_type?.trim() || null, callsign_static?.trim() || null, csMin, csMax]
    );
    res.status(201).json(normalizeRankRow(result.rows[0] as Record<string, unknown>));
    if (discord_role_id?.trim()) void syncDpsDiscordRoles().catch(console.error);
  } catch (err: unknown) {
    req.log.error({ err }, "dps ranks POST error");
    if (isUniqueViolation(err)) { res.status(409).json({ error: "A rank with that name already exists." }); return; }
    res.status(500).json({ error: "Unable to add rank." });
  }
});

// ── Bulk-sync DPS officer callsigns when a rank's callsign settings change ────
// Mirrors syncStaffCallsignsForRank for the DPS side.
// Static: every officer on the rank gets the same callsign.
// Dynamic: officers with a valid in-range callsign keep it; others get the next
//          available number.  Custom / unconfigured ranks are left unchanged.
async function syncDpsCallsignsForRank(rankId: number): Promise<void> {
  try {
    const rankRes = await pool.query<{
      name: string; callsign_type: string | null; callsign_prefix: string | null;
      callsign_static: string | null; callsign_min: number | null; callsign_max: number | null;
    }>(
      `SELECT name, callsign_type, callsign_prefix, callsign_static, callsign_min, callsign_max
       FROM dps_ranks WHERE id = $1`, [rankId]
    );
    if (!rankRes.rows.length) return;
    const { name: rankName, callsign_type, callsign_prefix, callsign_static, callsign_min, callsign_max } = rankRes.rows[0];

    if (!callsign_type || callsign_type === 'custom') return; // manual-only — leave untouched

    const prefix = callsign_prefix?.trim() ?? '';
    const join = (suffix: string) => prefix ? `${prefix}-${suffix}` : suffix;

    const membersRes = await pool.query<{ profile_id: number; callsign: string }>(
      `SELECT profile_id, callsign FROM dps_users WHERE lower(dps_rank) = lower($1)`, [rankName]
    );
    if (!membersRes.rows.length) return;

    if (callsign_type === 'static') {
      if (!callsign_static?.trim()) return;
      const target = join(callsign_static.trim());
      await Promise.all(
        membersRes.rows.map(m =>
          pool.query(
            `UPDATE dps_users SET callsign = $2, updated_at = NOW() WHERE profile_id = $1`,
            [m.profile_id, target]
          )
        )
      );
      console.info(`[dps-callsign-sync] rank="${rankName}" static="${target}" updated=${membersRes.rows.length}`);
      return;
    }

    if (callsign_type === 'dynamic' && callsign_min !== null && callsign_max !== null) {
      const padLen = Math.max(String(callsign_max).length, 2);
      const usedNums = new Set<number>();
      const needsAssignment: number[] = [];

      // First pass: find who already has a valid in-range callsign
      for (const m of membersRes.rows) {
        const cs = m.callsign ?? '';
        const parts = cs.split('-');
        const numStr = parts[parts.length - 1];
        const n = parseInt(numStr, 10);
        const hasValidPrefix = prefix ? cs.startsWith(prefix + '-') : parts.length === 1;
        const hasValidNum =
          !isNaN(n) && n >= callsign_min && n <= callsign_max &&
          numStr === String(n).padStart(padLen, '0');
        if (hasValidPrefix && hasValidNum) {
          usedNums.add(n);
        } else {
          needsAssignment.push(m.profile_id);
        }
      }

      // Second pass: assign next available slot to officers that need one
      let next = callsign_min;
      for (const profileId of needsAssignment) {
        while (next <= callsign_max && usedNums.has(next)) next++;
        if (next > callsign_max) break; // range exhausted
        const callsign = join(String(next).padStart(padLen, '0'));
        await pool.query(
          `UPDATE dps_users SET callsign = $2, updated_at = NOW() WHERE profile_id = $1`,
          [profileId, callsign]
        );
        usedNums.add(next);
        next++;
      }
      console.info(`[dps-callsign-sync] rank="${rankName}" dynamic updated=${needsAssignment.length}`);
    }
  } catch (e) {
    console.error('[dps-callsign-sync] error:', e);
  }
}

// ── PATCH ranks/:id — rename, reorder, or update metadata ────────────────────
router.patch("/roster/ranks/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid id." }); return; }

  const { name, direction, color_hex, callsign_prefix, insignia_url, group_id, discord_role_id,
          callsign_type, callsign_static, callsign_min, callsign_max } =
    req.body as {
      name?: string; direction?: "up" | "down"; color_hex?: string; callsign_prefix?: string;
      insignia_url?: string; group_id?: number | null; discord_role_id?: string | null;
      callsign_type?: string | null; callsign_static?: string | null;
      callsign_min?: number | null; callsign_max?: number | null;
    };
  const hasDiscordRole = Object.prototype.hasOwnProperty.call(req.body, "discord_role_id");
  const hasCallsignConfig =
    callsign_type !== undefined || callsign_static !== undefined
    || callsign_min !== undefined || callsign_max !== undefined || callsign_prefix !== undefined;
  const csMin = callsign_min !== undefined
    ? (callsign_min === null ? null : parseInt(String(callsign_min)) || null)
    : null;
  const csMax = callsign_max !== undefined
    ? (callsign_max === null ? null : parseInt(String(callsign_max)) || null)
    : null;

  try {
    // Group-only move (cross-group drag-and-drop)
    if (group_id !== undefined && name === undefined && direction === undefined
        && color_hex === undefined && callsign_prefix === undefined && insignia_url === undefined
        && !hasDiscordRole && !hasCallsignConfig) {
      const result = await pool.query(
        `UPDATE dps_ranks SET group_id = $2 WHERE id = $1
         RETURNING id, name, sort_order, group_id, color_hex, callsign_prefix, insignia_url, discord_role_id,
                   callsign_type, callsign_static, callsign_min, callsign_max`,
        [id, group_id ?? null]
      );
      if (result.rowCount === 0) { res.status(404).json({ error: "Rank not found." }); return; }
      res.json(result.rows[0]);
      return;
    }

    if (name !== undefined && direction === undefined) {
      if (!name.trim()) { res.status(400).json({ error: "Name cannot be empty." }); return; }
      const result = await pool.query(
        `UPDATE dps_ranks SET
           name             = $2,
           color_hex        = $3,
           callsign_prefix  = $4,
           insignia_url     = $5,
           discord_role_id  = CASE WHEN $6::boolean THEN $7 ELSE discord_role_id END,
           callsign_type    = CASE WHEN $8::boolean THEN $9  ELSE callsign_type END,
           callsign_static  = CASE WHEN $10::boolean THEN $11 ELSE callsign_static END,
           callsign_min     = CASE WHEN $12::boolean THEN $13 ELSE callsign_min END,
           callsign_max     = CASE WHEN $14::boolean THEN $15 ELSE callsign_max END
         WHERE id = $1
         RETURNING id, name, sort_order, group_id, color_hex, callsign_prefix, insignia_url, discord_role_id,
                   callsign_type, callsign_static, callsign_min, callsign_max`,
        [
          id, name.trim(), color_hex?.trim() || null, callsign_prefix?.trim() || null,
          insignia_url?.trim() || null, hasDiscordRole,
          hasDiscordRole ? (typeof discord_role_id === "string" ? discord_role_id.trim() || null : null) : null,
          callsign_type !== undefined, callsign_type?.trim() || null,
          callsign_static !== undefined, callsign_static?.trim() || null,
          callsign_min !== undefined, csMin,
          callsign_max !== undefined, csMax,
        ]
      );
      if (result.rowCount === 0) { res.status(404).json({ error: "Rank not found." }); return; }
      if (hasDiscordRole) void syncDpsDiscordRoles().catch(console.error);
      if (hasCallsignConfig) void syncDpsCallsignsForRank(id);
      res.json(result.rows[0]);
      return;
    }

    // Metadata-only update (no name change)
    if (direction === undefined && (color_hex !== undefined || callsign_prefix !== undefined
        || insignia_url !== undefined || hasDiscordRole || hasCallsignConfig)) {
      const result = await pool.query(
        `UPDATE dps_ranks SET
           color_hex       = CASE WHEN $2::text IS NOT NULL THEN $2 ELSE color_hex END,
           callsign_prefix = CASE WHEN $3::text IS NOT NULL THEN $3 ELSE callsign_prefix END,
           insignia_url    = CASE WHEN $4::text IS NOT NULL THEN $4 ELSE insignia_url END,
           discord_role_id = CASE WHEN $5::boolean THEN $6 ELSE discord_role_id END,
           callsign_type   = CASE WHEN $7::boolean THEN $8  ELSE callsign_type END,
           callsign_static = CASE WHEN $9::boolean THEN $10 ELSE callsign_static END,
           callsign_min    = CASE WHEN $11::boolean THEN $12 ELSE callsign_min END,
           callsign_max    = CASE WHEN $13::boolean THEN $14 ELSE callsign_max END
         WHERE id = $1
         RETURNING id, name, sort_order, group_id, color_hex, callsign_prefix, insignia_url, discord_role_id,
                   callsign_type, callsign_static, callsign_min, callsign_max`,
        [
          id, color_hex ?? null, callsign_prefix?.trim() ?? null, insignia_url?.trim() ?? null,
          hasDiscordRole,
          hasDiscordRole ? (typeof discord_role_id === "string" ? discord_role_id.trim() || null : null) : null,
          callsign_type !== undefined, callsign_type?.trim() || null,
          callsign_static !== undefined, callsign_static?.trim() || null,
          callsign_min !== undefined, csMin,
          callsign_max !== undefined, csMax,
        ]
      );
      if (result.rowCount === 0) { res.status(404).json({ error: "Rank not found." }); return; }
      if (hasDiscordRole) void syncDpsDiscordRoles().catch(console.error);
      if (hasCallsignConfig) void syncDpsCallsignsForRank(id);
      res.json(result.rows[0]);
      return;
    }

    // Reorder
    if (direction === "up" || direction === "down") {
      const current = await pool.query(
        `SELECT id, sort_order FROM dps_ranks WHERE id = $1`, [id]
      );
      if (current.rowCount === 0) { res.status(404).json({ error: "Rank not found." }); return; }

      const currentOrder = current.rows[0].sort_order as number;
      const adjacentRes = await pool.query(
        direction === "up"
          ? `SELECT id, sort_order FROM dps_ranks WHERE sort_order < $1 ORDER BY sort_order DESC LIMIT 1`
          : `SELECT id, sort_order FROM dps_ranks WHERE sort_order > $1 ORDER BY sort_order ASC  LIMIT 1`,
        [currentOrder]
      );
      if (adjacentRes.rowCount === 0) { res.json({ ok: true, noChange: true }); return; }

      const adj = adjacentRes.rows[0];
      await pool.query(
        `UPDATE dps_ranks SET sort_order = CASE WHEN id = $1 THEN $3 WHEN id = $2 THEN $4 END
         WHERE id IN ($1, $2)`,
        [id, adj.id, adj.sort_order, currentOrder]
      );
      res.json({ ok: true });
      return;
    }

    res.status(400).json({ error: "Provide 'name', metadata fields, or 'direction' to reorder." });
  } catch (err: unknown) {
    const pg = err as { code?: string };
    if (pg.code === "23505") { res.status(409).json({ error: "That name is already taken." }); return; }
    req.log.error({ err }, "ranks PATCH error");
    res.status(500).json({ error: "Unable to update rank." });
  }
});

// ── DELETE ranks/:id — remove a rank ─────────────────────────────────────────
router.delete("/roster/ranks/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid id." }); return; }
  try {
    await pool.query(`DELETE FROM dps_ranks WHERE id = $1`, [id]);
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "ranks DELETE error");
    res.status(500).json({ error: "Unable to delete rank." });
  }
});

// ── POST ranks/:id/auto-assign-callsigns — bulk assign dynamic callsigns ──────
router.post("/roster/ranks/:id/auto-assign-callsigns", async (req, res) => {
  const rankId = Number(req.params.id);
  if (!Number.isInteger(rankId) || rankId <= 0) { res.status(400).json({ error: "Invalid rank id." }); return; }
  try {
    const rankRes = await pool.query<{ name: string; callsign_type: string | null; callsign_prefix: string | null; callsign_min: number | null; callsign_max: number | null }>(
      `SELECT name, callsign_type, callsign_prefix, callsign_min, callsign_max FROM dps_ranks WHERE id = $1`, [rankId]
    );
    if (!rankRes.rows.length) { res.status(404).json({ error: "Rank not found." }); return; }
    const { name: rankName, callsign_type, callsign_prefix, callsign_min, callsign_max } = rankRes.rows[0];
    if (callsign_type !== 'dynamic') { res.status(400).json({ error: "Rank is not dynamic type." }); return; }

    const prefix = callsign_prefix?.trim() ?? '';
    const min = callsign_min ?? 0;
    const max = callsign_max ?? 0;
    const padLen = Math.max(String(max).length, 2);

    // Get all members of this rank with their current callsign
    const membersRes = await pool.query<{ profile_id: number; callsign: string }>(
      `SELECT profile_id, callsign FROM dps_users WHERE dps_rank = $1`, [rankName]
    );

    const results: { profile_id: number; callsign: string }[] = [];
    for (const member of membersRes.rows) {
      // Skip members whose callsign already has the right prefix AND a correctly-padded in-range number
      const cs = member.callsign ?? '';
      const parts = cs.split('-');
      const numStr = parts[parts.length - 1];
      const n = parseInt(numStr, 10);
      const hasValidPrefix = prefix ? cs.startsWith(prefix + '-') : parts.length === 1;
      const hasValidNum = !isNaN(n) && n >= min && n <= max && numStr === String(n).padStart(padLen, '0');
      if (hasValidPrefix && hasValidNum) {
        results.push({ profile_id: member.profile_id, callsign: member.callsign });
        continue;
      }
      // Needs a new assignment
      const callsign = await autoAssignCallsign(rankName, member.profile_id);
      const final = callsign ?? '4D-XX';
      await pool.query(`UPDATE dps_users SET callsign = $2 WHERE profile_id = $1`, [member.profile_id, final]);
      results.push({ profile_id: member.profile_id, callsign: final });
    }
    res.json({ results });
  } catch (err) {
    req.log.error({ err }, "auto-assign-callsigns error");
    res.status(500).json({ error: "Unable to auto-assign callsigns." });
  }
});

// ── POST ranks/:id/custom-callsigns/reorder — save new drag order ────────────
router.post("/roster/ranks/:id/custom-callsigns/reorder", async (req, res) => {
  const rankId = Number(req.params.id);
  if (!Number.isInteger(rankId) || rankId <= 0) { res.status(400).json({ error: "Invalid rank id." }); return; }
  const { ids } = req.body as { ids?: number[] };
  if (!Array.isArray(ids) || ids.length === 0) { res.status(400).json({ error: "ids must be a non-empty array." }); return; }
  try {
    await Promise.all(ids.map((id, i) =>
      pool.query(
        `UPDATE dps_rank_custom_callsigns SET sort_order = $2 WHERE id = $1 AND rank_id = $3`,
        [id, i, rankId]
      )
    ));
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "custom-callsigns reorder error");
    res.status(500).json({ error: "Unable to reorder custom callsigns." });
  }
});

// ── POST ranks/:id/custom-callsigns — add a custom callsign slot ──────────────
router.post("/roster/ranks/:id/custom-callsigns", async (req, res) => {
  const rankId = Number(req.params.id);
  if (!Number.isInteger(rankId) || rankId <= 0) { res.status(400).json({ error: "Invalid rank id." }); return; }
  const { callsign } = req.body as { callsign?: string };
  if (!callsign?.trim()) { res.status(400).json({ error: "Callsign is required." }); return; }
  try {
    const soRes = await pool.query<{ mx: number }>(
      `SELECT COALESCE(MAX(sort_order), -1) + 1 AS mx FROM dps_rank_custom_callsigns WHERE rank_id = $1`,
      [rankId]
    );
    const nextOrder = soRes.rows[0].mx;
    const result = await pool.query(
      `INSERT INTO dps_rank_custom_callsigns (rank_id, callsign, sort_order)
       VALUES ($1, $2, $3)
       RETURNING id, rank_id, callsign, assigned_profile_id, NULL::text AS assigned_username`,
      [rankId, callsign.trim(), nextOrder]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    req.log.error({ err }, "custom-callsigns POST error");
    res.status(500).json({ error: "Unable to add custom callsign." });
  }
});

// ── PATCH rank-callsigns/:csId — update text or assignment ────────────────────
router.patch("/roster/rank-callsigns/:csId", async (req, res) => {
  const csId = Number(req.params.csId);
  if (!Number.isInteger(csId) || csId <= 0) { res.status(400).json({ error: "Invalid id." }); return; }
  const { callsign, assigned_profile_id } = req.body as { callsign?: string; assigned_profile_id?: number | null };
  try {
    // Update callsign text
    if (callsign !== undefined) {
      if (!callsign.trim()) { res.status(400).json({ error: "Callsign cannot be empty." }); return; }
      await pool.query(`UPDATE dps_rank_custom_callsigns SET callsign = $2 WHERE id = $1`, [csId, callsign.trim()]);
      // Sync the new text to any currently assigned member
      const asgn = await pool.query<{ assigned_profile_id: number | null }>(
        `SELECT assigned_profile_id FROM dps_rank_custom_callsigns WHERE id = $1`, [csId]
      );
      const pid = asgn.rows[0]?.assigned_profile_id;
      if (pid) await pool.query(`UPDATE dps_users SET callsign = $2 WHERE profile_id = $1`, [pid, callsign.trim()]);
    }
    // Update assignment
    if (assigned_profile_id !== undefined) {
      const cur = await pool.query<{ assigned_profile_id: number | null; callsign: string }>(
        `SELECT assigned_profile_id, callsign FROM dps_rank_custom_callsigns WHERE id = $1`, [csId]
      );
      const prevPid = cur.rows[0]?.assigned_profile_id;
      const csText  = cur.rows[0]?.callsign ?? '';
      // Clear previous assignee if different
      if (prevPid && prevPid !== assigned_profile_id) {
        await pool.query(`UPDATE dps_users SET callsign = '4D-XX' WHERE profile_id = $1`, [prevPid]);
      }
      await pool.query(
        `UPDATE dps_rank_custom_callsigns SET assigned_profile_id = $2 WHERE id = $1`,
        [csId, assigned_profile_id ?? null]
      );
      // Write callsign to new assignee
      if (assigned_profile_id) {
        await pool.query(`UPDATE dps_users SET callsign = $2 WHERE profile_id = $1`, [assigned_profile_id, csText]);
      }
    }
    // Return updated row with username
    const updated = await pool.query(
      `SELECT cc.id, cc.rank_id, cc.callsign, cc.assigned_profile_id,
              COALESCE(d.username, p.username) AS assigned_username
       FROM dps_rank_custom_callsigns cc
       LEFT JOIN cad_user_profiles p ON p.id = cc.assigned_profile_id
       LEFT JOIN dps_users d ON d.profile_id = p.id
       WHERE cc.id = $1`, [csId]
    );
    res.json(updated.rows[0]);
  } catch (err) {
    req.log.error({ err }, "rank-callsigns PATCH error");
    res.status(500).json({ error: "Unable to update custom callsign." });
  }
});

// ── DELETE rank-callsigns/:csId — remove a custom callsign slot ───────────────
router.delete("/roster/rank-callsigns/:csId", async (req, res) => {
  const csId = Number(req.params.csId);
  if (!Number.isInteger(csId) || csId <= 0) { res.status(400).json({ error: "Invalid id." }); return; }
  try {
    // Clear assignee's callsign if someone is assigned
    const cur = await pool.query<{ assigned_profile_id: number | null }>(
      `SELECT assigned_profile_id FROM dps_rank_custom_callsigns WHERE id = $1`, [csId]
    );
    const pid = cur.rows[0]?.assigned_profile_id;
    if (pid) await pool.query(`UPDATE dps_users SET callsign = '4D-XX' WHERE profile_id = $1`, [pid]);
    await pool.query(`DELETE FROM dps_rank_custom_callsigns WHERE id = $1`, [csId]);
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "rank-callsigns DELETE error");
    res.status(500).json({ error: "Unable to delete custom callsign." });
  }
});

// ── GET groups — ordered list of roster group headings ───────────────────────
router.get("/roster/groups", async (_req, res) => {
  try {
    if (isMongoStore()) {
      res.json(await listDpsRankGroupsMongo());
      return;
    }
    const result = await pool.query(
      `SELECT id, name, sort_order, panel_access, COALESCE(division_oversight, false) AS division_oversight
         FROM dps_rank_groups ORDER BY sort_order, id`
    );
    res.json(result.rows.map(r => ({
      ...normalizeGroupRow(r as Record<string, unknown>),
    })));
  } catch (err) {
    _req.log.error({ err }, "groups GET error");
    res.status(500).json({ error: "Unable to load groups." });
  }
});

// ── POST groups — add a new group heading ─────────────────────────────────────
router.post("/roster/groups", async (req, res) => {
  const { name } = req.body as { name?: string };
  if (!name?.trim()) { res.status(400).json({ error: "Name is required." }); return; }
  try {
    const maxRes = await pool.query(`SELECT COALESCE(MAX(sort_order), 0) AS mx FROM dps_rank_groups`);
    const nextOrder = Number(maxRes.rows[0].mx) + 1;
    const result = await pool.query(
      `INSERT INTO dps_rank_groups (name, sort_order) VALUES ($1, $2)
       RETURNING id, name, sort_order, panel_access, COALESCE(division_oversight, false) AS division_oversight`,
      [name.trim(), nextOrder]
    );
    const row = result.rows[0] as Record<string, unknown>;
    res.status(201).json(normalizeGroupRow(row));
  } catch (err: unknown) {
    const pg = err as { code?: string };
    if (pg.code === "23505") { res.status(409).json({ error: "A group with that name already exists." }); return; }
    req.log.error({ err }, "groups POST error");
    res.status(500).json({ error: "Unable to add group." });
  }
});

// ── POST groups/reorder — bulk reorder group headings ────────────────────────
router.post("/roster/groups/reorder", async (req, res) => {
  const { ids } = req.body as { ids?: number[] };
  if (!Array.isArray(ids) || ids.length === 0) {
    res.status(400).json({ error: "ids must be a non-empty array." }); return;
  }
  try {
    await Promise.all(
      ids.map((id, i) =>
        pool.query(`UPDATE dps_rank_groups SET sort_order = $2 WHERE id = $1`, [id, i])
      )
    );
    const result = await pool.query(
      `SELECT id, name, sort_order, panel_access FROM dps_rank_groups WHERE id = ANY($1) ORDER BY sort_order`,
      [ids]
    );
    res.json(result.rows);
  } catch (err) {
    req.log.error({ err }, "groups reorder error");
    res.status(500).json({ error: "Unable to reorder groups." });
  }
});

// ── PATCH groups/:id — rename, reorder, or toggle access flags ───────────────
router.patch("/roster/groups/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid id." }); return; }

  const { name, direction, panel_access, division_oversight } =
    req.body as {
      name?: string;
      direction?: "up" | "down";
      panel_access?: boolean;
      division_oversight?: boolean;
    };

  try {
    // Toggle panel_access flag
    if (panel_access !== undefined && name === undefined && direction === undefined && division_oversight === undefined) {
      const result = await pool.query(
        `UPDATE dps_rank_groups SET panel_access = $2 WHERE id = $1
         RETURNING id, name, sort_order, panel_access, COALESCE(division_oversight, false) AS division_oversight`,
        [id, panel_access]
      );
      if (result.rowCount === 0) { res.status(404).json({ error: "Group not found." }); return; }
      const actor = (req.body as Record<string, unknown>).actor as string || (req.headers['x-actor'] as string) || 'Admin';
      const groupName = result.rows[0].name as string;
      await writeLog('dps_personnel', actor,
        panel_access ? 'Granted panel access' : 'Revoked panel access',
        `Group: ${groupName}`
      );
      res.json(normalizeGroupRow(result.rows[0] as Record<string, unknown>));
      return;
    }

    // Toggle division_oversight flag
    if (division_oversight !== undefined && name === undefined && direction === undefined && panel_access === undefined) {
      const result = await pool.query(
        `UPDATE dps_rank_groups SET division_oversight = $2 WHERE id = $1
         RETURNING id, name, sort_order, panel_access, COALESCE(division_oversight, false) AS division_oversight`,
        [id, division_oversight]
      );
      if (result.rowCount === 0) { res.status(404).json({ error: "Group not found." }); return; }
      const actor = (req.body as Record<string, unknown>).actor as string || (req.headers['x-actor'] as string) || 'Admin';
      const groupName = result.rows[0].name as string;
      await writeLog('dps_personnel', actor,
        division_oversight ? 'Granted division oversight' : 'Revoked division oversight',
        `Group: ${groupName}`
      );
      res.json(normalizeGroupRow(result.rows[0] as Record<string, unknown>));
      return;
    }

    if (name !== undefined) {
      if (!name.trim()) { res.status(400).json({ error: "Name cannot be empty." }); return; }
      const result = await pool.query(
        `UPDATE dps_rank_groups SET name = $2 WHERE id = $1
         RETURNING id, name, sort_order, panel_access, COALESCE(division_oversight, false) AS division_oversight`,
        [id, name.trim()]
      );
      if (result.rowCount === 0) { res.status(404).json({ error: "Group not found." }); return; }
      res.json(normalizeGroupRow(result.rows[0] as Record<string, unknown>));
      return;
    }

    if (direction === "up" || direction === "down") {
      const current = await pool.query(`SELECT id, sort_order FROM dps_rank_groups WHERE id = $1`, [id]);
      if (current.rowCount === 0) { res.status(404).json({ error: "Group not found." }); return; }
      const currentOrder = current.rows[0].sort_order as number;
      const adjacentRes = await pool.query(
        direction === "up"
          ? `SELECT id, sort_order FROM dps_rank_groups WHERE sort_order < $1 ORDER BY sort_order DESC LIMIT 1`
          : `SELECT id, sort_order FROM dps_rank_groups WHERE sort_order > $1 ORDER BY sort_order ASC  LIMIT 1`,
        [currentOrder]
      );
      if (adjacentRes.rowCount === 0) { res.json({ ok: true, noChange: true }); return; }
      const adj = adjacentRes.rows[0];
      await pool.query(
        `UPDATE dps_rank_groups SET sort_order = CASE WHEN id = $1 THEN $3 WHEN id = $2 THEN $4 END WHERE id IN ($1, $2)`,
        [id, adj.id, adj.sort_order, currentOrder]
      );
      res.json({ ok: true });
      return;
    }

    res.status(400).json({ error: "Provide 'name', 'panel_access', 'division_oversight', or 'direction'." });
  } catch (err: unknown) {
    const pg = err as { code?: string };
    if (pg.code === "23505") { res.status(409).json({ error: "That name is already taken." }); return; }
    req.log.error({ err }, "groups PATCH error");
    res.status(500).json({ error: "Unable to update group." });
  }
});

// ── DELETE groups/:id — remove a group heading ───────────────────────────────
router.delete("/roster/groups/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid id." }); return; }
  try {
    // Move orphaned ranks to the last remaining group (or null)
    await pool.query(
      `UPDATE dps_ranks SET group_id = (
         SELECT id FROM dps_rank_groups WHERE id != $1 ORDER BY sort_order DESC LIMIT 1
       ) WHERE group_id = $1`,
      [id]
    );
    await pool.query(`DELETE FROM dps_rank_groups WHERE id = $1`, [id]);
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "groups DELETE error");
    res.status(500).json({ error: "Unable to delete group." });
  }
});

// ── Division Roster (divisions ≈ titles, division ranks ≈ ranks) ───────────────

router.get("/roster/divisions", async (_req, res) => {
  try {
    if (isMongoStore()) {
      res.json(await listDpsDivisionsMongo());
      return;
    }
    const result = await pool.query(
      `SELECT id, name, sort_order, discord_role_id, unit_key FROM dps_divisions ORDER BY sort_order, id`
    );
    res.json(result.rows);
  } catch (err) {
    _req.log.error({ err }, "divisions GET error");
    res.status(500).json({ error: "Unable to load divisions." });
  }
});

router.post("/roster/divisions", async (req, res) => {
  const { name, discord_role_id, unit_key } = req.body as {
    name?: string; discord_role_id?: string | null; unit_key?: string | null;
  };
  if (!name?.trim()) { res.status(400).json({ error: "Name is required." }); return; }
  const resolvedUnit = unitKeyFromDivision(name.trim(), unit_key);
  try {
    const maxRes = await pool.query(`SELECT COALESCE(MAX(sort_order), 0) AS mx FROM dps_divisions`);
    const next = Number(maxRes.rows[0]?.mx ?? 0) + 1;
    await pool.query(
      `INSERT INTO dps_divisions (name, sort_order, discord_role_id, unit_key)
       VALUES ($1, $2, $3, $4)`,
      [name.trim(), next, discord_role_id?.trim() || null, resolvedUnit]
    );
    const result = await pool.query(
      `SELECT id, name, sort_order, discord_role_id, unit_key
       FROM dps_divisions WHERE lower(name) = lower($1) ORDER BY id DESC LIMIT 1`,
      [name.trim()]
    );
    if (discord_role_id?.trim()) void syncDivisionDiscordRoles().catch(console.error);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    req.log.error({ err }, "divisions POST error");
    res.status(500).json({ error: "Unable to create division." });
  }
});

router.post("/roster/divisions/reorder", async (req, res) => {
  const { ids } = req.body as { ids?: number[] };
  if (!Array.isArray(ids) || ids.length === 0) { res.status(400).json({ error: "ids must be a non-empty array." }); return; }
  try {
    await Promise.all(ids.map((id, i) =>
      pool.query(`UPDATE dps_divisions SET sort_order = $2 WHERE id = $1`, [id, i])
    ));
    const result = await pool.query(
      `SELECT id, name, sort_order, discord_role_id, unit_key
       FROM dps_divisions WHERE id = ANY($1) ORDER BY sort_order`,
      [ids]
    );
    res.json(result.rows);
  } catch (err) {
    req.log.error({ err }, "divisions reorder error");
    res.status(500).json({ error: "Unable to reorder divisions." });
  }
});

router.patch("/roster/divisions/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid id." }); return; }
  const { name, move, discord_role_id, unit_key } = req.body as {
    name?: string; move?: "up" | "down"; discord_role_id?: string | null; unit_key?: string | null;
  };
  try {
    if (typeof name === "string" && name.trim()) {
      await pool.query(`UPDATE dps_divisions SET name = $2 WHERE id = $1`, [id, name.trim()]);
    }
    if (discord_role_id !== undefined) {
      await pool.query(
        `UPDATE dps_divisions SET discord_role_id = $2 WHERE id = $1`,
        [id, discord_role_id?.trim() || null]
      );
    }
    if (unit_key !== undefined || (typeof name === "string" && name.trim())) {
      const cur = await pool.query<{ name: string; unit_key: string | null }>(
        `SELECT name, unit_key FROM dps_divisions WHERE id = $1`, [id]
      );
      if (cur.rows.length) {
        const resolved = unitKeyFromDivision(
          typeof name === "string" && name.trim() ? name.trim() : cur.rows[0].name,
          unit_key !== undefined ? unit_key : cur.rows[0].unit_key,
        );
        await pool.query(`UPDATE dps_divisions SET unit_key = $2 WHERE id = $1`, [id, resolved]);
      }
    }
    if (move === "up" || move === "down") {
      const current = await pool.query(`SELECT id, sort_order FROM dps_divisions WHERE id = $1`, [id]);
      if (!current.rows.length) { res.status(404).json({ error: "Division not found." }); return; }
      const curOrder = current.rows[0].sort_order as number;
      const neighbor = await pool.query(
        move === "up"
          ? `SELECT id, sort_order FROM dps_divisions WHERE sort_order < $1 ORDER BY sort_order DESC LIMIT 1`
          : `SELECT id, sort_order FROM dps_divisions WHERE sort_order > $1 ORDER BY sort_order ASC  LIMIT 1`,
        [curOrder]
      );
      if (neighbor.rows.length) {
        const n = neighbor.rows[0];
        await pool.query(
          `UPDATE dps_divisions SET sort_order = CASE WHEN id = $1 THEN $3 WHEN id = $2 THEN $4 END WHERE id IN ($1, $2)`,
          [id, n.id, n.sort_order, curOrder]
        );
      }
    }
    const result = await pool.query(
      `SELECT id, name, sort_order, discord_role_id, unit_key FROM dps_divisions WHERE id = $1`,
      [id]
    );
    if (discord_role_id !== undefined) void syncDivisionDiscordRoles().catch(console.error);
    res.json(result.rows[0]);
  } catch (err) {
    req.log.error({ err }, "divisions PATCH error");
    res.status(500).json({ error: "Unable to update division." });
  }
});

/** Add an officer to a division (manual — survives Discord sync until removed). */
router.post("/roster/divisions/:id/members", async (req, res) => {
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
    const div = await pool.query(`SELECT id, name FROM dps_divisions WHERE id = $1`, [divisionId]);
    if (!div.rows.length) { res.status(404).json({ error: "Division not found." }); return; }

    const ranks = await pool.query<{ name: string; sort_order: number }>(
      `SELECT name, sort_order FROM dps_division_ranks WHERE division_id = $1 ORDER BY sort_order DESC, id DESC`,
      [divisionId]
    );
    if (!ranks.rows.length) {
      res.status(400).json({ error: "Add a division rank before assigning officers." }); return;
    }

    const requestedRank = String(division_rank ?? "").trim();
    const rankName = requestedRank
      ? (ranks.rows.find(r => r.name.toLowerCase() === requestedRank.toLowerCase())?.name ?? null)
      : ranks.rows[0].name;
    if (!rankName) { res.status(400).json({ error: "Invalid division rank." }); return; }

    let profileId = Number(profile_id);
    if (!Number.isInteger(profileId) || profileId <= 0) {
      if (!username?.trim()) { res.status(400).json({ error: "Username or profile_id is required." }); return; }

      // Prefer existing profile by discord_id / username
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
            `manual-div-${ts}`,
            username.trim(),
            discord_username.trim(),
            discord_id.trim(),
            `manual_div_${ts}@manual.local`,
          ]
        );
        profileId = created.rows[0].id;
      }
    }

    const isNewRosterMember = !(await dpsRosterRowExists(pool, profileId));

    await pool.query(
      `INSERT INTO dps_users (profile_id, username, status)
       VALUES ($1, $2, 'Active')
       ON CONFLICT (profile_id) DO UPDATE SET
         username = COALESCE(EXCLUDED.username, dps_users.username),
         status = COALESCE(dps_users.status, 'Active'),
         updated_at = NOW()`,
      [profileId, username?.trim() || null]
    );
    if (isNewRosterMember) {
      await resetDpsMemberPermissionGrants(pool, profileId);
    }

    const existing = await loadDivisionAssignments([profileId]);
    const current = (existing.get(profileId) ?? [])
      .filter(a => a.division_id !== divisionId)
      .map(a => ({
        division_id: a.division_id,
        division_rank: a.division_rank,
        is_manual: Boolean(a.is_manual),
      }));
    current.push({ division_id: divisionId, division_rank: rankName, is_manual: true });
    const assignments = await setMemberDivisionAssignments(profileId, current);

    const member = await pool.query(
      `SELECT p.id, COALESCE(u.username, p.username) AS username,
              p.discord_username, p.discord_id, p.avatar_hash,
              u.callsign, u.dps_rank, u.status
       FROM cad_user_profiles p
       LEFT JOIN dps_users u ON u.profile_id = p.id
       WHERE p.id = $1`,
      [profileId]
    );

    res.status(201).json({
      ...member.rows[0],
      division_assignments: assignments,
      division_rank: assignments.find(a => a.division_id === divisionId)?.division_rank ?? rankName,
    });
  } catch (err) {
    req.log.error({ err }, "division members POST error");
    res.status(500).json({ error: "Unable to add officer to division." });
  }
});

/** Remove an officer from a division only (keeps them on the DPS personnel roster). */
router.delete("/roster/divisions/:id/members/:profileId", async (req, res) => {
  const divisionId = Number(req.params.id);
  const profileId = Number(req.params.profileId);
  if (!Number.isInteger(divisionId) || divisionId <= 0 || !Number.isInteger(profileId) || profileId <= 0) {
    res.status(400).json({ error: "Invalid id." }); return;
  }
  try {
    const existing = await loadDivisionAssignments([profileId]);
    const current = existing.get(profileId) ?? [];
    if (!current.some(a => a.division_id === divisionId)) {
      res.status(404).json({ error: "Officer is not in this division." }); return;
    }
    const next = current
      .filter(a => a.division_id !== divisionId)
      .map(a => ({
        division_id: a.division_id,
        division_rank: a.division_rank,
        is_manual: Boolean(a.is_manual),
        can_edit_resources: Boolean(a.can_edit_resources),
        can_edit_roster: Boolean(a.can_edit_roster),
      }));
    const assignments = await setMemberDivisionAssignments(profileId, next);
    res.json({ ok: true, division_assignments: assignments });
  } catch (err) {
    req.log.error({ err }, "division members DELETE error");
    res.status(500).json({ error: "Unable to remove officer from division." });
  }
});

/** Toggle division resource / roster / info edit permissions for a member. */
router.patch("/roster/divisions/:id/members/:profileId/access", async (req, res) => {
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
    const existing = await loadDivisionAssignments([profileId]);
    const current = existing.get(profileId) ?? [];
    const target = current.find(a => a.division_id === divisionId);
    if (!target) {
      res.status(404).json({ error: "Officer is not in this division." }); return;
    }
    const next = current.map(a => {
      if (a.division_id !== divisionId) {
        return {
          division_id: a.division_id,
          division_rank: a.division_rank,
          is_manual: Boolean(a.is_manual),
          can_edit_resources: Boolean(a.can_edit_resources),
          can_edit_roster: Boolean(a.can_edit_roster),
          can_edit_info: Boolean(a.can_edit_info),
        };
      }
      return {
        division_id: a.division_id,
        division_rank: a.division_rank,
        is_manual: Boolean(a.is_manual),
        can_edit_resources: can_edit_resources !== undefined
          ? Boolean(can_edit_resources)
          : Boolean(a.can_edit_resources),
        can_edit_roster: can_edit_roster !== undefined
          ? Boolean(can_edit_roster)
          : Boolean(a.can_edit_roster),
        can_edit_info: can_edit_info !== undefined
          ? Boolean(can_edit_info)
          : Boolean(a.can_edit_info),
      };
    });
    const assignments = await setMemberDivisionAssignments(profileId, next);
    const updated = assignments.find(a => a.division_id === divisionId) ?? null;
    const actor = (req.body as Record<string, unknown>).actor as string
      || (req.headers["x-actor"] as string)
      || "Admin";
    const bits: string[] = [];
    if (can_edit_resources !== undefined) {
      bits.push(`resources ${can_edit_resources ? "granted" : "revoked"}`);
    }
    if (can_edit_roster !== undefined) {
      bits.push(`roster ${can_edit_roster ? "granted" : "revoked"}`);
    }
    if (can_edit_info !== undefined) {
      bits.push(`info ${can_edit_info ? "granted" : "revoked"}`);
    }
    await writeLog(
      "dps_personnel",
      actor,
      "Updated division member access",
      `Profile ${profileId} — division ${divisionId}: ${bits.join(", ")}`,
    );
    res.json({ ok: true, assignment: updated, division_assignments: assignments });
  } catch (err) {
    req.log.error({ err }, "division member access PATCH error");
    res.status(500).json({ error: "Unable to update division access." });
  }
});

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

/** GET /roster/divisions/:id/info — public division information blocks */
router.get("/roster/divisions/:id/info", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid id." }); return; }
  try {
    if (isMongoStore()) {
      const info = await getDpsDivisionInfoMongo(id);
      if (!info) { res.status(404).json({ error: "Division not found." }); return; }
      res.json(info);
      return;
    }
    const result = await pool.query<{ id: number; name: string; info_content: unknown }>(
      `SELECT id, name, COALESCE(info_content, '{"sections":[]}') AS info_content
         FROM dps_divisions WHERE id = $1`,
      [id],
    );
    if (!result.rows.length) { res.status(404).json({ error: "Division not found." }); return; }
    const row = result.rows[0];
    res.json({
      id: row.id,
      name: row.name,
      ...parseDivisionInfoContent(row.info_content),
    });
  } catch (err) {
    req.log.error({ err }, "division info GET error");
    res.status(500).json({ error: "Unable to load division information." });
  }
});

/** PUT /roster/divisions/:id/info — save division information blocks */
router.put("/roster/divisions/:id/info", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid id." }); return; }
  const sections = Array.isArray((req.body as { sections?: unknown }).sections)
    ? (req.body as { sections: unknown[] }).sections
    : null;
  if (!sections) { res.status(400).json({ error: "sections array is required." }); return; }
  try {
    const payload = JSON.stringify({ sections });
    const result = await pool.query(
      `UPDATE dps_divisions SET info_content = $2 WHERE id = $1
       RETURNING id, name, info_content`,
      [id, payload],
    );
    if (!result.rows.length) { res.status(404).json({ error: "Division not found." }); return; }
    const row = result.rows[0] as { id: number; name: string; info_content: unknown };
    const actor = (req.body as Record<string, unknown>).actor as string
      || (req.headers["x-actor"] as string)
      || "Admin";
    await writeLog(
      "dps_personnel",
      actor,
      "Updated division information",
      `${row.name} — ${sections.length} section(s)`,
    );
    res.json({
      id: row.id,
      name: row.name,
      ...parseDivisionInfoContent(row.info_content),
    });
  } catch (err) {
    req.log.error({ err }, "division info PUT error");
    res.status(500).json({ error: "Unable to save division information." });
  }
});

router.delete("/roster/divisions/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid id." }); return; }
  try {
    const assigned = await pool.query<{ profile_id: number }>(
      `SELECT DISTINCT profile_id FROM dps_user_divisions WHERE division_id = $1
       UNION
       SELECT profile_id FROM dps_users
       WHERE lower(division_rank) IN (
         SELECT lower(name) FROM dps_division_ranks WHERE division_id = $1
       )`,
      [id]
    );
    await pool.query(`DELETE FROM dps_user_divisions WHERE division_id = $1`, [id]);
    await pool.query(
      `UPDATE dps_users SET division_rank = NULL
       WHERE lower(division_rank) IN (
         SELECT lower(name) FROM dps_division_ranks WHERE division_id = $1
       )`,
      [id]
    );
    await pool.query(`DELETE FROM dps_divisions WHERE id = $1`, [id]);
    for (const row of assigned.rows) {
      // Refresh primary division_rank from remaining assignments + unit flags
      const remaining = await loadDivisionAssignments([row.profile_id]);
      const list = remaining.get(row.profile_id) ?? [];
      await pool.query(
        `UPDATE dps_users SET division_rank = $2 WHERE profile_id = $1`,
        [row.profile_id, list[0]?.division_rank ?? null]
      );
      await syncPersonnelUnitsFromAssignments(row.profile_id);
    }
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "divisions DELETE error");
    res.status(500).json({ error: "Unable to delete division." });
  }
});

const DIVISION_RANK_SELECT = `
  id, division_id, name, sort_order, color_hex, insignia_url, discord_role_id,
  callsign_prefix, callsign_type, callsign_static, callsign_min, callsign_max
`;

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
            COALESCE(d.callsign, '4D-XX') AS callsign,
            COALESCE(d.status, 'Active') AS status
     FROM dps_user_divisions ud
     JOIN cad_user_profiles p ON p.id = ud.profile_id
     LEFT JOIN dps_users d ON d.profile_id = p.id
     WHERE lower(ud.division_rank) = lower($1)
       AND (ud.division_id = $2 OR (ud.division_id IS NULL AND $2 IS NULL))
     ORDER BY COALESCE(d.username, p.username)`,
    [rankName, divisionId]
  );
  return sortByCallsignThenUsername(result.rows);
}

/** Sync callsigns for officers assigned to a division rank (writes dps_users.callsign). */
async function syncDivisionRankCallsigns(rankId: number): Promise<void> {
  try {
    const rankRes = await pool.query<{
      name: string; division_id: number | null;
      callsign_type: string | null; callsign_prefix: string | null;
      callsign_static: string | null; callsign_min: number | null; callsign_max: number | null;
    }>(
      `SELECT name, division_id, callsign_type, callsign_prefix, callsign_static, callsign_min, callsign_max
       FROM dps_division_ranks WHERE id = $1`, [rankId]
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
      await Promise.all(
        members.map(m =>
          pool.query(
            `UPDATE dps_users SET callsign = $2, updated_at = NOW() WHERE profile_id = $1`,
            [m.id, target]
          )
        )
      );
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
        if (hasValidPrefix && hasValidNum) {
          usedNums.add(n);
        } else {
          needsAssignment.push(m.id);
        }
      }

      let next = callsign_min;
      for (const profileId of needsAssignment) {
        while (next <= callsign_max && usedNums.has(next)) next++;
        if (next > callsign_max) break;
        const callsign = join(String(next).padStart(padLen, "0"));
        await pool.query(
          `UPDATE dps_users SET callsign = $2, updated_at = NOW() WHERE profile_id = $1`,
          [profileId, callsign]
        );
        usedNums.add(next);
        next++;
      }
    }
  } catch (e) {
    console.error("[division-callsign-sync] error:", e);
  }
}

router.get("/roster/division-ranks", async (_req, res) => {
  try {
    if (isMongoStore()) {
      res.json(await listDpsDivisionRanksMongo());
      return;
    }
    const result = await pool.query(
      `SELECT ${DIVISION_RANK_SELECT}
       FROM dps_division_ranks ORDER BY sort_order, id`
    );
    res.json(result.rows);
  } catch (err) {
    _req.log.error({ err }, "division-ranks GET error");
    res.status(500).json({ error: "Unable to load division ranks." });
  }
});

router.get("/roster/division-ranks/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid id." }); return; }
  try {
    if (isMongoStore()) {
      try {
        const detail = await getDpsDivisionRankDetailMongo(id);
        if (!detail) { res.status(404).json({ error: "Division rank not found." }); return; }
        res.json(detail);
        return;
      } catch (mongoErr) {
        req.log.warn({ err: mongoErr }, "division-ranks/:id mongo loader failed — falling back to SQL bridge");
      }
    }
    const rankRes = await pool.query(
      `SELECT ${DIVISION_RANK_SELECT} FROM dps_division_ranks WHERE id = $1`, [id]
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
       FROM dps_division_rank_custom_callsigns cc
       LEFT JOIN cad_user_profiles p ON p.id = cc.assigned_profile_id
       LEFT JOIN dps_users d ON d.profile_id = p.id
       WHERE cc.division_rank_id = $1
       ORDER BY cc.sort_order, cc.id`,
      [id]
    );
    res.json({ ...rank, members, custom_callsigns: csRes.rows });
  } catch (err) {
    req.log.error({ err }, "division-ranks GET :id error");
    res.status(500).json({ error: "Unable to load division rank." });
  }
});

router.post("/roster/division-ranks", async (req, res) => {
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
      `SELECT COALESCE(MAX(sort_order), -1) AS mx FROM dps_division_ranks
       WHERE (division_id = $1 OR (division_id IS NULL AND $1 IS NULL))`,
      [division_id ?? null]
    );
    const next = Number(maxRes.rows[0]?.mx ?? -1) + 1;
    const csMin = callsign_min !== undefined && callsign_min !== null ? (parseInt(String(callsign_min)) || 0) : null;
    const csMax = callsign_max !== undefined && callsign_max !== null ? (parseInt(String(callsign_max)) || 0) : null;
    await pool.query(
      `INSERT INTO dps_division_ranks
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
       FROM dps_division_ranks
       WHERE lower(name) = lower($1)
         AND (division_id = $2 OR (division_id IS NULL AND $2 IS NULL))
       ORDER BY id DESC LIMIT 1`,
      [name.trim(), division_id ?? null]
    );
    if (discord_role_id?.trim()) void syncDivisionDiscordRoles().catch(console.error);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    req.log.error({ err }, "division-ranks POST error");
    res.status(500).json({ error: "Unable to create division rank." });
  }
});

router.post("/roster/division-ranks/reorder", async (req, res) => {
  const { ids } = req.body as { ids?: number[] };
  if (!Array.isArray(ids) || ids.length === 0) { res.status(400).json({ error: "ids must be a non-empty array." }); return; }
  try {
    await Promise.all(ids.map((id, i) =>
      pool.query(`UPDATE dps_division_ranks SET sort_order = $2 WHERE id = $1`, [id, i])
    ));
    const result = await pool.query(
      `SELECT ${DIVISION_RANK_SELECT}
       FROM dps_division_ranks WHERE id = ANY($1) ORDER BY sort_order`,
      [ids]
    );
    res.json(result.rows);
  } catch (err) {
    req.log.error({ err }, "division-ranks reorder error");
    res.status(500).json({ error: "Unable to reorder division ranks." });
  }
});

router.patch("/roster/division-ranks/:id", async (req, res) => {
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
      `SELECT name, division_id FROM dps_division_ranks WHERE id = $1`, [id]
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
        `UPDATE dps_division_ranks SET
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
          `UPDATE dps_user_divisions SET division_rank = $2
           WHERE lower(division_rank) = lower($1)
             AND (division_id = $3 OR (division_id IS NULL AND $3 IS NULL))`,
          [oldName, name.trim(), oldDivisionId]
        );
        await pool.query(
          `UPDATE dps_users SET division_rank = $2 WHERE lower(division_rank) = lower($1)`,
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
      if (discord_role_id !== undefined) void syncDivisionDiscordRoles().catch(console.error);
    }

    if (move === "up" || move === "down") {
      const current = await pool.query(`SELECT id, sort_order, division_id FROM dps_division_ranks WHERE id = $1`, [id]);
      const row = current.rows[0];
      if (row) {
        const neighbor = await pool.query(
          move === "up"
            ? `SELECT id, sort_order FROM dps_division_ranks
               WHERE (division_id = $1 OR (division_id IS NULL AND $1 IS NULL)) AND sort_order < $2
               ORDER BY sort_order DESC LIMIT 1`
            : `SELECT id, sort_order FROM dps_division_ranks
               WHERE (division_id = $1 OR (division_id IS NULL AND $1 IS NULL)) AND sort_order > $2
               ORDER BY sort_order ASC LIMIT 1`,
          [row.division_id, row.sort_order]
        );
        if (neighbor.rows.length) {
          const n = neighbor.rows[0];
          await pool.query(
            `UPDATE dps_division_ranks SET sort_order = CASE WHEN id = $1 THEN $3 WHEN id = $2 THEN $4 END WHERE id IN ($1, $2)`,
            [id, n.id, n.sort_order, row.sort_order]
          );
        }
      }
    }

    const result = await pool.query(
      `SELECT ${DIVISION_RANK_SELECT}
       FROM dps_division_ranks WHERE id = $1`,
      [id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    req.log.error({ err }, "division-ranks PATCH error");
    res.status(500).json({ error: "Unable to update division rank." });
  }
});

router.post("/roster/division-ranks/:id/auto-assign-callsigns", async (req, res) => {
  const rankId = Number(req.params.id);
  if (!Number.isInteger(rankId) || rankId <= 0) { res.status(400).json({ error: "Invalid id." }); return; }
  try {
    const rankRes = await pool.query<{
      name: string; division_id: number | null; callsign_type: string | null;
      callsign_prefix: string | null; callsign_min: number | null; callsign_max: number | null;
    }>(
      `SELECT name, division_id, callsign_type, callsign_prefix, callsign_min, callsign_max
       FROM dps_division_ranks WHERE id = $1`, [rankId]
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
        results.push({ profile_id: member.id, callsign: member.callsign ?? "4D-XX" });
        continue;
      }
      const callsign = join(String(next).padStart(padLen, "0"));
      await pool.query(`UPDATE dps_users SET callsign = $2 WHERE profile_id = $1`, [member.id, callsign]);
      usedNums.add(next);
      results.push({ profile_id: member.id, callsign });
      next++;
    }

    res.json({ results });
  } catch (err) {
    req.log.error({ err }, "division auto-assign-callsigns error");
    res.status(500).json({ error: "Unable to auto-assign callsigns." });
  }
});

router.post("/roster/division-ranks/:id/custom-callsigns/reorder", async (req, res) => {
  const rankId = Number(req.params.id);
  if (!Number.isInteger(rankId) || rankId <= 0) { res.status(400).json({ error: "Invalid id." }); return; }
  const { ids } = req.body as { ids?: number[] };
  if (!Array.isArray(ids)) { res.status(400).json({ error: "ids required." }); return; }
  try {
    await Promise.all(ids.map((csId, i) =>
      pool.query(
        `UPDATE dps_division_rank_custom_callsigns SET sort_order = $2 WHERE id = $1 AND division_rank_id = $3`,
        [csId, i, rankId]
      )
    ));
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "division custom-callsigns reorder error");
    res.status(500).json({ error: "Unable to reorder custom callsigns." });
  }
});

router.post("/roster/division-ranks/:id/custom-callsigns", async (req, res) => {
  const rankId = Number(req.params.id);
  if (!Number.isInteger(rankId) || rankId <= 0) { res.status(400).json({ error: "Invalid id." }); return; }
  const { callsign } = req.body as { callsign?: string };
  if (!callsign?.trim()) { res.status(400).json({ error: "Callsign is required." }); return; }
  try {
    const maxRes = await pool.query<{ mx: number }>(
      `SELECT COALESCE(MAX(sort_order), -1) + 1 AS mx FROM dps_division_rank_custom_callsigns WHERE division_rank_id = $1`,
      [rankId]
    );
    const nextOrder = Number(maxRes.rows[0]?.mx ?? 0);
    const result = await pool.query(
      `INSERT INTO dps_division_rank_custom_callsigns (division_rank_id, callsign, sort_order)
       VALUES ($1, $2, $3)
       RETURNING id, division_rank_id, callsign, assigned_profile_id, sort_order, NULL::text AS assigned_username`,
      [rankId, callsign.trim(), nextOrder]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    req.log.error({ err }, "division custom-callsigns POST error");
    res.status(500).json({ error: "Unable to add custom callsign." });
  }
});

router.patch("/roster/division-rank-callsigns/:csId", async (req, res) => {
  const csId = Number(req.params.csId);
  if (!Number.isInteger(csId) || csId <= 0) { res.status(400).json({ error: "Invalid id." }); return; }
  const { callsign, assigned_profile_id } = req.body as { callsign?: string; assigned_profile_id?: number | null };
  try {
    if (callsign !== undefined) {
      if (!callsign.trim()) { res.status(400).json({ error: "Callsign cannot be empty." }); return; }
      await pool.query(`UPDATE dps_division_rank_custom_callsigns SET callsign = $2 WHERE id = $1`, [csId, callsign.trim()]);
      const asgn = await pool.query<{ assigned_profile_id: number | null }>(
        `SELECT assigned_profile_id FROM dps_division_rank_custom_callsigns WHERE id = $1`, [csId]
      );
      const pid = asgn.rows[0]?.assigned_profile_id;
      if (pid) await pool.query(`UPDATE dps_users SET callsign = $2 WHERE profile_id = $1`, [pid, callsign.trim()]);
    }
    if (assigned_profile_id !== undefined) {
      const cur = await pool.query<{ assigned_profile_id: number | null; callsign: string }>(
        `SELECT assigned_profile_id, callsign FROM dps_division_rank_custom_callsigns WHERE id = $1`, [csId]
      );
      const prevPid = cur.rows[0]?.assigned_profile_id;
      const csText = cur.rows[0]?.callsign ?? "";
      if (prevPid && prevPid !== assigned_profile_id) {
        await pool.query(`UPDATE dps_users SET callsign = '4D-XX' WHERE profile_id = $1`, [prevPid]);
      }
      await pool.query(
        `UPDATE dps_division_rank_custom_callsigns SET assigned_profile_id = $2 WHERE id = $1`,
        [csId, assigned_profile_id ?? null]
      );
      if (assigned_profile_id) {
        await pool.query(`UPDATE dps_users SET callsign = $2 WHERE profile_id = $1`, [assigned_profile_id, csText]);
      }
    }
    const updated = await pool.query(
      `SELECT cc.id, cc.division_rank_id, cc.callsign, cc.assigned_profile_id, cc.sort_order,
              COALESCE(d.username, p.username) AS assigned_username
       FROM dps_division_rank_custom_callsigns cc
       LEFT JOIN cad_user_profiles p ON p.id = cc.assigned_profile_id
       LEFT JOIN dps_users d ON d.profile_id = p.id
       WHERE cc.id = $1`, [csId]
    );
    res.json(updated.rows[0]);
  } catch (err) {
    req.log.error({ err }, "division-rank-callsigns PATCH error");
    res.status(500).json({ error: "Unable to update custom callsign." });
  }
});

router.delete("/roster/division-rank-callsigns/:csId", async (req, res) => {
  const csId = Number(req.params.csId);
  if (!Number.isInteger(csId) || csId <= 0) { res.status(400).json({ error: "Invalid id." }); return; }
  try {
    const cur = await pool.query<{ assigned_profile_id: number | null }>(
      `SELECT assigned_profile_id FROM dps_division_rank_custom_callsigns WHERE id = $1`, [csId]
    );
    const pid = cur.rows[0]?.assigned_profile_id;
    if (pid) await pool.query(`UPDATE dps_users SET callsign = '4D-XX' WHERE profile_id = $1`, [pid]);
    await pool.query(`DELETE FROM dps_division_rank_custom_callsigns WHERE id = $1`, [csId]);
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "division-rank-callsigns DELETE error");
    res.status(500).json({ error: "Unable to delete custom callsign." });
  }
});

router.delete("/roster/division-ranks/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid id." }); return; }
  try {
    const cur = await pool.query<{ name: string; division_id: number | null }>(
      `SELECT name, division_id FROM dps_division_ranks WHERE id = $1`, [id]
    );
    if (cur.rows.length) {
      const rankName = cur.rows[0].name;
      const affected = await pool.query<{ profile_id: number }>(
        `SELECT DISTINCT profile_id FROM dps_user_divisions WHERE lower(division_rank) = lower($1)
         UNION
         SELECT profile_id FROM dps_users WHERE lower(division_rank) = lower($1)`,
        [rankName]
      );
      await pool.query(
        `DELETE FROM dps_user_divisions WHERE lower(division_rank) = lower($1)`,
        [rankName]
      );
      await pool.query(
        `UPDATE dps_users SET division_rank = NULL WHERE lower(division_rank) = lower($1)`,
        [rankName]
      );
      for (const row of affected.rows) {
        const remaining = await loadDivisionAssignments([row.profile_id]);
        const list = remaining.get(row.profile_id) ?? [];
        await pool.query(
          `UPDATE dps_users SET division_rank = $2 WHERE profile_id = $1`,
          [row.profile_id, list[0]?.division_rank ?? null]
        );
        await syncPersonnelUnitsFromAssignments(row.profile_id);
      }
    }
    await pool.query(`DELETE FROM dps_division_ranks WHERE id = $1`, [id]);
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "division-ranks DELETE error");
    res.status(500).json({ error: "Unable to delete division rank." });
  }
});

// ── Fleet (DPS vehicle roster) ────────────────────────────────────────────────
const parseTextArray = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch { /* fall through */ }
    // Postgres array literal: {a,b} or plain CSV
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      return trimmed.slice(1, -1).split(",").map(s => s.replace(/^"|"$/g, "").trim()).filter(Boolean);
    }
    return trimmed.split(",").map(s => s.trim()).filter(Boolean);
  }
  return [];
};

const normalizeFleetRow = (row: Record<string, unknown>) => ({
  ...row,
  who_can_drive: parseTextArray(row.who_can_drive),
  restrict_to_divisions: parseTextArray(row.restrict_to_divisions),
  liveries: parseTextArray(row.liveries),
});

router.get("/roster/vehicles", async (_req, res) => {
  try {
    if (isMongoStore()) {
      const rows = await listDpsFleetMongo();
      res.json(rows.map((row) => normalizeFleetRow(row)));
      return;
    }
    const result = await pool.query(
      `SELECT id, name, year, category, category_sort, image_url,
              image_scale, image_position_x, image_position_y,
              who_can_drive, restrict_to_divisions, liveries, notes, sort_order
       FROM dps_fleet
       ORDER BY category_sort, category, sort_order, id`
    );
    res.json(result.rows.map((row) => normalizeFleetRow(row as Record<string, unknown>)));
  } catch (err) {
    _req.log.error({ err }, "roster/vehicles GET error");
    res.status(500).json({ error: "Unable to load fleet." });
  }
});

router.post("/roster/fleet", async (req, res) => {
  const { name, year = null, category = "General", category_sort = 0, image_url = null,
          image_scale = 1, image_position_x = 50, image_position_y = 50,
          who_can_drive = [], restrict_to_divisions = [], liveries = [], notes = null, sort_order = 0 } =
    req.body as Record<string, unknown>;
  if (!name || typeof name !== "string" || !name.trim()) {
    res.status(400).json({ error: "Vehicle name is required." }); return;
  }
  try {
    const result = await pool.query(
      `INSERT INTO dps_fleet (name, year, category, category_sort, image_url, image_scale, image_position_x, image_position_y, who_can_drive, restrict_to_divisions, liveries, notes, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING id, name, year, category, category_sort, image_url, image_scale, image_position_x, image_position_y, who_can_drive, restrict_to_divisions, liveries, notes, sort_order`,
      [name.trim(), year || null, String(category).trim(), Number(category_sort),
       image_url || null, Number(image_scale) || 1, Number(image_position_x) ?? 50, Number(image_position_y) ?? 50,
       who_can_drive, restrict_to_divisions, liveries, notes || null, Number(sort_order)]
    );
    const actor = (req.body as Record<string, unknown>).actor as string || (req.headers['x-actor'] as string) || 'Admin';
    await writeLog('dps_vehicles', actor, 'Added vehicle', `${result.rows[0].name} — ${result.rows[0].category}`);
    res.status(201).json(normalizeFleetRow(result.rows[0] as Record<string, unknown>));
  } catch (err) {
    res.status(500).json({ error: "Unable to add vehicle." });
  }
});

router.patch("/roster/fleet/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { name, year, category, category_sort, image_url, image_scale, image_position_x, image_position_y,
          who_can_drive, restrict_to_divisions, liveries, notes, sort_order } =
    req.body as Record<string, unknown>;
  try {
    const result = await pool.query(
      `UPDATE dps_fleet SET
         name                 = COALESCE($1, name),
         year                 = $2,
         category             = COALESCE($3, category),
         category_sort        = COALESCE($4, category_sort),
         image_url            = $5,
         image_scale          = COALESCE($6, image_scale),
         image_position_x     = COALESCE($7, image_position_x),
         image_position_y     = COALESCE($8, image_position_y),
         who_can_drive        = COALESCE($9, who_can_drive),
         restrict_to_divisions= COALESCE($10, restrict_to_divisions),
         liveries             = COALESCE($11, liveries),
         notes                = $12,
         sort_order           = COALESCE($13, sort_order)
       WHERE id = $14
       RETURNING id, name, year, category, category_sort, image_url, image_scale, image_position_x, image_position_y, who_can_drive, restrict_to_divisions, liveries, notes, sort_order`,
      [name ?? null, year ?? null, category ?? null,
       category_sort != null ? Number(category_sort) : null,
       image_url ?? null,
       image_scale != null ? Number(image_scale) : null,
       image_position_x != null ? Number(image_position_x) : null,
       image_position_y != null ? Number(image_position_y) : null,
       who_can_drive ?? null, restrict_to_divisions ?? null,
       liveries ?? null, notes ?? null,
       sort_order != null ? Number(sort_order) : null, id]
    );
    if ((result.rowCount ?? 0) === 0) { res.status(404).json({ error: "Vehicle not found." }); return; }
    const actor = (req.body as Record<string, unknown>).actor as string || (req.headers['x-actor'] as string) || 'Admin';
    await writeLog('dps_vehicles', actor, 'Updated vehicle', result.rows[0].name);
    res.json(normalizeFleetRow(result.rows[0] as Record<string, unknown>));
  } catch (err) {
    res.status(500).json({ error: "Unable to update vehicle." });
  }
});

router.delete("/roster/fleet/:id", async (req, res) => {
  const id = Number(req.params.id);
  try {
    const result = await pool.query(`DELETE FROM dps_fleet WHERE id=$1 RETURNING id`, [id]);
    if ((result.rowCount ?? 0) === 0) { res.status(404).json({ error: "Vehicle not found." }); return; }
    const deletedName = result.rows[0]?.name ?? String(id);
    const actor = (req.headers['x-actor'] as string) || 'Admin';
    await writeLog('dps_vehicles', actor, 'Deleted vehicle', deletedName);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Unable to delete vehicle." });
  }
});

// ── Fleet categories ──────────────────────────────────────────────────────────
router.get("/roster/fleet/categories", async (_req, res) => {
  try {
    if (isMongoStore()) {
      res.json(await listDpsFleetCategoriesMongo());
      return;
    }
    const r = await pool.query(`SELECT id, name, sort_order FROM dps_fleet_categories ORDER BY sort_order, id`);
    res.json(r.rows);
  } catch { res.status(500).json({ error: "Unable to load categories." }); }
});

router.post("/roster/fleet/categories", async (req, res) => {
  const { name } = req.body as { name?: string };
  if (!name?.trim()) { res.status(400).json({ error: "Category name required." }); return; }
  try {
    const mx = await pool.query(`SELECT COALESCE(MAX(sort_order),-1) AS m FROM dps_fleet_categories`);
    const r = await pool.query(
      `INSERT INTO dps_fleet_categories (name, sort_order) VALUES ($1,$2) RETURNING id, name, sort_order`,
      [name.trim(), (mx.rows[0].m as number) + 1]
    );
    res.status(201).json(r.rows[0]);
  } catch { res.status(500).json({ error: "Unable to add category." }); }
});

router.patch("/roster/fleet/categories/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { name } = req.body as { name?: string };
  if (!name?.trim()) { res.status(400).json({ error: "Category name required." }); return; }
  try {
    const old = await pool.query(`SELECT name FROM dps_fleet_categories WHERE id=$1`, [id]);
    if ((old.rowCount ?? 0) === 0) { res.status(404).json({ error: "Category not found." }); return; }
    await pool.query(`UPDATE dps_fleet SET category=$1 WHERE category=$2`, [name.trim(), old.rows[0].name]);
    const r = await pool.query(
      `UPDATE dps_fleet_categories SET name=$1 WHERE id=$2 RETURNING id, name, sort_order`,
      [name.trim(), id]
    );
    res.json(r.rows[0]);
  } catch { res.status(500).json({ error: "Unable to rename category." }); }
});

router.delete("/roster/fleet/categories/:id", async (req, res) => {
  const id = Number(req.params.id);
  try {
    const cat = await pool.query(`SELECT name FROM dps_fleet_categories WHERE id=$1`, [id]);
    if ((cat.rowCount ?? 0) === 0) { res.status(404).json({ error: "Category not found." }); return; }
    await pool.query(`DELETE FROM dps_fleet WHERE category=$1`, [cat.rows[0].name]);
    await pool.query(`DELETE FROM dps_fleet_categories WHERE id=$1`, [id]);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: "Unable to delete category." }); }
});

router.post("/roster/fleet/reorder", async (req, res) => {
  const { ids } = req.body as { ids?: number[] };
  if (!Array.isArray(ids)) { res.status(400).json({ error: "ids[] required." }); return; }
  try {
    await Promise.all(ids.map((id, i) =>
      pool.query(`UPDATE dps_fleet SET sort_order=$1 WHERE id=$2`, [i, id])
    ));
    res.json({ ok: true });
  } catch { res.status(500).json({ error: "Unable to reorder vehicles." }); }
});

router.post("/roster/fleet/categories/reorder", async (req, res) => {
  const { ordered } = req.body as { ordered?: number[] };
  if (!Array.isArray(ordered)) { res.status(400).json({ error: "ordered[] required." }); return; }
  try {
    await Promise.all(ordered.map((id, i) =>
      pool.query(`UPDATE dps_fleet_categories SET sort_order=$1 WHERE id=$2`, [i, id])
    ));
    res.json({ ok: true });
  } catch { res.status(500).json({ error: "Unable to reorder categories." }); }
});

// ── Equipment (DPS equipment roster) ──────────────────────────────────────────
router.get("/roster/equipment", async (_req, res) => {
  try {
    if (isMongoStore()) {
      res.json(await listDpsEquipmentMongo());
      return;
    }
    const result = await pool.query(
      `SELECT id, name, quantity, category, category_sort, image_url,
              image_scale, image_position_x, image_position_y,
              who_can_use, restrict_to_divisions, notes, sort_order
       FROM dps_equipment
       ORDER BY category_sort, category, sort_order, id`
    );
    res.json(result.rows);
  } catch { res.status(500).json({ error: "Unable to load equipment." }); }
});

router.post("/roster/equipment", async (req, res) => {
  const { name, quantity = null, category = "General", category_sort = 0, image_url = null,
          image_scale = 1, image_position_x = 50, image_position_y = 50,
          who_can_use = [], restrict_to_divisions = [], notes = null, sort_order = 0 } =
    req.body as Record<string, unknown>;
  if (!name || typeof name !== "string" || !name.trim()) {
    res.status(400).json({ error: "Equipment name is required." }); return;
  }
  try {
    const result = await pool.query(
      `INSERT INTO dps_equipment (name, quantity, category, category_sort, image_url, image_scale, image_position_x, image_position_y, who_can_use, restrict_to_divisions, notes, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING id, name, quantity, category, category_sort, image_url, image_scale, image_position_x, image_position_y, who_can_use, restrict_to_divisions, notes, sort_order`,
      [name.trim(), quantity || null, String(category).trim(), Number(category_sort),
       image_url || null, Number(image_scale) || 1, Number(image_position_x) ?? 50, Number(image_position_y) ?? 50,
       who_can_use, restrict_to_divisions, notes || null, Number(sort_order)]
    );
    const actor = (req.body as Record<string, unknown>).actor as string || (req.headers['x-actor'] as string) || 'Admin';
    await writeLog('dps_equipment', actor, 'Added equipment', `${result.rows[0].name} — ${result.rows[0].category}`);
    res.status(201).json(result.rows[0]);
  } catch { res.status(500).json({ error: "Unable to add equipment." }); }
});

router.patch("/roster/equipment/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { name, quantity, category, category_sort, image_url, image_scale, image_position_x, image_position_y,
          who_can_use, restrict_to_divisions, notes, sort_order } =
    req.body as Record<string, unknown>;
  try {
    const result = await pool.query(
      `UPDATE dps_equipment SET
         name                  = COALESCE($1, name),
         quantity              = $2,
         category              = COALESCE($3, category),
         category_sort         = COALESCE($4, category_sort),
         image_url             = $5,
         image_scale           = COALESCE($6, image_scale),
         image_position_x      = COALESCE($7, image_position_x),
         image_position_y      = COALESCE($8, image_position_y),
         who_can_use           = COALESCE($9, who_can_use),
         restrict_to_divisions = COALESCE($10, restrict_to_divisions),
         notes                 = $11,
         sort_order            = COALESCE($12, sort_order)
       WHERE id = $13
       RETURNING id, name, quantity, category, category_sort, image_url, image_scale, image_position_x, image_position_y, who_can_use, restrict_to_divisions, notes, sort_order`,
      [name ?? null, quantity ?? null, category ?? null,
       category_sort != null ? Number(category_sort) : null,
       image_url ?? null,
       image_scale != null ? Number(image_scale) : null,
       image_position_x != null ? Number(image_position_x) : null,
       image_position_y != null ? Number(image_position_y) : null,
       who_can_use ?? null, restrict_to_divisions ?? null,
       notes ?? null, sort_order != null ? Number(sort_order) : null, id]
    );
    if ((result.rowCount ?? 0) === 0) { res.status(404).json({ error: "Equipment not found." }); return; }
    const actor = (req.body as Record<string, unknown>).actor as string || (req.headers['x-actor'] as string) || 'Admin';
    await writeLog('dps_equipment', actor, 'Updated equipment', result.rows[0].name);
    res.json(result.rows[0]);
  } catch { res.status(500).json({ error: "Unable to update equipment." }); }
});

router.delete("/roster/equipment/:id", async (req, res) => {
  const id = Number(req.params.id);
  try {
    const result = await pool.query(`DELETE FROM dps_equipment WHERE id=$1 RETURNING name`, [id]);
    if ((result.rowCount ?? 0) === 0) { res.status(404).json({ error: "Equipment not found." }); return; }
    const actor = (req.headers['x-actor'] as string) || 'Admin';
    await writeLog('dps_equipment', actor, 'Deleted equipment', result.rows[0]?.name ?? String(id));
    res.json({ ok: true });
  } catch { res.status(500).json({ error: "Unable to delete equipment." }); }
});

// ── Equipment categories ──────────────────────────────────────────────────────
router.get("/roster/equipment/categories", async (_req, res) => {
  try {
    if (isMongoStore()) {
      res.json(await listDpsEquipmentCategoriesMongo());
      return;
    }
    const r = await pool.query(`SELECT id, name, sort_order FROM dps_equipment_categories ORDER BY sort_order, id`);
    res.json(r.rows);
  } catch { res.status(500).json({ error: "Unable to load equipment categories." }); }
});

router.post("/roster/equipment/categories", async (req, res) => {
  const { name } = req.body as { name?: string };
  if (!name?.trim()) { res.status(400).json({ error: "Category name required." }); return; }
  try {
    const mx = await pool.query(`SELECT COALESCE(MAX(sort_order),-1) AS m FROM dps_equipment_categories`);
    const r = await pool.query(
      `INSERT INTO dps_equipment_categories (name, sort_order) VALUES ($1,$2) RETURNING id, name, sort_order`,
      [name.trim(), (mx.rows[0].m as number) + 1]
    );
    res.status(201).json(r.rows[0]);
  } catch { res.status(500).json({ error: "Unable to add equipment category." }); }
});

router.patch("/roster/equipment/categories/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { name } = req.body as { name?: string };
  if (!name?.trim()) { res.status(400).json({ error: "Category name required." }); return; }
  try {
    const old = await pool.query(`SELECT name FROM dps_equipment_categories WHERE id=$1`, [id]);
    if ((old.rowCount ?? 0) === 0) { res.status(404).json({ error: "Category not found." }); return; }
    await pool.query(`UPDATE dps_equipment SET category=$1 WHERE category=$2`, [name.trim(), old.rows[0].name]);
    const r = await pool.query(
      `UPDATE dps_equipment_categories SET name=$1 WHERE id=$2 RETURNING id, name, sort_order`,
      [name.trim(), id]
    );
    res.json(r.rows[0]);
  } catch { res.status(500).json({ error: "Unable to rename equipment category." }); }
});

router.delete("/roster/equipment/categories/:id", async (req, res) => {
  const id = Number(req.params.id);
  try {
    const cat = await pool.query(`SELECT name FROM dps_equipment_categories WHERE id=$1`, [id]);
    if ((cat.rowCount ?? 0) === 0) { res.status(404).json({ error: "Category not found." }); return; }
    await pool.query(`DELETE FROM dps_equipment WHERE category=$1`, [cat.rows[0].name]);
    await pool.query(`DELETE FROM dps_equipment_categories WHERE id=$1`, [id]);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: "Unable to delete equipment category." }); }
});

router.post("/roster/equipment/reorder", async (req, res) => {
  const { ids } = req.body as { ids?: number[] };
  if (!Array.isArray(ids)) { res.status(400).json({ error: "ids[] required." }); return; }
  try {
    await Promise.all(ids.map((id, i) =>
      pool.query(`UPDATE dps_equipment SET sort_order=$1 WHERE id=$2`, [i, id])
    ));
    res.json({ ok: true });
  } catch { res.status(500).json({ error: "Unable to reorder equipment." }); }
});

router.post("/roster/equipment/categories/reorder", async (req, res) => {
  const { ordered } = req.body as { ordered?: number[] };
  if (!Array.isArray(ordered)) { res.status(400).json({ error: "ordered[] required." }); return; }
  try {
    await Promise.all(ordered.map((id, i) =>
      pool.query(`UPDATE dps_equipment_categories SET sort_order=$1 WHERE id=$2`, [i, id])
    ));
    res.json({ ok: true });
  } catch { res.status(500).json({ error: "Unable to reorder equipment categories." }); }
});

// ── GET /roster/events ─────────────────────────────────────────────────────────
router.get("/roster/events", async (req, res) => {
  try {
    const publicOnly = req.query.public === "true";
    if (isMongoStore()) {
      res.json(await listDpsEventsMongo(publicOnly));
      return;
    }
    const result = await pool.query(
      `SELECT id, title, TO_CHAR(event_date, 'YYYY-MM-DD') AS event_date,
              event_time, location, purpose, hosted_by, hosting_department,
              is_public, created_at
       FROM dps_events
       ${publicOnly ? "WHERE is_public = true" : ""}
       ORDER BY event_date ASC, event_time ASC NULLS LAST`
    );
    res.json(result.rows.map((row: Record<string, unknown>) => ({
      ...row,
      hosting_department: row.hosting_department || "Department of Public Safety",
      is_public: Boolean(row.is_public),
    })));
  } catch (err) {
    res.status(500).json({ error: "Unable to load events." });
  }
});

// ── POST /roster/events ────────────────────────────────────────────────────────
router.post("/roster/events", async (req, res) => {
  const { title, event_date, event_time, location, purpose, is_public, hosted_by, hosting_department } = req.body as {
    title?: string; event_date?: string; event_time?: string;
    location?: string; purpose?: string; is_public?: boolean;
    hosted_by?: string; hosting_department?: string;
  };
  if (!title?.trim() || !event_date) {
    res.status(400).json({ error: "title and event_date are required." }); return;
  }
  const dept = (hosting_department?.trim() || "Department of Public Safety");
  try {
    const r = await pool.query(
      `INSERT INTO dps_events (title, event_date, event_time, location, purpose, is_public, hosted_by, hosting_department)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, title, TO_CHAR(event_date, 'YYYY-MM-DD') AS event_date,
                 event_time, location, purpose, hosted_by, hosting_department, is_public, created_at`,
      [
        title.trim(), event_date, event_time || null, location?.trim() || null, purpose?.trim() || null,
        is_public === true, hosted_by?.trim() || null, dept,
      ]
    );
    res.status(201).json({ ...r.rows[0], is_public: Boolean(r.rows[0].is_public) });
  } catch (err) {
    req.log.error({ err }, "roster/events POST error");
    res.status(500).json({ error: "Unable to create event." });
  }
});

// ── PATCH /roster/events/:id ───────────────────────────────────────────────────
router.patch("/roster/events/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid id." }); return; }
  const { title, event_date, event_time, location, purpose, is_public, hosted_by, hosting_department } = req.body as {
    title?: string; event_date?: string; event_time?: string;
    location?: string; purpose?: string; is_public?: boolean;
    hosted_by?: string; hosting_department?: string;
  };
  if (!title?.trim() || !event_date) {
    res.status(400).json({ error: "title and event_date are required." }); return;
  }
  const dept = (hosting_department?.trim() || "Department of Public Safety");
  try {
    const r = await pool.query(
      `UPDATE dps_events SET title=$1, event_date=$2, event_time=$3, location=$4, purpose=$5, is_public=$6,
         hosted_by=$7, hosting_department=$8
       WHERE id=$9
       RETURNING id, title, TO_CHAR(event_date, 'YYYY-MM-DD') AS event_date,
                 event_time, location, purpose, hosted_by, hosting_department, is_public, created_at`,
      [
        title.trim(), event_date, event_time || null, location?.trim() || null, purpose?.trim() || null,
        is_public === true, hosted_by?.trim() || null, dept, id,
      ]
    );
    if ((r.rowCount ?? 0) === 0) { res.status(404).json({ error: "Event not found." }); return; }
    res.json({ ...r.rows[0], is_public: Boolean(r.rows[0].is_public) });
  } catch (err) {
    res.status(500).json({ error: "Unable to update event." });
  }
});

// ── DELETE /roster/events/:id ──────────────────────────────────────────────────
router.delete("/roster/events/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid id." }); return; }
  try {
    await pool.query(`DELETE FROM dps_events WHERE id=$1`, [id]);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Unable to delete event." });
  }
});

// ── GET /roster/content/:key ───────────────────────────────────────────────────
router.get("/roster/content/:key", async (req, res) => {
  const allowed = ['index_info', 'page_info'];
  if (!allowed.includes(req.params.key)) { res.status(400).json({ error: "Invalid key." }); return; }
  try {
    if (isMongoStore()) {
      res.json(await getDpsContentMongo(req.params.key));
      return;
    }
    const r = await pool.query(`SELECT content FROM dps_content WHERE key=$1`, [req.params.key]);
    res.json(r.rows[0]?.content ?? {});
  } catch { res.status(500).json({ error: "Failed to load content." }); }
});

// ── PUT /roster/content/:key ────────────────────────────────────────────────────
router.put("/roster/content/:key", async (req, res) => {
  const allowed = ['index_info', 'page_info'];
  if (!allowed.includes(req.params.key)) { res.status(400).json({ error: "Invalid key." }); return; }
  try {
    // No explicit ::jsonb cast — Postgres infers jsonb from the target column,
    // and the SQLite shim has no `::` cast syntax.
    await pool.query(
      `INSERT INTO dps_content (key, content) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET content = EXCLUDED.content`,
      [req.params.key, JSON.stringify(req.body)]
    );
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "roster/content PUT error");
    res.status(500).json({ error: "Failed to save content." });
  }
});

export default router;
