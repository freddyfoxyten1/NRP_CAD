// ─────────────────────────────────────────────────────────────────────────────
// lib/dph-divisions.ts  —  DPH division assignment reads/writes
//
// Shared by the DPH personnel roster (routes/dph.ts) and the DPH division
// roster (routes/dph-divisions.ts). Mirrors the DPS helpers in routes/roster.ts
// but against dph_* tables, and without the POB/IAB-style unit flags that only
// exist on dps_users.
// ─────────────────────────────────────────────────────────────────────────────
import { pool } from "@workspace/db";
import { isDivisionUnrankedRank } from "./division-discord-qualify.js";

export const DPH_DEFAULT_CALLSIGN = "DPH-XX";

export type DphDivisionAssignment = {
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

export type DphAssignmentInput = {
  division_id: number;
  division_rank: string;
  is_manual?: boolean;
  can_edit_resources?: boolean;
  can_edit_roster?: boolean;
  can_edit_info?: boolean;
};

export async function loadDphDivisionAssignments(
  profileIds: number[],
): Promise<Map<number, DphDivisionAssignment[]>> {
  const map = new Map<number, DphDivisionAssignment[]>();
  if (profileIds.length === 0) return map;
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
     FROM dph_user_divisions ud
     JOIN dph_divisions dd ON dd.id = ud.division_id
     WHERE ud.profile_id = ANY($1)
     ORDER BY dd.sort_order, dd.id`,
    [profileIds],
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

/**
 * Replace a member's DPH division assignments.
 * One rank per division; multiple divisions allowed. The first assignment is
 * mirrored onto dph_users.division_rank for single-value consumers.
 * Permission / manual flags are preserved for divisions that remain unless the
 * caller explicitly overrides them.
 */
export async function setDphMemberDivisionAssignments(
  profileId: number,
  assignments: DphAssignmentInput[],
): Promise<DphDivisionAssignment[]> {
  const existingFlags = await pool.query<{
    division_id: number;
    division_rank: string;
    is_manual: boolean | number | null;
    can_edit_resources: boolean | number | null;
    can_edit_roster: boolean | number | null;
    can_edit_info: boolean | number | null;
  }>(
    `SELECT division_id, division_rank,
            COALESCE(is_manual, false) AS is_manual,
            COALESCE(can_edit_resources, false) AS can_edit_resources,
            COALESCE(can_edit_roster, false) AS can_edit_roster,
            COALESCE(can_edit_info, false) AS can_edit_info
     FROM dph_user_divisions WHERE profile_id = $1`,
    [profileId],
  );
  const previousRankByDiv = new Map(
    existingFlags.rows.map(r => [r.division_id, String(r.division_rank ?? "").trim()]),
  );
  const flagMap = new Map(existingFlags.rows.map(r => [r.division_id, {
    is_manual: Boolean(r.is_manual),
    can_edit_resources: Boolean(r.can_edit_resources),
    can_edit_roster: Boolean(r.can_edit_roster),
    can_edit_info: Boolean(r.can_edit_info),
  }]));

  const cleaned: Required<DphAssignmentInput>[] = [];
  const seen = new Set<number>();
  for (const a of assignments) {
    const divisionId = Number(a.division_id);
    const rankName = String(a.division_rank ?? "").trim();
    if (!Number.isInteger(divisionId) || divisionId <= 0 || !rankName) continue;
    if (seen.has(divisionId)) continue;
    if (isDivisionUnrankedRank(rankName)) {
      const divOk = await pool.query(
        `SELECT 1 AS ok FROM dph_divisions WHERE id = $1 LIMIT 1`,
        [divisionId],
      );
      if (!divOk.rows.length) continue;
    } else {
      const ok = await pool.query(
        `SELECT 1 AS ok FROM dph_division_ranks
         WHERE division_id = $1 AND lower(name) = lower($2) LIMIT 1`,
        [divisionId, rankName],
      );
      if (!ok.rows.length) continue;
    }
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

  await pool.query(`DELETE FROM dph_user_divisions WHERE profile_id = $1`, [profileId]);
  for (const a of cleaned) {
    await pool.query(
      `INSERT INTO dph_user_divisions
         (profile_id, division_id, division_rank, is_manual, can_edit_resources, can_edit_roster, can_edit_info)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [profileId, a.division_id, a.division_rank, a.is_manual, a.can_edit_resources, a.can_edit_roster, a.can_edit_info],
    );
  }

  await pool.query(
    `UPDATE dph_users SET division_rank = $2, updated_at = NOW() WHERE profile_id = $1`,
    [profileId, cleaned[0]?.division_rank ?? null],
  );

  for (const a of cleaned) {
    const prevRank = previousRankByDiv.get(a.division_id) ?? "";
    if (isDivisionUnrankedRank(a.division_rank) && !isDivisionUnrankedRank(prevRank)) {
      await restoreDphPersonnelCallsignFromRank(profileId);
      break;
    }
  }

  const map = await loadDphDivisionAssignments([profileId]);
  return map.get(profileId) ?? [];
}

async function autoAssignDphPersonnelCallsign(rankName: string, profileId: number): Promise<string | null> {
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
    }
  } catch { /* non-fatal */ }
  return null;
}

export async function restoreDphPersonnelCallsignFromRank(profileId: number): Promise<void> {
  try {
    const res = await pool.query<{ dph_rank: string | null }>(
      `SELECT dph_rank FROM dph_users WHERE profile_id = $1 LIMIT 1`,
      [profileId],
    );
    const rank = res.rows[0]?.dph_rank?.trim();
    if (!rank) return;
    const auto = await autoAssignDphPersonnelCallsign(rank, profileId);
    if (!auto) return;
    await pool.query(
      `UPDATE dph_users SET callsign = $2, updated_at = NOW() WHERE profile_id = $1`,
      [profileId, auto],
    );
  } catch { /* non-fatal */ }
}

/** Migrate legacy single dph_users.division_rank into dph_user_divisions (idempotent). */
export async function migrateLegacyDphDivisionAssignments(): Promise<void> {
  try {
    await pool.query(`
      INSERT INTO dph_user_divisions (profile_id, division_id, division_rank)
      SELECT u.profile_id, dr.division_id, u.division_rank
      FROM dph_users u
      JOIN dph_division_ranks dr ON lower(dr.name) = lower(u.division_rank)
      WHERE u.division_rank IS NOT NULL AND trim(u.division_rank) != ''
        AND dr.division_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM dph_user_divisions x
          WHERE x.profile_id = u.profile_id AND x.division_id = dr.division_id
        )
    `);
  } catch (err) {
    console.warn("[dph] legacy division assignment migrate skipped:", err);
  }
}
