import { COMMUNITY_GUILD_ID } from "./discord-auth.js";

/** Northpoint DPS Discord server — rank linking, roster sync, division roles. */
export const NRP_DPS_DISCORD_GUILD_ID = "1539660726338326571";

function normalizeGuildId(raw: string | null | undefined): string {
  return (raw ?? "").trim();
}

function warnIfCommunityMisconfig(envKey: string, configured: string, resolved: string): void {
  if (configured !== COMMUNITY_GUILD_ID) return;
  console.warn(
    `[discord] ${envKey} was set to the community guild (${COMMUNITY_GUILD_ID}); using ${resolved} instead.`,
  );
}

/** Resolve DPS guild ID, ignoring legacy misconfig that pointed at the community server. */
export function resolveDpsDiscordGuildId(): string {
  const fromEnv = normalizeGuildId(process.env.DPS_DISCORD_GUILD_ID);
  if (!fromEnv || fromEnv === COMMUNITY_GUILD_ID) {
    if (fromEnv === COMMUNITY_GUILD_ID) {
      warnIfCommunityMisconfig("DPS_DISCORD_GUILD_ID", fromEnv, NRP_DPS_DISCORD_GUILD_ID);
    }
    return NRP_DPS_DISCORD_GUILD_ID;
  }
  return fromEnv;
}

/** Resolve division roster guild ID — defaults to the DPS guild. */
export function resolveDivisionDiscordGuildId(dpsGuildId = resolveDpsDiscordGuildId()): string {
  const fromEnv = normalizeGuildId(process.env.DIVISION_DISCORD_GUILD_ID);
  if (!fromEnv || fromEnv === COMMUNITY_GUILD_ID) {
    if (fromEnv === COMMUNITY_GUILD_ID) {
      warnIfCommunityMisconfig("DIVISION_DISCORD_GUILD_ID", fromEnv, dpsGuildId);
    }
    return dpsGuildId;
  }
  return fromEnv;
}

export const DPS_GUILD_ID = resolveDpsDiscordGuildId();
export const DIVISION_GUILD_ID = resolveDivisionDiscordGuildId(DPS_GUILD_ID);

/** Resolve staff roster guild ID — defaults to the main community server. */
export function resolveStaffDiscordGuildId(): string {
  const fromEnv = normalizeGuildId(process.env.STAFF_DISCORD_GUILD_ID);
  return fromEnv || COMMUNITY_GUILD_ID;
}

export const STAFF_GUILD_ID = resolveStaffDiscordGuildId();
