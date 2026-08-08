import { pool } from "@workspace/db";

/**
 * Discord user IDs with unrestricted CAD access (every portal / department).
 * Also configurable via SUPERADMIN_DISCORD_IDS (comma-separated) in .env.
 */
const BUILTIN_SUPERADMIN_DISCORD_IDS = [
  "859843966714642492",
  "723528247035559998",
  "542013385827418125",
] as const;

export function getSuperAdminDiscordIds(): Set<string> {
  const fromEnv = (process.env.SUPERADMIN_DISCORD_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return new Set<string>([...BUILTIN_SUPERADMIN_DISCORD_IDS, ...fromEnv]);
}

export function isSuperAdminDiscordId(discordId: string | null | undefined): boolean {
  if (!discordId) return false;
  return getSuperAdminDiscordIds().has(discordId);
}

/** Ensure Executive Team group exists with full portal flags; never overwrite roster ranks. */
export async function ensureSuperAdminAccess(discordId: string, profileId: number): Promise<void> {
  if (!isSuperAdminDiscordId(discordId)) return;

  const existing = await pool.query<{ id: number }>(
    `SELECT id FROM staff_rank_groups WHERE lower(name) = 'executive team' LIMIT 1`,
  );

  if (existing.rows.length === 0) {
    await pool.query(
      `INSERT INTO staff_rank_groups (name, sort_order, locked, staff_access, admin_access, doc_access)
       VALUES ('Executive Team', 0, TRUE, TRUE, TRUE, TRUE)`,
    );
  } else {
    await pool.query(
      `UPDATE staff_rank_groups
       SET locked = TRUE, staff_access = TRUE, admin_access = TRUE, doc_access = TRUE
       WHERE id = $1`,
      [existing.rows[0].id],
    );
  }

  // Whitelist for offline CAD sign-in only — keep whatever staff roster rank they already have.
  await pool.query(
    `UPDATE cad_user_profiles
     SET whitelisted = TRUE,
         updated_at  = NOW()
     WHERE id = $1`,
    [profileId],
  );
}
