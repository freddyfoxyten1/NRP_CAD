/** Discord IDs with unrestricted access to every CAD portal and department. */
const SUPERADMIN_DISCORD_IDS = new Set([
  '859843966714642492',
  '723528247035559998',
  '542013385827418125',
  // Optional Vite env (comma-separated) for local overrides without code changes
  ...String(import.meta.env.VITE_SUPERADMIN_DISCORD_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
]);

export function isSuperAdminDiscordId(discordId: string | null | undefined): boolean {
  if (!discordId) return false;
  return SUPERADMIN_DISCORD_IDS.has(discordId);
}

export function isSuperAdminSession(session: { discord_id?: string | null } | null | undefined): boolean {
  return isSuperAdminDiscordId(session?.discord_id);
}
