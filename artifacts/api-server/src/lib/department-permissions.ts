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
}> {
  const resources = await pool.query(
    `UPDATE dps_users SET can_view_all_resources = false, updated_at = NOW()
     WHERE can_view_all_resources = true`,
  );
  const iab = await pool.query(
    `UPDATE cad_user_profiles
        SET can_access_iab = false, updated_at = NOW()
      WHERE can_access_iab = true
        AND id IN (SELECT profile_id FROM dps_users)`,
  );
  const divisionEditors = await pool.query(
    `UPDATE dps_user_divisions
        SET can_edit_resources = false,
            can_edit_roster = false,
            can_edit_info = false
      WHERE can_edit_resources = true
         OR can_edit_roster = true
         OR can_edit_info = true`,
  );
  return {
    resources: Number(resources.rowCount ?? 0),
    iab: Number(iab.rowCount ?? 0),
    divisionEditors: Number(divisionEditors.rowCount ?? 0),
  };
}

/** Revoke all individual DPH permission grants for every roster member. */
export async function clearAllDphPermissionGrants(pool: Pool): Promise<{
  resources: number;
  iab: number;
  divisionEditors: number;
}> {
  const resources = await pool.query(
    `UPDATE dph_users
        SET can_view_all_resources = false, updated_at = NOW()
      WHERE can_view_all_resources = true`,
  );
  const iab = await pool.query(
    `UPDATE dph_users
        SET can_access_iab = false, updated_at = NOW()
      WHERE can_access_iab = true`,
  );
  const divisionEditors = await pool.query(
    `UPDATE dph_user_divisions
        SET can_edit_resources = false,
            can_edit_roster = false,
            can_edit_info = false
      WHERE can_edit_resources = true
         OR can_edit_roster = true
         OR can_edit_info = true`,
  );
  return {
    resources: Number(resources.rowCount ?? 0),
    iab: Number(iab.rowCount ?? 0),
    divisionEditors: Number(divisionEditors.rowCount ?? 0),
  };
}
