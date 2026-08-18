import { Router } from "express";
import { isUniqueViolation, isMongoStore, pool, getCollection, nextId } from "@workspace/db";
import { writeLog } from "../lib/audit-log.js";
import { wantsDiscordRolesRefresh } from "../lib/discord-guild-roles-cache.js";
import {
  type DphGuildMember,
  DPH_DIVISION_GUILD_ID,
  DPH_GUILD_ID,
  ensureCadProfileForDphDiscordMember,
  fetchDphGuildMembers,
  getDphGuildRoles,
  refreshCadAvatarsFromGuildMembers,
} from "../lib/dph-discord.js";
import { registerDiscordGuildSync } from "../lib/discord-realtime-sync.js";
import { sortByCallsignThenUsername, sortDepartmentPersonnel } from "../lib/roster-sort.js";
import { buildLinkedRankByRoleId, pickHighestLinkedDiscordRole } from "../lib/discord-rank-pick.js";
import {
  DPH_DEFAULT_CALLSIGN,
  loadDphDivisionAssignments,
  migrateLegacyDphDivisionAssignments,
  setDphMemberDivisionAssignments,
  type DphDivisionAssignment,
} from "../lib/dph-divisions.js";
import {
  buildDivisionDiscordMembershipMap,
  divisionDiscordLinksForMember,
  loadDivisionLinkConfig,
  type DivisionDiscordEnrichment,
} from "../lib/division-discord-qualify.js";
import { fetchDphDivisionGuildMembers } from "../lib/dph-discord.js";
import { syncDphDivisionDiscordRoles, pruneDphDivisionRosterDebounced } from "./dph-divisions.js";
import {
  clearAllDphPermissionGrants,
  dphRosterRowExists,
  resetDphMemberAccessPermissions,
  resetDphMemberPermissionGrants,
} from "../lib/department-permissions.js";
import { normalizeGroupRow, normalizeRankRow } from "../lib/roster-normalize.js";

const router = Router();

const DEFAULT_DPH_RANK_GROUPS = [
  { name: "Command Staff", sort_order: 0, panel_access: true },
  { name: "Personnel", sort_order: 1, panel_access: false },
] as const;

/** Idempotent default title groups — runs on Mongo (Postgres migration skips when mongo). */
async function ensureDefaultDphRankGroups(): Promise<void> {
  try {
    if (isMongoStore()) {
      const col = await getCollection("dph_rank_groups");
      for (const g of DEFAULT_DPH_RANK_GROUPS) {
        const escaped = g.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const exists = await col.findOne({
          name: { $regex: new RegExp(`^${escaped}$`, "i") },
        });
        if (exists) continue;
        const id = await nextId("dph_rank_groups");
        await col.insertOne({
          id,
          name: g.name,
          sort_order: g.sort_order,
          panel_access: g.panel_access,
          division_oversight: false,
        });
      }
      return;
    }
    for (const g of DEFAULT_DPH_RANK_GROUPS) {
      await pool.query(
        `INSERT INTO dph_rank_groups (name, sort_order, panel_access)
         SELECT $1, $2, $3
         WHERE NOT EXISTS (SELECT 1 FROM dph_rank_groups WHERE lower(name) = lower($1))`,
        [g.name, g.sort_order, g.panel_access],
      );
    }
  } catch (err) {
    console.error("[dph] default rank groups seed failed:", err);
  }
}

// ── One-time migration: create dph tables ─────────────────────────────────────
(async () => {
  if (isMongoStore()) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dph_rank_groups (
        id         serial PRIMARY KEY,
        name       text NOT NULL UNIQUE,
        sort_order integer NOT NULL DEFAULT 0,
        panel_access boolean NOT NULL DEFAULT false
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dph_ranks (
        id              serial PRIMARY KEY,
        name            text NOT NULL UNIQUE,
        sort_order      integer NOT NULL DEFAULT 0,
        group_id        integer REFERENCES dph_rank_groups(id) ON DELETE SET NULL,
        color_hex       text,
        callsign_prefix text,
        insignia_url    text,
        discord_role_id text
      )
    `);
    await pool.query(`ALTER TABLE dph_ranks ADD COLUMN IF NOT EXISTS discord_role_id text`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dph_users (
        id             serial PRIMARY KEY,
        profile_id     integer NOT NULL REFERENCES cad_user_profiles(id) ON DELETE CASCADE,
        username       text,
        dph_rank       text,
        dph_role       text,
        callsign       text NOT NULL DEFAULT 'DPH-XX',
        status         text NOT NULL DEFAULT 'Active',
        appointed_date date,
        certifications text[] NOT NULL DEFAULT '{}',
        created_at     timestamptz NOT NULL DEFAULT NOW(),
        updated_at     timestamptz NOT NULL DEFAULT NOW(),
        UNIQUE (profile_id)
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dph_fleet_categories (
        id         serial PRIMARY KEY,
        name       text NOT NULL UNIQUE,
        sort_order integer NOT NULL DEFAULT 0
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dph_fleet (
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
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dph_equipment_categories (
        id         serial PRIMARY KEY,
        name       text NOT NULL UNIQUE,
        sort_order integer NOT NULL DEFAULT 0
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dph_equipment (
        id                    serial PRIMARY KEY,
        name                  text NOT NULL,
        quantity              text,
        category              text NOT NULL DEFAULT 'General',
        category_sort         integer NOT NULL DEFAULT 0,
        image_url             text,
        image_scale           real NOT NULL DEFAULT 1,
        image_position_x      real NOT NULL DEFAULT 50,
        image_position_y      real NOT NULL DEFAULT 50,
        who_can_use           text[] NOT NULL DEFAULT '{}',
        restrict_to_divisions text[] NOT NULL DEFAULT '{}',
        notes                 text,
        sort_order            integer NOT NULL DEFAULT 0
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dph_events (
        id         serial PRIMARY KEY,
        title      text NOT NULL,
        event_date date NOT NULL,
        event_time text,
        location   text,
        purpose    text,
        is_public  boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`ALTER TABLE dph_events ADD COLUMN IF NOT EXISTS hosted_by TEXT`);
    await pool.query(`ALTER TABLE dph_events ADD COLUMN IF NOT EXISTS hosting_department TEXT`);
    // ── Division Roster ───────────────────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dph_divisions (
        id              serial PRIMARY KEY,
        name            text NOT NULL,
        sort_order      integer NOT NULL DEFAULT 0,
        discord_role_id text,
        unit_key        text
      )
    `);
    await pool.query(`ALTER TABLE dph_divisions ADD COLUMN IF NOT EXISTS discord_role_id text`);
    await pool.query(`ALTER TABLE dph_divisions ADD COLUMN IF NOT EXISTS unit_key text`);
    await pool.query(`ALTER TABLE dph_divisions ADD COLUMN IF NOT EXISTS info_content text NOT NULL DEFAULT '{"sections":[]}'`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dph_division_ranks (
        id              serial PRIMARY KEY,
        division_id     integer REFERENCES dph_divisions(id) ON DELETE CASCADE,
        name            text NOT NULL,
        sort_order      integer NOT NULL DEFAULT 0,
        color_hex       text,
        insignia_url    text,
        discord_role_id text
      )
    `);
    await pool.query(`ALTER TABLE dph_division_ranks ADD COLUMN IF NOT EXISTS discord_role_id text`);
    await pool.query(`ALTER TABLE dph_division_ranks ADD COLUMN IF NOT EXISTS callsign_prefix text`);
    await pool.query(`ALTER TABLE dph_division_ranks ADD COLUMN IF NOT EXISTS callsign_type text`);
    await pool.query(`ALTER TABLE dph_division_ranks ADD COLUMN IF NOT EXISTS callsign_static text`);
    await pool.query(`ALTER TABLE dph_division_ranks ADD COLUMN IF NOT EXISTS callsign_min integer`);
    await pool.query(`ALTER TABLE dph_division_ranks ADD COLUMN IF NOT EXISTS callsign_max integer`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dph_division_rank_custom_callsigns (
        id                  serial PRIMARY KEY,
        division_rank_id    integer NOT NULL REFERENCES dph_division_ranks(id) ON DELETE CASCADE,
        callsign            text NOT NULL,
        assigned_profile_id integer REFERENCES cad_user_profiles(id) ON DELETE SET NULL,
        sort_order          integer NOT NULL DEFAULT 0,
        created_at          timestamptz NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dph_user_divisions (
        id                 serial PRIMARY KEY,
        profile_id         integer NOT NULL REFERENCES cad_user_profiles(id) ON DELETE CASCADE,
        division_id        integer NOT NULL REFERENCES dph_divisions(id) ON DELETE CASCADE,
        division_rank      text NOT NULL,
        is_manual          boolean NOT NULL DEFAULT false,
        can_edit_resources boolean NOT NULL DEFAULT false,
        can_edit_roster    boolean NOT NULL DEFAULT false,
        can_edit_info      boolean NOT NULL DEFAULT false,
        UNIQUE (profile_id, division_id)
      )
    `);
    await pool.query(`ALTER TABLE dph_user_divisions ADD COLUMN IF NOT EXISTS is_manual boolean NOT NULL DEFAULT false`);
    await pool.query(`ALTER TABLE dph_user_divisions ADD COLUMN IF NOT EXISTS can_edit_resources boolean NOT NULL DEFAULT false`);
    await pool.query(`ALTER TABLE dph_user_divisions ADD COLUMN IF NOT EXISTS can_edit_roster boolean NOT NULL DEFAULT false`);
    await pool.query(`ALTER TABLE dph_user_divisions ADD COLUMN IF NOT EXISTS can_edit_info boolean NOT NULL DEFAULT false`);

    // ── Department rank callsign generation (mirrors dps_ranks) ────────────────
    await pool.query(`ALTER TABLE dph_ranks ADD COLUMN IF NOT EXISTS callsign_type text`);
    await pool.query(`ALTER TABLE dph_ranks ADD COLUMN IF NOT EXISTS callsign_static text`);
    await pool.query(`ALTER TABLE dph_ranks ADD COLUMN IF NOT EXISTS callsign_min integer`);
    await pool.query(`ALTER TABLE dph_ranks ADD COLUMN IF NOT EXISTS callsign_max integer`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dph_rank_custom_callsigns (
        id                  serial PRIMARY KEY,
        rank_id             integer NOT NULL REFERENCES dph_ranks(id) ON DELETE CASCADE,
        callsign            text NOT NULL,
        assigned_profile_id integer REFERENCES cad_user_profiles(id) ON DELETE SET NULL,
        sort_order          integer NOT NULL DEFAULT 0,
        created_at          timestamptz NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`ALTER TABLE dph_rank_custom_callsigns ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0`);

    // ── Access flags ──────────────────────────────────────────────────────────
    await pool.query(`ALTER TABLE dph_users ADD COLUMN IF NOT EXISTS division_rank text`);
    await pool.query(`ALTER TABLE dph_users ADD COLUMN IF NOT EXISTS can_view_all_resources boolean NOT NULL DEFAULT false`);
    await pool.query(`ALTER TABLE dph_users ADD COLUMN IF NOT EXISTS can_access_iab boolean NOT NULL DEFAULT false`);
    await pool.query(`ALTER TABLE dph_users ADD COLUMN IF NOT EXISTS pob boolean NOT NULL DEFAULT false`);
    await pool.query(`ALTER TABLE dph_users ADD COLUMN IF NOT EXISTS iab boolean NOT NULL DEFAULT false`);
    await pool.query(`ALTER TABLE dph_users ADD COLUMN IF NOT EXISTS hsu boolean NOT NULL DEFAULT false`);
    await pool.query(`ALTER TABLE dph_users ADD COLUMN IF NOT EXISTS sru boolean NOT NULL DEFAULT false`);
    await pool.query(`ALTER TABLE dph_users ADD COLUMN IF NOT EXISTS fou boolean NOT NULL DEFAULT false`);
    await pool.query(`ALTER TABLE dph_rank_groups ADD COLUMN IF NOT EXISTS panel_access boolean NOT NULL DEFAULT false`);
    // Division oversight — group members can view all division resources/rosters
    await pool.query(`ALTER TABLE dph_rank_groups ADD COLUMN IF NOT EXISTS division_oversight boolean NOT NULL DEFAULT false`);

    // ── Page / index content blocks ───────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dph_content (
        key     text PRIMARY KEY,
        content jsonb NOT NULL DEFAULT '{}'
      )
    `);

    await migrateLegacyDphDivisionAssignments();

    await ensureDefaultDphRankGroups();
  } catch (e) {
    console.error("dph tables migration failed:", e);
  }
})();

void ensureDefaultDphRankGroups();

async function removeDphRosterMember(profileId: number): Promise<void> {
  await pool.query(`DELETE FROM dph_user_divisions WHERE profile_id = $1`, [profileId]);
  await pool.query(
    `UPDATE dph_rank_custom_callsigns SET assigned_profile_id = NULL WHERE assigned_profile_id = $1`,
    [profileId],
  );

  const profileRes = await pool.query<{ community_code: string }>(
    `SELECT community_code FROM cad_user_profiles WHERE id = $1`,
    [profileId],
  );
  const isManual = String(profileRes.rows[0]?.community_code ?? "") === "MANUAL";

  await pool.query(`DELETE FROM dph_users WHERE profile_id = $1`, [profileId]);

  if (isManual) {
    await pool.query(`DELETE FROM cad_user_profiles WHERE id = $1`, [profileId]);
  }
}

/**
 * Drop roster rows that no longer point at a real rank.
 *
 * Members reference ranks by name, so a deleted or renamed rank leaves them
 * stranded: they vanish from the roster but keep occupying the officers list.
 *
 * Skips when no ranks exist so a transient read failure cannot wipe the roster.
 */
async function pruneOrphanedDphRosterMembers(): Promise<number> {
  const ranksRes = await pool.query<{ name: string }>(`SELECT name FROM dph_ranks`);
  if (ranksRes.rows.length === 0) return 0;

  const validRanks = new Set(
    ranksRes.rows.map(r => String(r.name ?? "").trim().toLowerCase()).filter(Boolean),
  );
  if (validRanks.size === 0) return 0;

  const membersRes = await pool.query<{ profile_id: number; dph_rank: string | null }>(
    `SELECT profile_id, dph_rank FROM dph_users`,
  );

  let removed = 0;
  for (const member of membersRes.rows) {
    const rank = String(member.dph_rank ?? "").trim().toLowerCase();
    if (rank && validRanks.has(rank)) continue;
    await removeDphRosterMember(Number(member.profile_id));
    removed += 1;
  }
  if (removed > 0) {
    console.info(`[dph-prune] removed ${removed} member(s) with no matching rank`);
  }
  return removed;
}

/** Avoid hammering Mongo on parallel roster fetches from the DPH panel. */
let _lastDphRosterPruneMs = 0;
const DPH_ROSTER_PRUNE_DEBOUNCE_MS = 10_000;

async function pruneOrphanedDphRosterMembersDebounced(): Promise<number> {
  const now = Date.now();
  if (now - _lastDphRosterPruneMs < DPH_ROSTER_PRUNE_DEBOUNCE_MS) return 0;
  _lastDphRosterPruneMs = now;
  return pruneOrphanedDphRosterMembers();
}

/**
 * Remove roster members who sit on a Discord-linked rank but no longer hold that role.
 * Manual roster entries (ranks without discord_role_id) are left untouched.
 */
async function removeDphMembersWithoutLinkedDiscordRole(
  allMembers: DphGuildMember[],
  linkedRanks: Array<{ name: string; discord_role_id: string }>,
): Promise<number> {
  if (linkedRanks.length === 0) return 0;

  const linkedRoleIds = linkedRanks
    .map(r => String(r.discord_role_id ?? "").trim())
    .filter(Boolean);
  if (linkedRoleIds.length === 0) return 0;

  const activeDiscordIds = new Set<string>();
  const activeByUsername = new Set<string>();
  for (const m of allMembers) {
    if (!m.roles.some(r => linkedRoleIds.includes(r))) continue;
    activeDiscordIds.add(m.user.id);
    activeByUsername.add(m.user.username.toLowerCase());
  }

  const linkedRankNames = linkedRanks.map(r => r.name);
  const linkedRes = await pool.query<{
    profile_id: number;
    discord_id: string | null;
    discord_username: string | null;
    dph_rank: string;
  }>(
    `SELECT u.profile_id, p.discord_id, p.discord_username, u.dph_rank
     FROM dph_users u
     JOIN cad_user_profiles p ON p.id = u.profile_id
     WHERE u.dph_rank = ANY($1::text[])`,
    [linkedRankNames],
  );

  let removed = 0;
  for (const row of linkedRes.rows) {
    const stillHasRole =
      (row.discord_id != null && activeDiscordIds.has(row.discord_id)) ||
      (row.discord_id == null && row.discord_username != null &&
        activeByUsername.has(row.discord_username.toLowerCase()));
    if (stillHasRole) continue;
    await removeDphRosterMember(Number(row.profile_id));
    removed += 1;
  }
  return removed;
}

/**
 * Auto-assign a callsign from a DPH rank's callsign configuration.
 * Returns null when the rank is manual ('custom') or has nothing configured.
 */
async function autoAssignDphCallsign(rankName: string, profileId: number): Promise<string | null> {
  try {
    const res = await pool.query<{
      callsign_prefix: string | null; callsign_type: string | null;
      callsign_static: string | null; callsign_min: number | null; callsign_max: number | null;
    }>(
      `SELECT callsign_prefix, callsign_type, callsign_static, callsign_min, callsign_max
       FROM dph_ranks WHERE lower(name) = lower($1) LIMIT 1`,
      [rankName],
    );
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    const prefix = r.callsign_prefix?.trim() ?? "";
    const join = (suffix: string) => (prefix ? `${prefix}-${suffix}` : suffix);

    if (r.callsign_type === "custom") return null;
    if (!r.callsign_type || r.callsign_type === "static") {
      return r.callsign_static ? join(r.callsign_static) : null;
    }
    if (r.callsign_type === "dynamic" && r.callsign_min !== null && r.callsign_max !== null) {
      const used = await pool.query<{ callsign: string }>(
        `SELECT callsign FROM dph_users WHERE dph_rank = $1 AND profile_id != $2`,
        [rankName, profileId],
      );
      const usedNums = new Set<number>();
      for (const row of used.rows) {
        const parts = (row.callsign ?? "").split("-");
        const n = parseInt(parts[parts.length - 1], 10);
        if (!isNaN(n)) usedNums.add(n);
      }
      const padLen = Math.max(String(r.callsign_max).length, 2);
      for (let n = r.callsign_min; n <= r.callsign_max; n++) {
        if (!usedNums.has(n)) return join(String(n).padStart(padLen, "0"));
      }
      return null; // range exhausted
    }
  } catch { /* non-fatal */ }
  return null;
}

/**
 * Bulk-sync DPH callsigns when a rank's callsign settings change.
 * Static: every member on the rank gets the same callsign.
 * Dynamic: members with a valid in-range callsign keep it; others get the next
 *          available number. Custom / unconfigured ranks are left unchanged.
 */
async function syncDphCallsignsForRank(rankId: number): Promise<void> {
  try {
    const rankRes = await pool.query<{
      name: string; callsign_type: string | null; callsign_prefix: string | null;
      callsign_static: string | null; callsign_min: number | null; callsign_max: number | null;
    }>(
      `SELECT name, callsign_type, callsign_prefix, callsign_static, callsign_min, callsign_max
       FROM dph_ranks WHERE id = $1`,
      [rankId],
    );
    if (!rankRes.rows.length) return;
    const { name: rankName, callsign_type, callsign_prefix, callsign_static, callsign_min, callsign_max } =
      rankRes.rows[0];

    if (!callsign_type || callsign_type === "custom") return; // manual-only

    const prefix = callsign_prefix?.trim() ?? "";
    const join = (suffix: string) => (prefix ? `${prefix}-${suffix}` : suffix);

    const membersRes = await pool.query<{ profile_id: number; callsign: string }>(
      `SELECT profile_id, callsign FROM dph_users WHERE lower(dph_rank) = lower($1)`,
      [rankName],
    );
    if (!membersRes.rows.length) return;

    if (callsign_type === "static") {
      if (!callsign_static?.trim()) return;
      const target = join(callsign_static.trim());
      await Promise.all(membersRes.rows.map(m =>
        pool.query(
          `UPDATE dph_users SET callsign = $2, updated_at = NOW() WHERE profile_id = $1`,
          [m.profile_id, target],
        )
      ));
      return;
    }

    if (callsign_type === "dynamic" && callsign_min !== null && callsign_max !== null) {
      const padLen = Math.max(String(callsign_max).length, 2);
      const usedNums = new Set<number>();
      const needsAssignment: number[] = [];

      for (const m of membersRes.rows) {
        const cs = m.callsign ?? "";
        const parts = cs.split("-");
        const numStr = parts[parts.length - 1];
        const n = parseInt(numStr, 10);
        const hasValidPrefix = prefix ? cs.startsWith(prefix + "-") : parts.length === 1;
        const hasValidNum =
          !isNaN(n) && n >= callsign_min && n <= callsign_max &&
          numStr === String(n).padStart(padLen, "0");
        if (hasValidPrefix && hasValidNum) usedNums.add(n);
        else needsAssignment.push(m.profile_id);
      }

      let next = callsign_min;
      for (const profileId of needsAssignment) {
        while (next <= callsign_max && usedNums.has(next)) next++;
        if (next > callsign_max) break; // range exhausted
        await pool.query(
          `UPDATE dph_users SET callsign = $2, updated_at = NOW() WHERE profile_id = $1`,
          [profileId, join(String(next).padStart(padLen, "0"))],
        );
        usedNums.add(next);
        next++;
      }
    }
  } catch (e) {
    console.error("[dph-callsign-sync] error:", e);
  }
}

async function syncDphDiscordRoles(
  preloadedMembers?: DphGuildMember[],
): Promise<{ assigned: number; skipped: number; removed: number; errors: string[] }> {
  const tok = process.env.DISCORD_BOT_TOKEN;
  if (!tok) return { assigned: 0, skipped: 0, removed: 0, errors: ["No DISCORD_BOT_TOKEN configured"] };
  try {
    const allMembers = preloadedMembers ?? await fetchDphGuildMembers();
    if (!preloadedMembers) await refreshCadAvatarsFromGuildMembers(allMembers);

    const ranksRes = await pool.query<{ name: string; discord_role_id: string; group_id: number | null; sort_order: number }>(
      `SELECT name, discord_role_id, group_id, sort_order FROM dph_ranks WHERE discord_role_id IS NOT NULL AND discord_role_id != ''`
    );
    if (ranksRes.rows.length === 0) return { assigned: 0, skipped: 0, removed: 0, errors: [] };

    const groupsRes = await pool.query<{ id: number; name: string; sort_order: number }>(
      `SELECT id, name, sort_order FROM dph_rank_groups`,
    );
    const groupNameById = new Map(groupsRes.rows.map(g => [g.id, g.name]));
    const groupSortById = new Map(groupsRes.rows.map(g => [g.id, Number(g.sort_order ?? 999_999)]));
    const rankMap = buildLinkedRankByRoleId(ranksRes.rows, groupSortById, groupNameById);
    const linkedRoleIds = [...rankMap.keys()];

    let assigned = 0; let skipped = 0; let removed = 0; const errors: string[] = [];
    const activeDiscordIds = new Set<string>();

    for (const m of allMembers) {
      const matchingRids = m.roles.filter(r => linkedRoleIds.includes(r));
      if (matchingRids.length === 0) continue;
      const rid = pickHighestLinkedDiscordRole(matchingRids, rankMap);
      if (!rid) continue;
      activeDiscordIds.add(m.user.id);
      const { rankName, groupName } = rankMap.get(rid)!;
      try {
        const profileId = await ensureCadProfileForDphDiscordMember(m);
        const displayName = m.nick ?? m.user.username;
        const existing = await pool.query<{ dph_rank: string | null; dph_role: string | null; username: string | null }>(
          `SELECT dph_rank, dph_role, username FROM dph_users WHERE profile_id = $1 LIMIT 1`,
          [profileId],
        );
        const isNewRosterMember = existing.rows.length === 0;
        if (
          existing.rows.length > 0
          && existing.rows[0].dph_rank === rankName
          && (existing.rows[0].dph_role ?? null) === (groupName ?? null)
          && existing.rows[0].username === displayName
        ) {
          skipped++;
          continue;
        }

        const newCallsign = await autoAssignDphCallsign(rankName, profileId);
        if (newCallsign) {
          await pool.query(
            `INSERT INTO dph_users (profile_id, username, dph_rank, dph_role, callsign, status)
             VALUES ($1, $2, $3, $4, $5, 'Active')
             ON CONFLICT (profile_id) DO UPDATE SET
               username   = EXCLUDED.username,
               dph_rank   = EXCLUDED.dph_rank,
               dph_role   = EXCLUDED.dph_role,
               callsign   = EXCLUDED.callsign,
               status     = COALESCE(dph_users.status, 'Active'),
               updated_at = NOW()`,
            [profileId, displayName, rankName, groupName, newCallsign],
          );
        } else {
          await pool.query(
            `INSERT INTO dph_users (profile_id, username, dph_rank, dph_role, status)
             VALUES ($1, $2, $3, $4, 'Active')
             ON CONFLICT (profile_id) DO UPDATE SET
               username   = EXCLUDED.username,
               dph_rank   = EXCLUDED.dph_rank,
               dph_role   = EXCLUDED.dph_role,
               status     = COALESCE(dph_users.status, 'Active'),
               updated_at = NOW()`,
            [profileId, displayName, rankName, groupName],
          );
        }
        if (isNewRosterMember) {
          await resetDphMemberPermissionGrants(pool, profileId);
        }
        assigned++;
      } catch (e) { errors.push(`discord_id ${m.user.id}: ${String(e)}`); }
    }

    removed += await removeDphMembersWithoutLinkedDiscordRole(allMembers, ranksRes.rows);

    await writeLog("dph_personnel", "System", "Discord role sync completed",
      `assigned=${assigned} skipped=${skipped} removed=${removed} errors=${errors.length}`);
    console.info(`[dph-sync] assigned=${assigned} skipped=${skipped} removed=${removed} errors=${errors.length}`);
    return { assigned, skipped, removed, errors };
  } catch (e) {
    console.error("[dph-sync] Error:", e);
    return { assigned: 0, skipped: 0, removed: 0, errors: [String(e)] };
  }
}

const DPH_SYNC_INTERVAL_MS = Math.max(
  10_000,
  Number(process.env.DPH_SYNC_INTERVAL_MS) || 60_000,
);
let _dphSyncRunning = false;
async function guardedDphSync() {
  if (_dphSyncRunning) return;
  _dphSyncRunning = true;
  try {
    try {
      await pruneOrphanedDphRosterMembers();
    } catch (pruneErr) {
      console.warn("[dph-prune] background prune failed:", pruneErr);
    }
    const members = await fetchDphGuildMembers();
    await refreshCadAvatarsFromGuildMembers(members);
    await syncDphDiscordRoles(members);
    await syncDphDivisionDiscordRoles(members);
  } catch (e) {
    console.error("[dph-sync]", e);
  } finally {
    _dphSyncRunning = false;
  }
}
setTimeout(() => {
  void guardedDphSync();
  setInterval(() => void guardedDphSync(), DPH_SYNC_INTERVAL_MS);
}, 45_000);

registerDiscordGuildSync(DPH_GUILD_ID, "dph-personnel", async () => {
  try {
    await pruneOrphanedDphRosterMembers();
  } catch (pruneErr) {
    console.warn("[dph-prune] gateway prune failed:", pruneErr);
  }
  const members = await fetchDphGuildMembers();
  await refreshCadAvatarsFromGuildMembers(members);
  await syncDphDiscordRoles(members);
});
registerDiscordGuildSync(DPH_GUILD_ID, "dph-division", async () => {
  const members = await fetchDphGuildMembers();
  await syncDphDivisionDiscordRoles(
    DPH_DIVISION_GUILD_ID === DPH_GUILD_ID ? members : undefined,
  );
});
if (DPH_DIVISION_GUILD_ID !== DPH_GUILD_ID) {
  registerDiscordGuildSync(DPH_DIVISION_GUILD_ID, "dph-division-guild", async () => {
    await syncDphDivisionDiscordRoles();
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const RANK_COLS = `id, name, sort_order, group_id, color_hex, callsign_prefix, insignia_url, discord_role_id,
  callsign_type, callsign_static, callsign_min, callsign_max`;

const rankOrderSubquery = `
  COALESCE(
    (SELECT sort_order FROM dph_ranks WHERE lower(name) = lower(d.dph_rank)),
    999
  )
`;

const dphDivisionDiscordMembershipCache: {
  map: Map<string, number[]>;
  linkedDivisionIds: Set<number>;
  warm: boolean;
  fetchedAt: number;
} = {
  map: new Map(),
  linkedDivisionIds: new Set(),
  warm: false,
  fetchedAt: 0,
};
const DPH_DIVISION_MEMBERSHIP_MAP_TTL_MS = 5 * 60 * 1000;
let _dphMembershipCacheRefreshRunning: Promise<void> | null = null;

async function refreshDphDivisionDiscordMembershipCacheFromMembers(
  members: Array<{ user: { id: string }; roles: string[] }>,
): Promise<void> {
  if (!process.env.DISCORD_BOT_TOKEN) return;
  try {
    const config = await loadDivisionLinkConfig("dph_divisions", "dph_division_ranks");
    if (config.membershipRoleByDiv.size === 0) return;
    dphDivisionDiscordMembershipCache.map = buildDivisionDiscordMembershipMap(
      members,
      config.membershipRoleByDiv,
    );
    dphDivisionDiscordMembershipCache.linkedDivisionIds = config.linkedDivisionIds;
    dphDivisionDiscordMembershipCache.warm = true;
    dphDivisionDiscordMembershipCache.fetchedAt = Date.now();
  } catch (err) {
    console.warn("[dph] division discord membership cache refresh failed:", err);
  }
}

async function refreshDphDivisionDiscordMembershipCache(force = false): Promise<void> {
  if (!process.env.DISCORD_BOT_TOKEN) return;
  const fresh =
    !force &&
    dphDivisionDiscordMembershipCache.warm &&
    Date.now() - dphDivisionDiscordMembershipCache.fetchedAt < DPH_DIVISION_MEMBERSHIP_MAP_TTL_MS;
  if (fresh) return;

  if (!_dphMembershipCacheRefreshRunning) {
    _dphMembershipCacheRefreshRunning = (async () => {
      const members = await fetchDphDivisionGuildMembers();
      await refreshDphDivisionDiscordMembershipCacheFromMembers(members);
    })().finally(() => { _dphMembershipCacheRefreshRunning = null; });
  }
  await _dphMembershipCacheRefreshRunning;
}

function kickDphDivisionDiscordMembershipCacheRefresh(): void {
  const stale =
    !dphDivisionDiscordMembershipCache.warm ||
    Date.now() - dphDivisionDiscordMembershipCache.fetchedAt >= DPH_DIVISION_MEMBERSHIP_MAP_TTL_MS;
  if (!stale || _dphMembershipCacheRefreshRunning) return;
  void refreshDphDivisionDiscordMembershipCache();
}

async function getDphDivisionDiscordEnrichmentForRoster(): Promise<DivisionDiscordEnrichment> {
  kickDphDivisionDiscordMembershipCacheRefresh();
  let linkedDivisionIds = dphDivisionDiscordMembershipCache.linkedDivisionIds;
  if (!dphDivisionDiscordMembershipCache.warm) {
    try {
      const linkConfig = await loadDivisionLinkConfig("dph_divisions", "dph_division_ranks");
      linkedDivisionIds = linkConfig.linkedDivisionIds;
    } catch {
      linkedDivisionIds = new Set();
    }
  }
  return {
    map: dphDivisionDiscordMembershipCache.map,
    warm: dphDivisionDiscordMembershipCache.warm,
    linkedDivisionIds,
  };
}

// ── GET personnel (pass ?all=1 to include inactive) ───────────────────────────
router.get("/dph", async (req, res) => {
  try {
    const includeAll = req.query.all === "1";

    try {
      await pruneOrphanedDphRosterMembersDebounced();
    } catch (pruneErr) {
      req.log.warn({ err: pruneErr }, "dph GET orphan prune failed");
    }
    try {
      await pruneDphDivisionRosterDebounced();
    } catch (pruneErr) {
      req.log.warn({ err: pruneErr }, "dph GET division prune failed");
    }

    const discordEnrichment = await getDphDivisionDiscordEnrichmentForRoster();

    const where = includeAll ? "" : "WHERE lower(d.status) != 'inactive'";
    const result = await pool.query(
      `SELECT p.id, COALESCE(d.username, p.username) AS username,
              p.discord_username, p.discord_id, p.avatar_hash,
              d.callsign, d.dph_rank, d.dph_role, d.division_rank, d.status, d.appointed_date,
              d.certifications,
              p.staff_role,
              COALESCE(d.pob, false) AS pob,
              COALESCE(d.iab, false) AS iab,
              COALESCE(d.hsu, false) AS hsu,
              COALESCE(d.sru, false) AS sru,
              COALESCE(d.fou, false) AS fou,
              COALESCE(d.can_view_all_resources, false) AS can_view_all_resources,
              COALESCE(d.can_access_iab, false) AS can_access_iab,
              CASE
                WHEN rg.name IS NOT NULL AND lower(rg.name) != 'community members' THEN rg.name
                ELSE NULL
              END AS group_name,
              COALESCE(rg.sort_order, 999) AS group_sort_order,
              COALESCE(dr.sort_order, 999) AS rank_sort_order
       FROM cad_user_profiles p
       JOIN dph_users d ON d.profile_id = p.id
       LEFT JOIN dph_ranks dr ON lower(dr.name) = lower(d.dph_rank)
       LEFT JOIN dph_rank_groups rg ON dr.group_id = rg.id
       ${where}
       ORDER BY COALESCE(rg.sort_order, 999), ${rankOrderSubquery},
                d.callsign,
                COALESCE(d.username, p.username)`
    );

    const sortedRows = sortDepartmentPersonnel(
      result.rows,
      (row) => Number(row.group_sort_order ?? 999),
      (row) => Number(row.rank_sort_order ?? 999),
      (row) => row.callsign ?? null,
      (row) => String(row.username ?? ""),
    );

    const seenIds = new Set<number>();
    const uniqueRows = sortedRows.filter((row: { id: number }) => {
      if (seenIds.has(row.id)) return false;
      seenIds.add(row.id);
      return true;
    });

    const ids = uniqueRows.map((r: { id: number }) => r.id);
    let assignmentMap = new Map<number, DphDivisionAssignment[]>();
    try {
      assignmentMap = await loadDphDivisionAssignments(ids);
    } catch (assignErr) {
      req.log.warn({ err: assignErr }, "dph GET division assignments load failed");
    }

    res.json(uniqueRows.map((row: Record<string, unknown> & { id: number; division_rank: string | null; discord_id?: string | null }) => {
      const assignments = assignmentMap.get(row.id) ?? [];
      const primary = assignments[0];
      const discordId = String(row.discord_id ?? "").trim();
      const division_discord_links = divisionDiscordLinksForMember(
        discordId,
        assignments,
        discordEnrichment,
      );
      return {
        ...row,
        pob: Boolean(row.pob),
        iab: Boolean(row.iab),
        hsu: Boolean(row.hsu),
        sru: Boolean(row.sru),
        fou: Boolean(row.fou),
        can_view_all_resources: Boolean(row.can_view_all_resources),
        can_access_iab: Boolean(row.can_access_iab),
        division_assignments: assignments,
        division_discord_links,
        division_rank: primary?.division_rank ?? row.division_rank ?? null,
        division_name: primary?.division_name ?? null,
        division_names: assignments.map(a => a.division_name),
      };
    }));
  } catch (err) {
    req.log.error({ err }, "dph GET error");
    res.status(500).json({ error: "Unable to load roster." });
  }
});

// ── POST /dph/:id/permissions/clear — revoke Access Permissions for one member ─
router.post("/dph/:id/permissions/clear", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid id." }); return; }
  try {
    const exists = await dphRosterRowExists(pool, id);
    if (!exists) { res.status(404).json({ error: "Member not found." }); return; }
    await resetDphMemberAccessPermissions(pool, id);
    const actor = (req.body as Record<string, unknown>).actor as string
      || (req.headers["x-actor"] as string)
      || "Admin";
    await writeLog(
      "dph_personnel",
      actor,
      "Cleared access permissions",
      `Profile id: ${id}`,
    );
    res.json({ ok: true, id, can_view_all_resources: false, can_access_iab: false });
  } catch (err) {
    req.log.error({ err }, "dph permissions clear error");
    res.status(500).json({ error: "Unable to clear access permissions." });
  }
});

// ── POST /dph/permissions/clear-all — revoke all individual permission grants ─
router.post("/dph/permissions/clear-all", async (req, res) => {
  try {
    const counts = await clearAllDphPermissionGrants(pool);
    const actor = (req.body as Record<string, unknown>).actor as string
      || (req.headers["x-actor"] as string)
      || "Admin";
    await writeLog(
      "dph_personnel",
      actor,
      "Cleared all individual permission grants",
      `resources=${counts.resources} iab=${counts.iab} divisionEditors=${counts.divisionEditors} titleGroups=${counts.titleGroups}`,
    );
    res.json({ ok: true, ...counts });
  } catch (err) {
    req.log.error({ err }, "dph permissions clear-all error");
    res.status(500).json({ error: "Unable to clear permission grants." });
  }
});

// ── PATCH /dph/:id/resource-access — toggle view-all-resources ────────────────
router.patch("/dph/:id/resource-access", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid id." }); return; }
  const { can_view_all_resources } = req.body as { can_view_all_resources?: boolean };
  if (typeof can_view_all_resources !== "boolean") {
    res.status(400).json({ error: "can_view_all_resources (boolean) is required." });
    return;
  }
  try {
    const result = await pool.query(
      `UPDATE dph_users
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
      "dph_personnel",
      actor,
      can_view_all_resources ? "Granted view-all resources access" : "Revoked view-all resources access",
      `Profile id: ${id}`,
    );
    res.json({ id, can_view_all_resources: Boolean(result.rows[0].can_view_all_resources) });
  } catch (err) {
    req.log.error({ err }, "dph resource-access PATCH error");
    res.status(500).json({ error: "Unable to update resource access." });
  }
});

// ── PATCH /dph/:id/iab-access — DPH-local access flag (separate from DPS IAB) ─
router.patch("/dph/:id/iab-access", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid id." }); return; }
  const { can_access_iab } = req.body as { can_access_iab?: boolean };
  if (typeof can_access_iab !== "boolean") {
    res.status(400).json({ error: "can_access_iab (boolean) is required." });
    return;
  }
  try {
    const result = await pool.query(
      `UPDATE dph_users
          SET can_access_iab = $2, updated_at = NOW()
        WHERE profile_id = $1
        RETURNING profile_id AS id, can_access_iab`,
      [id, can_access_iab],
    );
    if ((result.rowCount ?? 0) === 0) { res.status(404).json({ error: "Member not found." }); return; }
    const actor = (req.body as Record<string, unknown>).actor as string
      || (req.headers["x-actor"] as string)
      || "Admin";
    await writeLog(
      "dph_personnel",
      actor,
      can_access_iab ? "Granted DPH Internal Affairs access" : "Revoked DPH Internal Affairs access",
      `Profile id: ${id}`,
    );
    res.json({ id, can_access_iab: Boolean(result.rows[0].can_access_iab) });
  } catch (err) {
    req.log.error({ err }, "dph iab-access PATCH error");
    res.status(500).json({ error: "Unable to update access." });
  }
});

// ── GET /dph/me?username=X — fetch the current user's DPH record ──────────────
router.get("/dph/me", async (req, res) => {
  const username = String(req.query.username ?? "").trim();
  if (!username) { res.json(null); return; }
  try {
    const result = await pool.query(
      `SELECT d.dph_rank, d.dph_role, d.callsign, d.status,
              COALESCE(d.can_access_iab, false) AS can_access_iab
       FROM dph_users d
       JOIN cad_user_profiles p ON p.id = d.profile_id
       WHERE lower(COALESCE(d.username, p.username)) = lower($1)
       LIMIT 1`,
      [username]
    );
    const row = result.rows[0];
    if (!row) { res.json(null); return; }
    res.json({ ...row, can_access_iab: Boolean(row.can_access_iab) });
  } catch (err) {
    req.log.error({ err }, "dph/me GET error");
    res.json(null);
  }
});

// ── GET /dph/users/search — typeahead for Add Member form ────────────────────
router.get("/dph/users/search", async (req, res) => {
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
    req.log.error({ err }, "dph/users/search GET error");
    res.status(500).json({ error: "Search failed." });
  }
});

// ── PATCH — update a member's DPH fields ──────────────────────────────────────
router.patch("/dph/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid id." }); return; }

  const {
    dph_rank, dph_role, callsign, status, appointed_date, certifications, division_assignments,
    pob, iab, hsu, sru, fou,
  } = req.body as Record<string, unknown>;

  const safeDate = (appointed_date && String(appointed_date).trim()) ? appointed_date : null;

  const resolvedAssignments = Array.isArray(division_assignments)
    ? (division_assignments as Array<Record<string, unknown>>).map(a => ({
        division_id: Number(a.division_id),
        division_rank: String(a.division_rank ?? "").trim(),
        ...(a.is_manual !== undefined ? { is_manual: Boolean(a.is_manual) } : {}),
        ...(a.can_edit_resources !== undefined ? { can_edit_resources: Boolean(a.can_edit_resources) } : {}),
        ...(a.can_edit_roster !== undefined ? { can_edit_roster: Boolean(a.can_edit_roster) } : {}),
        ...(a.can_edit_info !== undefined ? { can_edit_info: Boolean(a.can_edit_info) } : {}),
      }))
    : undefined;

  try {
    const upd = await pool.query(
      `UPDATE dph_users SET
         dph_rank       = COALESCE($2, dph_rank),
         dph_role       = COALESCE($3, dph_role),
         callsign       = COALESCE($4, callsign),
         status         = COALESCE($5, status),
         appointed_date = COALESCE($6::date, appointed_date),
         certifications = COALESCE($7::text[], certifications),
         pob            = COALESCE($8::boolean, pob),
         iab            = COALESCE($9::boolean, iab),
         hsu            = COALESCE($10::boolean, hsu),
         sru            = COALESCE($11::boolean, sru),
         fou            = COALESCE($12::boolean, fou),
         updated_at     = NOW()
       WHERE profile_id = $1`,
      [id, dph_rank ?? null, dph_role ?? null, callsign ?? null, status ?? null,
       safeDate, certifications ?? null,
       pob ?? null, iab ?? null, hsu ?? null, sru ?? null, fou ?? null]
    );
    if ((upd.rowCount ?? 0) === 0) { res.status(404).json({ error: "Member not found." }); return; }

    const assignments = resolvedAssignments !== undefined
      ? await setDphMemberDivisionAssignments(id, resolvedAssignments)
      : ((await loadDphDivisionAssignments([id])).get(id) ?? []);

    const result = await pool.query(
      `SELECT p.id, COALESCE(u.username, p.username) AS username,
              p.discord_username, p.discord_id,
              u.callsign, u.dph_rank, u.dph_role, u.division_rank, u.status,
              u.appointed_date, u.certifications
       FROM dph_users u
       JOIN cad_user_profiles p ON p.id = u.profile_id
       WHERE u.profile_id = $1`,
      [id]
    );
    const actor = (req.body as Record<string, unknown>).actor as string || (req.headers['x-actor'] as string) || 'Admin';
    await writeLog('dph_personnel', actor, 'Updated member record', `${result.rows[0].username} — rank: ${result.rows[0].dph_rank}`);
    res.json({
      ...result.rows[0],
      division_assignments: assignments,
      division_rank: assignments[0]?.division_rank ?? result.rows[0].division_rank ?? null,
      division_name: assignments[0]?.division_name ?? null,
      division_names: assignments.map(a => a.division_name),
    });
  } catch (err) {
    req.log.error({ err }, "dph PATCH error");
    res.status(500).json({ error: "Unable to update member." });
  }
});

// ── POST — add/promote a member ───────────────────────────────────────────────
router.post("/dph", async (req, res) => {
  const { username, discord_username = "", discord_id = "",
          dph_rank = "Unranked", dph_role = "", callsign = "DPH-XX", status = "Active", appointed_date } =
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

      const isNewRosterMember = !(await dphRosterRowExists(pool, profileId));

      await pool.query(
        `INSERT INTO dph_users (profile_id, username, dph_rank, dph_role, callsign, status, appointed_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7::date)
         ON CONFLICT (profile_id) DO UPDATE SET
           username       = EXCLUDED.username,
           dph_rank       = EXCLUDED.dph_rank,
           dph_role       = CASE WHEN EXCLUDED.dph_role != '' THEN EXCLUDED.dph_role ELSE dph_users.dph_role END,
           callsign       = EXCLUDED.callsign,
           status         = EXCLUDED.status,
           appointed_date = EXCLUDED.appointed_date,
           updated_at     = NOW()`,
        [profileId, canonicalUsername, dph_rank, dph_role.trim(), callsign.trim(), status, appointed_date || null]
      );
      if (isNewRosterMember) {
        await resetDphMemberPermissionGrants(pool, profileId);
      }
      const result = await pool.query(
        `SELECT p.id, COALESCE(u.username, p.username) AS username,
                p.discord_username, p.discord_id,
                u.callsign, u.dph_rank, u.dph_role, u.status, u.appointed_date, u.certifications
         FROM dph_users u
         JOIN cad_user_profiles p ON p.id = u.profile_id
         WHERE u.profile_id = $1`,
        [profileId]
      );
      const actor = (req.body as Record<string, string>).actor || (req.headers['x-actor'] as string) || 'Admin';
      await writeLog('dph_personnel', actor, 'Added/updated member', `${result.rows[0].username} — ${dph_rank}`);
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
        `INSERT INTO dph_users (profile_id, username, dph_rank, dph_role, callsign, status, appointed_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7::date)`,
        [profileId, username.trim(), dph_rank, dph_role.trim(), callsign.trim(), status, appointed_date || null]
      );
      await resetDphMemberPermissionGrants(pool, profileId);
      const result = await pool.query(
        `SELECT p.id, COALESCE(u.username, p.username) AS username,
                p.discord_username, p.discord_id,
                u.callsign, u.dph_rank, u.dph_role, u.status, u.appointed_date, u.certifications
         FROM dph_users u
         JOIN cad_user_profiles p ON p.id = u.profile_id
         WHERE u.profile_id = $1`,
        [profileId]
      );
      const actor = (req.body as Record<string, string>).actor || (req.headers['x-actor'] as string) || 'Admin';
      await writeLog('dph_personnel', actor, 'Added new member', `${username.trim()} — ${dph_rank}`);
      res.status(201).json(result.rows[0]);
    }
  } catch (err) {
    req.log.error({ err }, "dph POST error");
    res.status(500).json({ error: "Unable to add member." });
  }
});

// ── DELETE — remove a member from the DPH roster ─────────────────────────────
router.delete("/dph/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid id." }); return; }
  try {
    const profileRes = await pool.query<{ community_code: string }>(
      `SELECT community_code FROM cad_user_profiles WHERE id = $1`, [id]
    );
    if ((profileRes.rowCount ?? 0) === 0) { res.status(404).json({ error: "Member not found." }); return; }

    const usernameRes = await pool.query<{ username: string }>(
      `SELECT COALESCE(d.username, p.username) AS username FROM cad_user_profiles p LEFT JOIN dph_users d ON d.profile_id = p.id WHERE p.id = $1`, [id]
    );
    const removedName = usernameRes.rows[0]?.username ?? String(id);

    await removeDphRosterMember(id);
    const actor = (req.headers['x-actor'] as string) || 'Admin';
    await writeLog('dph_personnel', actor, 'Removed member from roster', removedName);
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "dph DELETE error");
    res.status(500).json({ error: "Unable to remove member." });
  }
});

// ── GET /dph/discord-roles — DPH guild role list for dropdowns ────────────────
router.get("/dph/discord-roles", async (req, res) => {
  try {
    const refresh = wantsDiscordRolesRefresh(req.query as Record<string, unknown>);
    res.json(await getDphGuildRoles(refresh));
  } catch (err) {
    req.log?.error?.({ err }, "dph/discord-roles GET error");
    res.status(500).json({ error: "Failed to fetch DPH Discord roles." });
  }
});

// ── POST /dph/sync-discord-roles — sync ranks from DPH Discord guild ──────────
router.post("/dph/sync-discord-roles", async (_req, res) => {
  let pruned = 0;
  try {
    pruned = await pruneOrphanedDphRosterMembers();
  } catch (pruneErr) {
    _req.log?.warn?.({ err: pruneErr }, "orphaned DPH roster member prune failed");
  }
  try {
    const members = await fetchDphGuildMembers();
    await refreshCadAvatarsFromGuildMembers(members);
    const dph = await syncDphDiscordRoles(members);
    const divisions = await syncDphDivisionDiscordRoles(members);
    res.json({ ...dph, removed: dph.removed + pruned, pruned, divisions });
  } catch (err) {
    _req.log?.error?.({ err }, "dph/sync-discord-roles error");
    res.status(500).json({ error: "Sync failed.", pruned });
  }
});

// ── GET ranks ─────────────────────────────────────────────────────────────────
router.get("/dph/ranks", async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT ${RANK_COLS} FROM dph_ranks ORDER BY sort_order, id`
    );
    res.json(result.rows.map(r => normalizeRankRow(r as Record<string, unknown>)));
  } catch {
    res.status(500).json({ error: "Unable to load ranks." });
  }
});

// ── GET ranks/:id — single rank detail with member list ───────────────────────
router.get("/dph/ranks/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid id." }); return; }
  try {
    const rankRes = await pool.query(
      `SELECT ${RANK_COLS} FROM dph_ranks WHERE id = $1`, [id]
    );
    if (rankRes.rowCount === 0) { res.status(404).json({ error: "Rank not found." }); return; }
    const rank = rankRes.rows[0];

    const membersRes = await pool.query(
      `SELECT p.id, COALESCE(d.username, p.username) AS username,
              p.discord_username, p.discord_id, p.avatar_hash,
              d.callsign, d.dph_rank, d.status
       FROM cad_user_profiles p
       JOIN dph_users d ON d.profile_id = p.id
       WHERE lower(d.dph_rank) = lower($1)
       ORDER BY COALESCE(d.username, p.username)`, [rank.name]
    );
    const csRes = await pool.query(
      `SELECT cc.id, cc.rank_id, cc.callsign, cc.assigned_profile_id, cc.sort_order,
              COALESCE(d.username, p.username) AS assigned_username
       FROM dph_rank_custom_callsigns cc
       LEFT JOIN cad_user_profiles p ON p.id = cc.assigned_profile_id
       LEFT JOIN dph_users d ON d.profile_id = p.id
       WHERE cc.rank_id = $1
       ORDER BY cc.sort_order, cc.id`, [id]
    );
    let members = membersRes.rows;
    if (rank.callsign_type === "dynamic") {
      members = [...members].sort((a, b) => {
        const nA = parseInt((a.callsign ?? "").split("-").pop() ?? "", 10);
        const nB = parseInt((b.callsign ?? "").split("-").pop() ?? "", 10);
        if (!isNaN(nA) && !isNaN(nB)) return nA - nB;
        return (a.callsign ?? "").localeCompare(b.callsign ?? "");
      });
    }
    res.json({ ...rank, members, custom_callsigns: csRes.rows });
  } catch (err) {
    req.log.error({ err }, "dph/ranks/:id GET error");
    res.status(500).json({ error: "Unable to load rank." });
  }
});

// ── POST ranks/:id/auto-assign-callsigns — bulk assign dynamic callsigns ──────
router.post("/dph/ranks/:id/auto-assign-callsigns", async (req, res) => {
  const rankId = Number(req.params.id);
  if (!Number.isInteger(rankId) || rankId <= 0) { res.status(400).json({ error: "Invalid rank id." }); return; }
  try {
    const rankRes = await pool.query<{
      name: string; callsign_type: string | null; callsign_prefix: string | null;
      callsign_min: number | null; callsign_max: number | null;
    }>(
      `SELECT name, callsign_type, callsign_prefix, callsign_min, callsign_max
       FROM dph_ranks WHERE id = $1`, [rankId]
    );
    if (!rankRes.rows.length) { res.status(404).json({ error: "Rank not found." }); return; }
    const { name: rankName, callsign_type, callsign_prefix, callsign_min, callsign_max } = rankRes.rows[0];
    if (callsign_type !== "dynamic") { res.status(400).json({ error: "Rank is not dynamic type." }); return; }

    const prefix = callsign_prefix?.trim() ?? "";
    const min = callsign_min ?? 0;
    const max = callsign_max ?? 0;
    const padLen = Math.max(String(max).length, 2);

    const membersRes = await pool.query<{ profile_id: number; callsign: string }>(
      `SELECT profile_id, callsign FROM dph_users WHERE lower(dph_rank) = lower($1)`, [rankName]
    );

    const results: { profile_id: number; callsign: string }[] = [];
    for (const member of membersRes.rows) {
      const cs = member.callsign ?? "";
      const parts = cs.split("-");
      const numStr = parts[parts.length - 1];
      const n = parseInt(numStr, 10);
      const hasValidPrefix = prefix ? cs.startsWith(prefix + "-") : parts.length === 1;
      const hasValidNum = !isNaN(n) && n >= min && n <= max && numStr === String(n).padStart(padLen, "0");
      if (hasValidPrefix && hasValidNum) {
        results.push({ profile_id: member.profile_id, callsign: cs });
        continue;
      }
      const callsign = await autoAssignDphCallsign(rankName, member.profile_id);
      const final = callsign ?? DPH_DEFAULT_CALLSIGN;
      await pool.query(`UPDATE dph_users SET callsign = $2 WHERE profile_id = $1`, [member.profile_id, final]);
      results.push({ profile_id: member.profile_id, callsign: final });
    }
    res.json({ results });
  } catch (err) {
    req.log.error({ err }, "dph auto-assign-callsigns error");
    res.status(500).json({ error: "Unable to auto-assign callsigns." });
  }
});

// ── POST ranks/:id/custom-callsigns/reorder ──────────────────────────────────
router.post("/dph/ranks/:id/custom-callsigns/reorder", async (req, res) => {
  const rankId = Number(req.params.id);
  if (!Number.isInteger(rankId) || rankId <= 0) { res.status(400).json({ error: "Invalid rank id." }); return; }
  const { ids } = req.body as { ids?: number[] };
  if (!Array.isArray(ids) || ids.length === 0) { res.status(400).json({ error: "ids must be a non-empty array." }); return; }
  try {
    await Promise.all(ids.map((csId, i) =>
      pool.query(
        `UPDATE dph_rank_custom_callsigns SET sort_order = $2 WHERE id = $1 AND rank_id = $3`,
        [csId, i, rankId]
      )
    ));
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "dph custom-callsigns reorder error");
    res.status(500).json({ error: "Unable to reorder custom callsigns." });
  }
});

// ── POST ranks/:id/custom-callsigns — add a custom callsign slot ──────────────
router.post("/dph/ranks/:id/custom-callsigns", async (req, res) => {
  const rankId = Number(req.params.id);
  if (!Number.isInteger(rankId) || rankId <= 0) { res.status(400).json({ error: "Invalid rank id." }); return; }
  const { callsign } = req.body as { callsign?: string };
  if (!callsign?.trim()) { res.status(400).json({ error: "Callsign is required." }); return; }
  try {
    const soRes = await pool.query<{ mx: number }>(
      `SELECT COALESCE(MAX(sort_order), -1) + 1 AS mx FROM dph_rank_custom_callsigns WHERE rank_id = $1`,
      [rankId]
    );
    const result = await pool.query(
      `INSERT INTO dph_rank_custom_callsigns (rank_id, callsign, sort_order)
       VALUES ($1, $2, $3)
       RETURNING id, rank_id, callsign, assigned_profile_id, sort_order, NULL::text AS assigned_username`,
      [rankId, callsign.trim(), Number(soRes.rows[0]?.mx ?? 0)]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    req.log.error({ err }, "dph custom-callsigns POST error");
    res.status(500).json({ error: "Unable to add custom callsign." });
  }
});

// ── PATCH rank-callsigns/:csId — update text or assignment ────────────────────
router.patch("/dph/rank-callsigns/:csId", async (req, res) => {
  const csId = Number(req.params.csId);
  if (!Number.isInteger(csId) || csId <= 0) { res.status(400).json({ error: "Invalid id." }); return; }
  const { callsign, assigned_profile_id } = req.body as { callsign?: string; assigned_profile_id?: number | null };
  try {
    if (callsign !== undefined) {
      if (!callsign.trim()) { res.status(400).json({ error: "Callsign cannot be empty." }); return; }
      await pool.query(`UPDATE dph_rank_custom_callsigns SET callsign = $2 WHERE id = $1`, [csId, callsign.trim()]);
      const asgn = await pool.query<{ assigned_profile_id: number | null }>(
        `SELECT assigned_profile_id FROM dph_rank_custom_callsigns WHERE id = $1`, [csId]
      );
      const pid = asgn.rows[0]?.assigned_profile_id;
      if (pid) await pool.query(`UPDATE dph_users SET callsign = $2 WHERE profile_id = $1`, [pid, callsign.trim()]);
    }
    if (assigned_profile_id !== undefined) {
      const cur = await pool.query<{ assigned_profile_id: number | null; callsign: string }>(
        `SELECT assigned_profile_id, callsign FROM dph_rank_custom_callsigns WHERE id = $1`, [csId]
      );
      const prevPid = cur.rows[0]?.assigned_profile_id;
      const csText = cur.rows[0]?.callsign ?? "";
      if (prevPid && prevPid !== assigned_profile_id) {
        await pool.query(`UPDATE dph_users SET callsign = $2 WHERE profile_id = $1`, [prevPid, DPH_DEFAULT_CALLSIGN]);
      }
      await pool.query(
        `UPDATE dph_rank_custom_callsigns SET assigned_profile_id = $2 WHERE id = $1`,
        [csId, assigned_profile_id ?? null]
      );
      if (assigned_profile_id) {
        await pool.query(`UPDATE dph_users SET callsign = $2 WHERE profile_id = $1`, [assigned_profile_id, csText]);
      }
    }
    const updated = await pool.query(
      `SELECT cc.id, cc.rank_id, cc.callsign, cc.assigned_profile_id, cc.sort_order,
              COALESCE(d.username, p.username) AS assigned_username
       FROM dph_rank_custom_callsigns cc
       LEFT JOIN cad_user_profiles p ON p.id = cc.assigned_profile_id
       LEFT JOIN dph_users d ON d.profile_id = p.id
       WHERE cc.id = $1`, [csId]
    );
    res.json(updated.rows[0]);
  } catch (err) {
    req.log.error({ err }, "dph rank-callsigns PATCH error");
    res.status(500).json({ error: "Unable to update custom callsign." });
  }
});

// ── DELETE rank-callsigns/:csId — remove a custom callsign slot ───────────────
router.delete("/dph/rank-callsigns/:csId", async (req, res) => {
  const csId = Number(req.params.csId);
  if (!Number.isInteger(csId) || csId <= 0) { res.status(400).json({ error: "Invalid id." }); return; }
  try {
    const cur = await pool.query<{ assigned_profile_id: number | null }>(
      `SELECT assigned_profile_id FROM dph_rank_custom_callsigns WHERE id = $1`, [csId]
    );
    const pid = cur.rows[0]?.assigned_profile_id;
    if (pid) await pool.query(`UPDATE dph_users SET callsign = $2 WHERE profile_id = $1`, [pid, DPH_DEFAULT_CALLSIGN]);
    await pool.query(`DELETE FROM dph_rank_custom_callsigns WHERE id = $1`, [csId]);
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "dph rank-callsigns DELETE error");
    res.status(500).json({ error: "Unable to delete custom callsign." });
  }
});

// ── POST ranks/reorder ────────────────────────────────────────────────────────
router.post("/dph/ranks/reorder", async (req, res) => {
  const { ids } = req.body as { ids?: number[] };
  if (!Array.isArray(ids) || ids.length === 0) {
    res.status(400).json({ error: "ids must be a non-empty array." }); return;
  }
  try {
    await Promise.all(
      ids.map((id, i) => pool.query(`UPDATE dph_ranks SET sort_order = $2 WHERE id = $1`, [id, i]))
    );
    const result = await pool.query(
      `SELECT ${RANK_COLS} FROM dph_ranks WHERE id = ANY($1) ORDER BY sort_order`,
      [ids]
    );
    res.json(result.rows);
  } catch (err) {
    req.log.error({ err }, "dph ranks reorder error");
    res.status(500).json({ error: "Unable to reorder ranks." });
  }
});

// ── POST ranks — add a new rank ───────────────────────────────────────────────
router.post("/dph/ranks", async (req, res) => {
  const { name, group_id, color_hex, callsign_prefix, insignia_url, discord_role_id,
          callsign_type, callsign_static, callsign_min, callsign_max } =
    req.body as {
      name?: string; group_id?: number; color_hex?: string; callsign_prefix?: string;
      insignia_url?: string; discord_role_id?: string; callsign_type?: string;
      callsign_static?: string; callsign_min?: number; callsign_max?: number;
    };
  if (!name?.trim()) { res.status(400).json({ error: "Name is required." }); return; }
  try {
    const maxRes = await pool.query(`SELECT COALESCE(MAX(sort_order), -1) AS mx FROM dph_ranks`);
    const nextOrder = Number(maxRes.rows[0].mx) + 1;
    const csMin = callsign_min !== undefined ? (parseInt(String(callsign_min)) || null) : null;
    const csMax = callsign_max !== undefined ? (parseInt(String(callsign_max)) || null) : null;
    const result = await pool.query(
      `INSERT INTO dph_ranks (name, sort_order, group_id, color_hex, callsign_prefix, insignia_url, discord_role_id,
                              callsign_type, callsign_static, callsign_min, callsign_max)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING ${RANK_COLS}`,
      [
        name.trim(), nextOrder, group_id ?? null, color_hex ?? null,
        callsign_prefix?.trim() ?? null, insignia_url?.trim() ?? null,
        discord_role_id?.trim() || null,
        callsign_type?.trim() || null, callsign_static?.trim() || null, csMin, csMax,
      ]
    );
    if (discord_role_id?.trim()) void syncDphDiscordRoles().catch(console.error);
    res.status(201).json(normalizeRankRow(result.rows[0] as Record<string, unknown>));
  } catch (err: unknown) {
    req.log.error({ err }, "dph ranks POST error");
    if (isUniqueViolation(err)) { res.status(409).json({ error: "A rank with that name already exists." }); return; }
    res.status(500).json({ error: "Unable to add rank." });
  }
});

// ── PATCH ranks/:id ───────────────────────────────────────────────────────────
router.patch("/dph/ranks/:id", async (req, res) => {
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
    if (group_id !== undefined && name === undefined && direction === undefined
        && color_hex === undefined && insignia_url === undefined
        && !hasDiscordRole && !hasCallsignConfig) {
      const result = await pool.query(
        `UPDATE dph_ranks SET group_id = $2 WHERE id = $1
         RETURNING ${RANK_COLS}`,
        [id, group_id ?? null]
      );
      if (result.rowCount === 0) { res.status(404).json({ error: "Rank not found." }); return; }
      res.json(result.rows[0]); return;
    }

    if (name !== undefined && direction === undefined) {
      if (!name.trim()) { res.status(400).json({ error: "Name cannot be empty." }); return; }
      const result = await pool.query(
        `UPDATE dph_ranks SET
           name = $2, color_hex = $3, callsign_prefix = $4, insignia_url = $5,
           discord_role_id = CASE WHEN $6::boolean THEN $7 ELSE discord_role_id END,
           callsign_type   = CASE WHEN $8::boolean THEN $9  ELSE callsign_type END,
           callsign_static = CASE WHEN $10::boolean THEN $11 ELSE callsign_static END,
           callsign_min    = CASE WHEN $12::boolean THEN $13 ELSE callsign_min END,
           callsign_max    = CASE WHEN $14::boolean THEN $15 ELSE callsign_max END
         WHERE id = $1
         RETURNING ${RANK_COLS}`,
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
      if (hasDiscordRole) void syncDphDiscordRoles().catch(console.error);
      if (hasCallsignConfig) void syncDphCallsignsForRank(id);
      res.json(result.rows[0]); return;
    }

    if (direction === undefined && (color_hex !== undefined || insignia_url !== undefined || hasDiscordRole || hasCallsignConfig)) {
      const result = await pool.query(
        `UPDATE dph_ranks SET
           color_hex       = CASE WHEN $2::text IS NOT NULL THEN $2 ELSE color_hex END,
           callsign_prefix = CASE WHEN $3::text IS NOT NULL THEN $3 ELSE callsign_prefix END,
           insignia_url    = CASE WHEN $4::text IS NOT NULL THEN $4 ELSE insignia_url END,
           discord_role_id = CASE WHEN $5::boolean THEN $6 ELSE discord_role_id END,
           callsign_type   = CASE WHEN $7::boolean THEN $8  ELSE callsign_type END,
           callsign_static = CASE WHEN $9::boolean THEN $10 ELSE callsign_static END,
           callsign_min    = CASE WHEN $11::boolean THEN $12 ELSE callsign_min END,
           callsign_max    = CASE WHEN $13::boolean THEN $14 ELSE callsign_max END
         WHERE id = $1
         RETURNING ${RANK_COLS}`,
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
      if (hasDiscordRole) void syncDphDiscordRoles().catch(console.error);
      if (hasCallsignConfig) void syncDphCallsignsForRank(id);
      res.json(result.rows[0]); return;
    }

    if (direction === "up" || direction === "down") {
      const current = await pool.query(`SELECT id, sort_order FROM dph_ranks WHERE id = $1`, [id]);
      if (current.rowCount === 0) { res.status(404).json({ error: "Rank not found." }); return; }
      const currentOrder = current.rows[0].sort_order as number;
      const adjacentRes = await pool.query(
        direction === "up"
          ? `SELECT id, sort_order FROM dph_ranks WHERE sort_order < $1 ORDER BY sort_order DESC LIMIT 1`
          : `SELECT id, sort_order FROM dph_ranks WHERE sort_order > $1 ORDER BY sort_order ASC  LIMIT 1`,
        [currentOrder]
      );
      if (adjacentRes.rowCount === 0) { res.json({ ok: true, noChange: true }); return; }
      const adj = adjacentRes.rows[0];
      await pool.query(
        `UPDATE dph_ranks SET sort_order = CASE WHEN id = $1 THEN $3 WHEN id = $2 THEN $4 END WHERE id IN ($1, $2)`,
        [id, adj.id, adj.sort_order, currentOrder]
      );
      res.json({ ok: true }); return;
    }

    res.status(400).json({ error: "Provide 'name', metadata fields, or 'direction' to reorder." });
  } catch (err: unknown) {
    const pg = err as { code?: string };
    if (pg.code === "23505") { res.status(409).json({ error: "That name is already taken." }); return; }
    req.log.error({ err }, "dph ranks PATCH error");
    res.status(500).json({ error: "Unable to update rank." });
  }
});

// ── DELETE ranks/:id ──────────────────────────────────────────────────────────
router.delete("/dph/ranks/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid id." }); return; }
  try {
    const rankRes = await pool.query<{ name: string }>(
      `SELECT name FROM dph_ranks WHERE id = $1`, [id],
    );
    if ((rankRes.rowCount ?? 0) === 0) { res.status(404).json({ error: "Rank not found." }); return; }
    const rankName = String(rankRes.rows[0].name ?? "").trim();

    const membersRes = await pool.query<{ profile_id: number }>(
      `SELECT profile_id FROM dph_users WHERE lower(dph_rank) = $1`, [rankName.toLowerCase()],
    );
    for (const member of membersRes.rows) {
      await removeDphRosterMember(Number(member.profile_id));
    }

    await pool.query(`DELETE FROM dph_rank_custom_callsigns WHERE rank_id = $1`, [id]);
    await pool.query(`DELETE FROM dph_ranks WHERE id = $1`, [id]);

    const actor = (req.headers['x-actor'] as string) || 'Admin';
    await writeLog('dph_personnel', actor, 'Deleted rank',
      `${rankName} — removed ${membersRes.rows.length} member(s)`);
    res.json({ ok: true, removed_members: membersRes.rows.length });
  } catch (err) {
    req.log.error({ err }, "dph ranks DELETE error");
    res.status(500).json({ error: "Unable to delete rank." });
  }
});

const GROUP_COLS = `id, name, sort_order, COALESCE(panel_access, false) AS panel_access,
  COALESCE(division_oversight, false) AS division_oversight`;

// ── GET groups ────────────────────────────────────────────────────────────────
router.get("/dph/groups", async (_req, res) => {
  try {
    await ensureDefaultDphRankGroups();
    const result = await pool.query(
      `SELECT ${GROUP_COLS} FROM dph_rank_groups ORDER BY sort_order, id`
    );
    res.json(result.rows.map((r: Record<string, unknown>) => normalizeGroupRow(r)));
  } catch (err) {
    _req.log.error({ err }, "dph groups GET error");
    res.status(500).json({ error: "Unable to load groups." });
  }
});

// ── POST groups ───────────────────────────────────────────────────────────────
router.post("/dph/groups", async (req, res) => {
  const { name } = req.body as { name?: string };
  if (!name?.trim()) { res.status(400).json({ error: "Name is required." }); return; }
  try {
    const maxRes = await pool.query(`SELECT COALESCE(MAX(sort_order), 0) AS mx FROM dph_rank_groups`);
    const nextOrder = Number(maxRes.rows[0].mx) + 1;
    const result = await pool.query(
      `INSERT INTO dph_rank_groups (name, sort_order) VALUES ($1, $2) RETURNING ${GROUP_COLS}`,
      [name.trim(), nextOrder]
    );
    res.status(201).json(normalizeGroupRow(result.rows[0] as Record<string, unknown>));
  } catch (err: unknown) {
    const pg = err as { code?: string };
    if (pg.code === "23505") { res.status(409).json({ error: "A group with that name already exists." }); return; }
    req.log.error({ err }, "dph groups POST error");
    res.status(500).json({ error: "Unable to add group." });
  }
});

// ── POST groups/reorder ───────────────────────────────────────────────────────
router.post("/dph/groups/reorder", async (req, res) => {
  const { ids } = req.body as { ids?: number[] };
  if (!Array.isArray(ids) || ids.length === 0) {
    res.status(400).json({ error: "ids must be a non-empty array." }); return;
  }
  try {
    await Promise.all(
      ids.map((id, i) => pool.query(`UPDATE dph_rank_groups SET sort_order = $2 WHERE id = $1`, [id, i]))
    );
    const result = await pool.query(
      `SELECT ${GROUP_COLS} FROM dph_rank_groups WHERE id = ANY($1) ORDER BY sort_order`,
      [ids]
    );
    res.json(result.rows.map((r: Record<string, unknown>) => normalizeGroupRow(r)));
  } catch (err) {
    req.log.error({ err }, "dph groups reorder error");
    res.status(500).json({ error: "Unable to reorder groups." });
  }
});

// ── PATCH groups/:id ──────────────────────────────────────────────────────────
router.patch("/dph/groups/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid id." }); return; }

  const { name, direction, panel_access, division_oversight } =
    req.body as {
      name?: string; direction?: "up" | "down";
      panel_access?: boolean; division_oversight?: boolean;
    };

  try {
    if (panel_access !== undefined && name === undefined && direction === undefined && division_oversight === undefined) {
      const result = await pool.query(
        `UPDATE dph_rank_groups SET panel_access = $2 WHERE id = $1
         RETURNING ${GROUP_COLS}`,
        [id, panel_access]
      );
      if (result.rowCount === 0) { res.status(404).json({ error: "Group not found." }); return; }
      const actor = (req.body as Record<string, unknown>).actor as string || (req.headers['x-actor'] as string) || 'Admin';
      const groupName = result.rows[0].name as string;
      await writeLog('dph_personnel', actor,
        panel_access ? 'Granted panel access' : 'Revoked panel access',
        `Group: ${groupName}`
      );
      res.json(normalizeGroupRow(result.rows[0] as Record<string, unknown>)); return;
    }

    if (division_oversight !== undefined && name === undefined && direction === undefined && panel_access === undefined) {
      const result = await pool.query(
        `UPDATE dph_rank_groups SET division_oversight = $2 WHERE id = $1
         RETURNING ${GROUP_COLS}`,
        [id, division_oversight]
      );
      if (result.rowCount === 0) { res.status(404).json({ error: "Group not found." }); return; }
      const actor = (req.body as Record<string, unknown>).actor as string || (req.headers['x-actor'] as string) || 'Admin';
      const groupName = result.rows[0].name as string;
      await writeLog('dph_personnel', actor,
        division_oversight ? 'Granted division oversight' : 'Revoked division oversight',
        `Group: ${groupName}`
      );
      res.json(normalizeGroupRow(result.rows[0] as Record<string, unknown>)); return;
    }

    if (name !== undefined) {
      if (!name.trim()) { res.status(400).json({ error: "Name cannot be empty." }); return; }
      const result = await pool.query(
        `UPDATE dph_rank_groups SET name = $2 WHERE id = $1
         RETURNING ${GROUP_COLS}`,
        [id, name.trim()]
      );
      if (result.rowCount === 0) { res.status(404).json({ error: "Group not found." }); return; }
      res.json(normalizeGroupRow(result.rows[0] as Record<string, unknown>)); return;
    }

    if (direction === "up" || direction === "down") {
      const current = await pool.query(`SELECT id, sort_order FROM dph_rank_groups WHERE id = $1`, [id]);
      if (current.rowCount === 0) { res.status(404).json({ error: "Group not found." }); return; }
      const currentOrder = current.rows[0].sort_order as number;
      const adjacentRes = await pool.query(
        direction === "up"
          ? `SELECT id, sort_order FROM dph_rank_groups WHERE sort_order < $1 ORDER BY sort_order DESC LIMIT 1`
          : `SELECT id, sort_order FROM dph_rank_groups WHERE sort_order > $1 ORDER BY sort_order ASC  LIMIT 1`,
        [currentOrder]
      );
      if (adjacentRes.rowCount === 0) { res.json({ ok: true, noChange: true }); return; }
      const adj = adjacentRes.rows[0];
      await pool.query(
        `UPDATE dph_rank_groups SET sort_order = CASE WHEN id = $1 THEN $3 WHEN id = $2 THEN $4 END WHERE id IN ($1, $2)`,
        [id, adj.id, adj.sort_order, currentOrder]
      );
      res.json({ ok: true }); return;
    }

    res.status(400).json({ error: "Provide 'name', 'panel_access', 'division_oversight', or 'direction'." });
  } catch (err: unknown) {
    const pg = err as { code?: string };
    if (pg.code === "23505") { res.status(409).json({ error: "That name is already taken." }); return; }
    req.log.error({ err }, "dph groups PATCH error");
    res.status(500).json({ error: "Unable to update group." });
  }
});

// ── DELETE groups/:id ─────────────────────────────────────────────────────────
router.delete("/dph/groups/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid id." }); return; }
  try {
    await pool.query(
      `UPDATE dph_ranks SET group_id = (
         SELECT id FROM dph_rank_groups WHERE id != $1 ORDER BY sort_order DESC LIMIT 1
       ) WHERE group_id = $1`,
      [id]
    );
    await pool.query(`DELETE FROM dph_rank_groups WHERE id = $1`, [id]);
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "dph groups DELETE error");
    res.status(500).json({ error: "Unable to delete group." });
  }
});

// ── Fleet ─────────────────────────────────────────────────────────────────────
router.get("/dph/vehicles", async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, year, category, category_sort, image_url,
              who_can_drive, restrict_to_divisions, liveries, notes, sort_order
       FROM dph_fleet ORDER BY category_sort, category, sort_order, id`
    );
    res.json(result.rows);
  } catch {
    res.status(500).json({ error: "Unable to load fleet." });
  }
});

router.post("/dph/fleet", async (req, res) => {
  const { name, year = null, category = "General", category_sort = 0, image_url = null,
          who_can_drive = [], restrict_to_divisions = [], liveries = [], notes = null, sort_order = 0 } =
    req.body as Record<string, unknown>;
  if (!name || typeof name !== "string" || !name.trim()) {
    res.status(400).json({ error: "Vehicle name is required." }); return;
  }
  try {
    const result = await pool.query(
      `INSERT INTO dph_fleet (name, year, category, category_sort, image_url, who_can_drive, restrict_to_divisions, liveries, notes, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id, name, year, category, category_sort, image_url, who_can_drive, restrict_to_divisions, liveries, notes, sort_order`,
      [name.trim(), year || null, String(category).trim(), Number(category_sort),
       image_url || null, who_can_drive, restrict_to_divisions, liveries, notes || null, Number(sort_order)]
    );
    const actor = (req.body as Record<string, unknown>).actor as string || (req.headers['x-actor'] as string) || 'Admin';
    await writeLog('dph_vehicles', actor, 'Added vehicle', `${result.rows[0].name} — ${result.rows[0].category}`);
    res.status(201).json(result.rows[0]);
  } catch {
    res.status(500).json({ error: "Unable to add vehicle." });
  }
});

router.patch("/dph/fleet/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { name, year, category, category_sort, image_url, who_can_drive, restrict_to_divisions, liveries, notes, sort_order } =
    req.body as Record<string, unknown>;
  try {
    const result = await pool.query(
      `UPDATE dph_fleet SET
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
    await writeLog('dph_vehicles', actor, 'Updated vehicle', result.rows[0].name);
    res.json(result.rows[0]);
  } catch {
    res.status(500).json({ error: "Unable to update vehicle." });
  }
});

router.delete("/dph/fleet/:id", async (req, res) => {
  const id = Number(req.params.id);
  try {
    const result = await pool.query(`DELETE FROM dph_fleet WHERE id=$1 RETURNING id, name`, [id]);
    if ((result.rowCount ?? 0) === 0) { res.status(404).json({ error: "Vehicle not found." }); return; }
    const actor = (req.headers['x-actor'] as string) || 'Admin';
    await writeLog('dph_vehicles', actor, 'Deleted vehicle', result.rows[0]?.name ?? String(id));
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Unable to delete vehicle." });
  }
});

// ── Fleet categories ──────────────────────────────────────────────────────────
router.get("/dph/fleet/categories", async (_req, res) => {
  try {
    const r = await pool.query(`SELECT id, name, sort_order FROM dph_fleet_categories ORDER BY sort_order, id`);
    res.json(r.rows);
  } catch { res.status(500).json({ error: "Unable to load categories." }); }
});

router.post("/dph/fleet/categories", async (req, res) => {
  const { name } = req.body as { name?: string };
  if (!name?.trim()) { res.status(400).json({ error: "Category name required." }); return; }
  try {
    const mx = await pool.query(`SELECT COALESCE(MAX(sort_order),-1) AS m FROM dph_fleet_categories`);
    const r = await pool.query(
      `INSERT INTO dph_fleet_categories (name, sort_order) VALUES ($1,$2) RETURNING id, name, sort_order`,
      [name.trim(), (mx.rows[0].m as number) + 1]
    );
    res.status(201).json(r.rows[0]);
  } catch { res.status(500).json({ error: "Unable to add category." }); }
});

router.patch("/dph/fleet/categories/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { name } = req.body as { name?: string };
  if (!name?.trim()) { res.status(400).json({ error: "Category name required." }); return; }
  try {
    const old = await pool.query(`SELECT name FROM dph_fleet_categories WHERE id=$1`, [id]);
    if ((old.rowCount ?? 0) === 0) { res.status(404).json({ error: "Category not found." }); return; }
    await pool.query(`UPDATE dph_fleet SET category=$1 WHERE category=$2`, [name.trim(), old.rows[0].name]);
    const r = await pool.query(
      `UPDATE dph_fleet_categories SET name=$1 WHERE id=$2 RETURNING id, name, sort_order`,
      [name.trim(), id]
    );
    res.json(r.rows[0]);
  } catch { res.status(500).json({ error: "Unable to rename category." }); }
});

router.delete("/dph/fleet/categories/:id", async (req, res) => {
  const id = Number(req.params.id);
  try {
    const cat = await pool.query(`SELECT name FROM dph_fleet_categories WHERE id=$1`, [id]);
    if ((cat.rowCount ?? 0) === 0) { res.status(404).json({ error: "Category not found." }); return; }
    await pool.query(`DELETE FROM dph_fleet WHERE category=$1`, [cat.rows[0].name]);
    await pool.query(`DELETE FROM dph_fleet_categories WHERE id=$1`, [id]);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: "Unable to delete category." }); }
});

router.post("/dph/fleet/reorder", async (req, res) => {
  const { ids } = req.body as { ids?: number[] };
  if (!Array.isArray(ids)) { res.status(400).json({ error: "ids[] required." }); return; }
  try {
    await Promise.all(ids.map((id, i) => pool.query(`UPDATE dph_fleet SET sort_order=$1 WHERE id=$2`, [i, id])));
    res.json({ ok: true });
  } catch { res.status(500).json({ error: "Unable to reorder vehicles." }); }
});

router.post("/dph/fleet/categories/reorder", async (req, res) => {
  const { ordered } = req.body as { ordered?: number[] };
  if (!Array.isArray(ordered)) { res.status(400).json({ error: "ordered[] required." }); return; }
  try {
    await Promise.all(ordered.map((id, i) => pool.query(`UPDATE dph_fleet_categories SET sort_order=$1 WHERE id=$2`, [i, id])));
    res.json({ ok: true });
  } catch { res.status(500).json({ error: "Unable to reorder categories." }); }
});

// ── Equipment ─────────────────────────────────────────────────────────────────
router.get("/dph/equipment", async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, quantity, category, category_sort, image_url,
              image_scale, image_position_x, image_position_y,
              who_can_use, restrict_to_divisions, notes, sort_order
       FROM dph_equipment
       ORDER BY category_sort, category, sort_order, id`
    );
    res.json(result.rows);
  } catch { res.status(500).json({ error: "Unable to load equipment." }); }
});

router.post("/dph/equipment", async (req, res) => {
  const { name, quantity = null, category = "General", category_sort = 0, image_url = null,
          image_scale = 1, image_position_x = 50, image_position_y = 50,
          who_can_use = [], restrict_to_divisions = [], notes = null, sort_order = 0 } =
    req.body as Record<string, unknown>;
  if (!name || typeof name !== "string" || !name.trim()) {
    res.status(400).json({ error: "Equipment name is required." }); return;
  }
  try {
    const result = await pool.query(
      `INSERT INTO dph_equipment (name, quantity, category, category_sort, image_url, image_scale, image_position_x, image_position_y, who_can_use, restrict_to_divisions, notes, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING id, name, quantity, category, category_sort, image_url, image_scale, image_position_x, image_position_y, who_can_use, restrict_to_divisions, notes, sort_order`,
      [name.trim(), quantity || null, String(category).trim(), Number(category_sort),
       image_url || null, Number(image_scale) || 1, Number(image_position_x) ?? 50, Number(image_position_y) ?? 50,
       who_can_use, restrict_to_divisions, notes || null, Number(sort_order)]
    );
    const actor = (req.body as Record<string, unknown>).actor as string || (req.headers["x-actor"] as string) || "Admin";
    await writeLog("dph_equipment", actor, "Added equipment", `${result.rows[0].name} — ${result.rows[0].category}`);
    res.status(201).json(result.rows[0]);
  } catch { res.status(500).json({ error: "Unable to add equipment." }); }
});

router.patch("/dph/equipment/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { name, quantity, category, category_sort, image_url, image_scale, image_position_x, image_position_y,
          who_can_use, restrict_to_divisions, notes, sort_order } =
    req.body as Record<string, unknown>;
  try {
    const result = await pool.query(
      `UPDATE dph_equipment SET
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
    const actor = (req.body as Record<string, unknown>).actor as string || (req.headers["x-actor"] as string) || "Admin";
    await writeLog("dph_equipment", actor, "Updated equipment", result.rows[0].name);
    res.json(result.rows[0]);
  } catch { res.status(500).json({ error: "Unable to update equipment." }); }
});

router.delete("/dph/equipment/:id", async (req, res) => {
  const id = Number(req.params.id);
  try {
    const result = await pool.query(`DELETE FROM dph_equipment WHERE id=$1 RETURNING name`, [id]);
    if ((result.rowCount ?? 0) === 0) { res.status(404).json({ error: "Equipment not found." }); return; }
    const actor = (req.headers["x-actor"] as string) || "Admin";
    await writeLog("dph_equipment", actor, "Deleted equipment", result.rows[0]?.name ?? String(id));
    res.json({ ok: true });
  } catch { res.status(500).json({ error: "Unable to delete equipment." }); }
});

router.get("/dph/equipment/categories", async (_req, res) => {
  try {
    const r = await pool.query(`SELECT id, name, sort_order FROM dph_equipment_categories ORDER BY sort_order, id`);
    res.json(r.rows);
  } catch { res.status(500).json({ error: "Unable to load categories." }); }
});

router.post("/dph/equipment/categories", async (req, res) => {
  const { name } = req.body as { name?: string };
  if (!name?.trim()) { res.status(400).json({ error: "Name is required." }); return; }
  try {
    const mx = await pool.query(`SELECT COALESCE(MAX(sort_order),-1) AS m FROM dph_equipment_categories`);
    const r = await pool.query(
      `INSERT INTO dph_equipment_categories (name, sort_order) VALUES ($1,$2) RETURNING id, name, sort_order`,
      [name.trim(), Number(mx.rows[0]?.m ?? -1) + 1]
    );
    res.status(201).json(r.rows[0]);
  } catch { res.status(500).json({ error: "Unable to create category." }); }
});

router.patch("/dph/equipment/categories/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { name } = req.body as { name?: string };
  if (!name?.trim()) { res.status(400).json({ error: "Name is required." }); return; }
  try {
    const old = await pool.query(`SELECT name FROM dph_equipment_categories WHERE id=$1`, [id]);
    if (!old.rows.length) { res.status(404).json({ error: "Category not found." }); return; }
    await pool.query(`UPDATE dph_equipment SET category=$1 WHERE category=$2`, [name.trim(), old.rows[0].name]);
    const r = await pool.query(
      `UPDATE dph_equipment_categories SET name=$1 WHERE id=$2 RETURNING id, name, sort_order`,
      [name.trim(), id]
    );
    res.json(r.rows[0]);
  } catch { res.status(500).json({ error: "Unable to rename category." }); }
});

router.delete("/dph/equipment/categories/:id", async (req, res) => {
  const id = Number(req.params.id);
  try {
    const cat = await pool.query(`SELECT name FROM dph_equipment_categories WHERE id=$1`, [id]);
    if (!cat.rows.length) { res.status(404).json({ error: "Category not found." }); return; }
    await pool.query(`DELETE FROM dph_equipment WHERE category=$1`, [cat.rows[0].name]);
    await pool.query(`DELETE FROM dph_equipment_categories WHERE id=$1`, [id]);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: "Unable to delete category." }); }
});

router.post("/dph/equipment/reorder", async (req, res) => {
  const { ids } = req.body as { ids?: number[] };
  if (!Array.isArray(ids)) { res.status(400).json({ error: "ids[] required." }); return; }
  try {
    await Promise.all(ids.map((id, i) => pool.query(`UPDATE dph_equipment SET sort_order=$1 WHERE id=$2`, [i, id])));
    res.json({ ok: true });
  } catch { res.status(500).json({ error: "Unable to reorder equipment." }); }
});

router.post("/dph/equipment/categories/reorder", async (req, res) => {
  const { ordered, ids } = req.body as { ordered?: number[]; ids?: number[] };
  const list = Array.isArray(ordered) ? ordered : ids;
  if (!Array.isArray(list)) { res.status(400).json({ error: "ordered[] required." }); return; }
  try {
    await Promise.all(list.map((id, i) =>
      pool.query(`UPDATE dph_equipment_categories SET sort_order=$1 WHERE id=$2`, [i, id])
    ));
    res.json({ ok: true });
  } catch { res.status(500).json({ error: "Unable to reorder categories." }); }
});

// ── Events ────────────────────────────────────────────────────────────────────
router.get("/dph/events", async (req, res) => {
  try {
    const publicOnly = req.query.public === "true";
    const result = await pool.query(
      `SELECT id, title, event_date, event_time, location, purpose,
              hosted_by, hosting_department, is_public, created_at
       FROM dph_events
       ${publicOnly ? "WHERE is_public = true" : ""}
       ORDER BY event_date ASC, event_time ASC`
    );
    res.json(result.rows.map((row: Record<string, unknown>) => ({
      ...row,
      event_date: String(row.event_date ?? "").slice(0, 10),
      hosting_department: row.hosting_department || "Department of Public Health",
      is_public: Boolean(row.is_public),
    })));
  } catch {
    res.status(500).json({ error: "Unable to load events." });
  }
});

router.post("/dph/events", async (req, res) => {
  const { title, event_date, event_time, location, purpose, is_public, hosted_by, hosting_department } = req.body as {
    title?: string; event_date?: string; event_time?: string;
    location?: string; purpose?: string; is_public?: boolean;
    hosted_by?: string; hosting_department?: string;
  };
  if (!title?.trim() || !event_date) {
    res.status(400).json({ error: "title and event_date are required." }); return;
  }
  const dept = hosting_department?.trim() || "Department of Public Health";
  try {
    const r = await pool.query(
      `INSERT INTO dph_events (title, event_date, event_time, location, purpose, is_public, hosted_by, hosting_department)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, title, event_date, event_time, location, purpose, hosted_by, hosting_department, is_public, created_at`,
      [
        title.trim(), event_date, event_time || null, location?.trim() || null, purpose?.trim() || null,
        is_public === true, hosted_by?.trim() || null, dept,
      ]
    );
    const row = r.rows[0] as Record<string, unknown>;
    res.status(201).json({ ...row, event_date: String(row.event_date ?? "").slice(0, 10), is_public: Boolean(row.is_public) });
  } catch (err) {
    req.log.error({ err }, "dph/events POST error");
    res.status(500).json({ error: "Unable to create event." });
  }
});

router.patch("/dph/events/:id", async (req, res) => {
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
  const dept = hosting_department?.trim() || "Department of Public Health";
  try {
    const r = await pool.query(
      `UPDATE dph_events SET title=$1, event_date=$2, event_time=$3, location=$4, purpose=$5, is_public=$6,
         hosted_by=$7, hosting_department=$8
       WHERE id=$9
       RETURNING id, title, event_date, event_time, location, purpose, hosted_by, hosting_department, is_public, created_at`,
      [
        title.trim(), event_date, event_time || null, location?.trim() || null, purpose?.trim() || null,
        is_public === true, hosted_by?.trim() || null, dept, id,
      ]
    );
    if (!r.rows.length) { res.status(404).json({ error: "Event not found." }); return; }
    const row = r.rows[0] as Record<string, unknown>;
    res.json({ ...row, event_date: String(row.event_date ?? "").slice(0, 10), is_public: Boolean(row.is_public) });
  } catch (err) {
    req.log.error({ err }, "dph/events PATCH error");
    res.status(500).json({ error: "Unable to update event." });
  }
});

router.delete("/dph/events/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid id." }); return; }
  try {
    await pool.query(`DELETE FROM dph_events WHERE id=$1`, [id]);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Unable to delete event." });
  }
});

// ── Page / index content blocks ───────────────────────────────────────────────
const CONTENT_KEYS = ["index_info", "page_info"];

router.get("/dph/content/:key", async (req, res) => {
  if (!CONTENT_KEYS.includes(req.params.key)) { res.status(400).json({ error: "Invalid key." }); return; }
  try {
    const r = await pool.query(`SELECT content FROM dph_content WHERE key=$1`, [req.params.key]);
    res.json(r.rows[0]?.content ?? {});
  } catch { res.status(500).json({ error: "Failed to load content." }); }
});

router.put("/dph/content/:key", async (req, res) => {
  if (!CONTENT_KEYS.includes(req.params.key)) { res.status(400).json({ error: "Invalid key." }); return; }
  try {
    // No explicit ::jsonb cast — Postgres infers jsonb from the target column,
    // and the SQLite shim has no `::` cast syntax.
    await pool.query(
      `INSERT INTO dph_content (key, content) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET content = EXCLUDED.content`,
      [req.params.key, JSON.stringify(req.body)]
    );
    res.json({ ok: true });
  } catch { res.status(500).json({ error: "Failed to save content." }); }
});

export default router;
