import type pg from "pg";

type Pool = pg.Pool;

export async function dpsRosterRowExists(pool: Pool, profileId: number): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM dps_users WHERE profile_id = $1 LIMIT 1`,
    [profileId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function dphRosterRowExists(pool: Pool, profileId: number): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM dph_users WHERE profile_id = $1 LIMIT 1`,
    [profileId],
  );
  return (result.rowCount ?? 0) > 0;
}

/** Clear Access Permissions modal grants (Resources + IAB) for one DPS member. */
export async function resetDpsMemberAccessPermissions(pool: Pool, profileId: number): Promise<void> {
  await pool.query(
    `UPDATE dps_users
        SET can_view_all_resources = false, updated_at = NOW()
      WHERE profile_id = $1`,
    [profileId],
  );
  await pool.query(
    `UPDATE cad_user_profiles
        SET can_access_iab = false, updated_at = NOW()
      WHERE id = $1`,
    [profileId],
  );
}

/** Clear Access Permissions modal grants (Resources + IAB) for one DPH member. */
export async function resetDphMemberAccessPermissions(pool: Pool, profileId: number): Promise<void> {
  await pool.query(
    `UPDATE dph_users
        SET can_view_all_resources = false,
            can_access_iab = false,
            updated_at = NOW()
      WHERE profile_id = $1`,
    [profileId],
  );
}

/** Clear individual DPS permission grants for one roster member. */
export async function resetDpsMemberPermissionGrants(pool: Pool, profileId: number): Promise<void> {
  await pool.query(
    `UPDATE dps_users
        SET can_view_all_resources = false, updated_at = NOW()
      WHERE profile_id = $1`,
    [profileId],
  );
  await pool.query(
    `UPDATE cad_user_profiles
        SET can_access_iab = false, updated_at = NOW()
      WHERE id = $1`,
    [profileId],
  );
  await pool.query(
    `UPDATE dps_user_divisions
        SET can_edit_resources = false,
            can_edit_roster = false,
            can_edit_info = false
      WHERE profile_id = $1`,
    [profileId],
  );
}

/** Clear individual DPH permission grants for one roster member. */
export async function resetDphMemberPermissionGrants(pool: Pool, profileId: number): Promise<void> {
  await pool.query(
    `UPDATE dph_users
        SET can_view_all_resources = false,
            can_access_iab = false,
            updated_at = NOW()
      WHERE profile_id = $1`,
    [profileId],
  );
  await pool.query(
    `UPDATE dph_user_divisions
        SET can_edit_resources = false,
            can_edit_roster = false,
            can_edit_info = false
      WHERE profile_id = $1`,
    [profileId],
  );
}

/** Revoke all individual DPS permission grants for every roster member. */
export async function clearAllDpsPermissionGrants(pool: Pool): Promise<{
  resources: number;
  iab: number;
  divisionEditors: number;
  titleGroups: number;
}> {
  const resources = await pool.query(
    `UPDATE dps_users SET can_view_all_resources = false, updated_at = NOW()`,
  );
  const iab = await pool.query(
    `UPDATE cad_user_profiles
        SET can_access_iab = false, updated_at = NOW()
      WHERE id IN (SELECT profile_id FROM dps_users)`,
  );
  const divisionEditors = await pool.query(
    `UPDATE dps_user_divisions
        SET can_edit_resources = false,
            can_edit_roster = false,
            can_edit_info = false`,
  );
  const titleGroups = await pool.query(
    `UPDATE dps_rank_groups
        SET panel_access = false,
            division_oversight = false`,
  );
  return {
    resources: Number(resources.rowCount ?? 0),
    iab: Number(iab.rowCount ?? 0),
    divisionEditors: Number(divisionEditors.rowCount ?? 0),
    titleGroups: Number(titleGroups.rowCount ?? 0),
  };
}

/** Revoke all individual DPH permission grants for every roster member. */
export async function clearAllDphPermissionGrants(pool: Pool): Promise<{
  resources: number;
  iab: number;
  divisionEditors: number;
  titleGroups: number;
}> {
  const resources = await pool.query(
    `UPDATE dph_users
        SET can_view_all_resources = false, updated_at = NOW()`,
  );
  const iab = await pool.query(
    `UPDATE dph_users
        SET can_access_iab = false, updated_at = NOW()`,
  );
  const divisionEditors = await pool.query(
    `UPDATE dph_user_divisions
        SET can_edit_resources = false,
            can_edit_roster = false,
            can_edit_info = false`,
  );
  const titleGroups = await pool.query(
    `UPDATE dph_rank_groups
        SET panel_access = false,
            division_oversight = false`,
  );
  return {
    resources: Number(resources.rowCount ?? 0),
    iab: Number(iab.rowCount ?? 0),
    divisionEditors: Number(divisionEditors.rowCount ?? 0),
    titleGroups: Number(titleGroups.rowCount ?? 0),
  };
}

async function staffRosterFilterNames(pool: Pool): Promise<{ groupNames: string[]; rankNames: string[] }> {
  const groupsRes = await pool.query<{ name: string }>(`SELECT name FROM staff_rank_groups`);
  const ranksRes = await pool.query<{ name: string }>(`SELECT name FROM staff_ranks`);
  return {
    groupNames: groupsRes.rows.map(r => String(r.name).trim().toLowerCase()).filter(Boolean),
    rankNames: ranksRes.rows.map(r => String(r.name).trim().toLowerCase()).filter(Boolean),
  };
}

const STAFF_ROSTER_WHERE = `(
  lower(COALESCE(staff_role, '')) = ANY($1::text[])
  OR (
    staff_rank IS NOT NULL AND staff_rank != ''
    AND lower(staff_rank) = ANY($2::text[])
  )
)`;

/** Clear Access Permissions modal grants for one staff roster member. */
export async function resetStaffMemberAccessPermissions(pool: Pool, profileId: number): Promise<void> {
  await pool.query(
    `UPDATE cad_user_profiles
        SET can_access_iab = false,
            can_access_system_logs = false,
            can_access_terms_privacy = false,
            can_access_terminal_offline = false,
            can_access_doc_dps_cad = false,
            updated_at = NOW()
      WHERE id = $1`,
    [profileId],
  );
}

/** Revoke all individual staff Access Permissions grants for every roster member. */
export async function clearAllStaffAccessPermissions(pool: Pool): Promise<{
  members: number;
  titleGroups: number;
}> {
  const { groupNames, rankNames } = await staffRosterFilterNames(pool);
  const members = await pool.query(
    `UPDATE cad_user_profiles
        SET can_access_iab = false,
            can_access_system_logs = false,
            can_access_terms_privacy = false,
            can_access_terminal_offline = false,
            can_access_doc_dps_cad = false,
            updated_at = NOW()
      WHERE ${STAFF_ROSTER_WHERE}`,
    [groupNames, rankNames],
  );
  const titleGroups = await pool.query(
    `UPDATE staff_rank_groups
        SET staff_access = false,
            admin_access = false,
            doc_access = false
      WHERE locked = false`,
  );
  return {
    members: Number(members.rowCount ?? 0),
    titleGroups: Number(titleGroups.rowCount ?? 0),
  };
}
