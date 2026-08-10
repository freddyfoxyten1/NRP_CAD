import type { Request } from "express";
import { pool } from "@workspace/db";
import { denyMessageForMode, getCadMode, modeToOnline, type CadMode } from "./cad-mode";
import { isSuperAdminDiscordId } from "./superadmin";

export const COMMUNITY_GUILD_ID =
  process.env.DISCORD_GUILD_ID ?? "823606319529066548";

export type CommunityGuildJoinInfo = {
  guild_name: string;
  invite_code: string | null;
  invite_url: string | null;
};

function normalizeInviteCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const fromUrl = trimmed.match(/(?:discord\.gg|discord\.com\/invite)\/([A-Za-z0-9-]+)/i);
  if (fromUrl?.[1]) return fromUrl[1];
  return trimmed.replace(/^\/+/, "");
}

/** Resolve Discord server display name + invite for the not-in-guild join prompt. */
export async function getCommunityGuildJoinInfo(): Promise<CommunityGuildJoinInfo> {
  const envName = (process.env.DISCORD_SERVER_NAME ?? "").trim();
  const envInvite = normalizeInviteCode(
    process.env.DISCORD_INVITE_CODE ?? process.env.DISCORD_INVITE_URL ?? "",
  );

  let guildName = envName || "DOJRP";
  let inviteCode = envInvite;

  if (process.env.DISCORD_BOT_TOKEN) {
    try {
      const response = await discordBotFetch(
        `https://discord.com/api/v10/guilds/${COMMUNITY_GUILD_ID}?with_counts=false`,
      );
      if (response.ok) {
        const guild = (await response.json()) as {
          name?: string;
          vanity_url_code?: string | null;
        };
        if (!envName && guild.name?.trim()) guildName = guild.name.trim();
        if (!inviteCode && guild.vanity_url_code) {
          inviteCode = normalizeInviteCode(guild.vanity_url_code);
        }
      }
    } catch {
      /* keep env / defaults */
    }
  }

  return {
    guild_name: guildName,
    invite_code: inviteCode,
    invite_url: inviteCode ? `https://discord.gg/${inviteCode}` : null,
  };
}

export type CadSessionPayload = {
  id: number;
  username: string;
  email: string;
  rank: string;
  role: string;
  status: string;
  dps_rank: string | null;
  dps_role: string | null;
  staff_rank: string | null;
  staff_role: string | null;
  discord_id: string | null;
  avatar_hash: string | null;
  can_access_iab: boolean;
  can_access_system_logs: boolean;
  can_access_terms_privacy: boolean;
  can_access_terminal_offline: boolean;
};

export function getRedirectUri(req: Request): string {
  if (process.env.DISCORD_REDIRECT_URI) {
    return process.env.DISCORD_REDIRECT_URI;
  }

  const host =
    (req.headers["x-forwarded-host"] as string | undefined)?.split(",")[0].trim() ||
    req.headers.host;

  if (!host) {
    throw new Error("Cannot determine host for redirect URI");
  }

  const forwardedProto = (req.headers["x-forwarded-proto"] as string | undefined)
    ?.split(",")[0]
    .trim();
  const isLocal = host.startsWith("localhost") || host.startsWith("127.0.0.1");
  const proto = forwardedProto || (isLocal ? "http" : "https");

  return `${proto}://${host}/dojcad/discord-callback`;
}

export async function discordBotFetch(url: string): Promise<Response> {
  const token = process.env.DISCORD_BOT_TOKEN ?? "";
  let response = await fetch(url, {
    headers: { Authorization: `Bot ${token}` },
    signal: AbortSignal.timeout(8_000),
  });

  if (response.status === 429) {
    const body = (await response.json().catch(() => ({}))) as { retry_after?: number };
    const waitMs = Math.min((body.retry_after ?? 1) * 1000 + 200, 10_000);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    response = await fetch(url, {
      headers: { Authorization: `Bot ${token}` },
      signal: AbortSignal.timeout(8_000),
    });
  }

  return response;
}

export async function isCommunityGuildMember(discordId: string): Promise<boolean | null> {
  if (!process.env.DISCORD_BOT_TOKEN) {
    return null;
  }

  const response = await discordBotFetch(
    `https://discord.com/api/v10/guilds/${COMMUNITY_GUILD_ID}/members/${discordId}`,
  );

  // Only treat an explicit unknown-member 404 as "not in guild".
  // 401/403/5xx usually mean the bot is misconfigured (wrong app, missing
  // Server Members Intent, or not invited) — those must not block sign-in.
  if (response.status === 404) {
    const body = (await response.json().catch(() => ({}))) as { code?: number; message?: string };
    // Discord "Unknown Member" is code 10007; "Unknown Guild" is 10004 (bot not in server)
    if (body.code === 10004) {
      return null;
    }
    return false;
  }

  if (!response.ok) {
    return null;
  }

  return true;
}

/** Check membership using the user's OAuth token (scope: guilds). Preferred over bot lookup. */
export async function isCommunityGuildMemberViaOAuth(
  accessToken: string,
): Promise<boolean | null> {
  try {
    const response = await fetch("https://discord.com/api/v10/users/@me/guilds", {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(8_000),
    });

    if (!response.ok) {
      return null;
    }

    const guilds = (await response.json()) as Array<{ id: string }>;
    return guilds.some((g) => g.id === COMMUNITY_GUILD_ID);
  } catch {
    return null;
  }
}

export async function loadCadSession(profileId: number): Promise<CadSessionPayload | null> {
  const result = await pool.query<CadSessionPayload>(
    `SELECT p.id, p.username, p.email, p.rank, p.role, p.status,
            COALESCE(NULLIF(d.dps_rank, ''), p.dps_rank) AS dps_rank,
            COALESCE(NULLIF(d.dps_role, ''), p.dps_role) AS dps_role,
            p.staff_rank, p.staff_role,
            NULLIF(p.discord_id, '') AS discord_id,
            NULLIF(p.avatar_hash, '') AS avatar_hash,
            COALESCE(p.can_access_iab, false) AS can_access_iab,
            COALESCE(p.can_access_system_logs, false) AS can_access_system_logs,
            COALESCE(p.can_access_terms_privacy, false) AS can_access_terms_privacy,
            COALESCE(p.can_access_terminal_offline, false) AS can_access_terminal_offline
     FROM cad_user_profiles p
     LEFT JOIN dps_users d ON d.profile_id = p.id
     WHERE p.id = $1
     LIMIT 1`,
    [profileId],
  );

  const row = result.rows[0];
  if (!row) return null;
  return {
    ...row,
    can_access_iab: Boolean(row.can_access_iab),
    can_access_system_logs: Boolean(row.can_access_system_logs),
    can_access_terms_privacy: Boolean(row.can_access_terms_privacy),
    can_access_terminal_offline: Boolean(row.can_access_terminal_offline),
  };
}

function hasStaffAssignment(staffRole: string | null | undefined, staffRank: string | null | undefined): boolean {
  return Boolean(staffRole?.trim() || staffRank?.trim());
}

export async function canSignInForCadMode(profileId: number): Promise<{
  allowed: boolean;
  mode: CadMode;
  error?: string;
}> {
  const mode = await getCadMode();
  if (mode === "online") {
    return { allowed: true, mode };
  }

  const result = await pool.query<{
    staff_role: string | null;
    staff_rank: string | null;
    discord_id: string | null;
    can_access_terminal_offline: boolean | number | null;
  }>(
    `SELECT staff_role, staff_rank, discord_id,
            COALESCE(can_access_terminal_offline, false) AS can_access_terminal_offline
     FROM cad_user_profiles
     WHERE id = $1
     LIMIT 1`,
    [profileId],
  );

  const account = result.rows[0];
  if (!account) {
    return { allowed: false, mode, error: denyMessageForMode(mode) };
  }

  if (isSuperAdminDiscordId(account.discord_id)) {
    return { allowed: true, mode };
  }

  if (mode === "members_locked") {
    if (hasStaffAssignment(account.staff_role, account.staff_rank)) {
      return { allowed: true, mode };
    }
    return { allowed: false, mode, error: denyMessageForMode(mode) };
  }

  // lockdown
  if (Boolean(account.can_access_terminal_offline)) {
    return { allowed: true, mode };
  }
  return { allowed: false, mode, error: denyMessageForMode(mode) };
}

/** @deprecated Prefer canSignInForCadMode — kept for call-site compatibility. */
export async function canSignInWhileCadOffline(profileId: number): Promise<boolean> {
  const result = await canSignInForCadMode(profileId);
  return result.allowed;
}

export async function isCadOnline(): Promise<boolean> {
  return modeToOnline(await getCadMode());
}

export async function createCadAccountFromDiscord(input: {
  id: string;
  username: string;
  avatarHash?: string | null;
}): Promise<CadSessionPayload> {
  let cadUsername = input.username
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");

  if (!cadUsername) {
    cadUsername = `user_${input.id.slice(-6)}`;
  }

  const taken = await pool.query<{ username: string }>(
    `SELECT username FROM cad_user_profiles WHERE lower(username) = lower($1) LIMIT 1`,
    [cadUsername],
  );

  if (taken.rows.length > 0) {
    cadUsername = `${cadUsername}_${input.id.slice(-4)}`;
  }

  const email = `discord_${input.id}@discord.local`;
  const authUserId = `discord-${input.id}`;

  const inserted = await pool.query<{ id: number }>(
    `INSERT INTO cad_user_profiles
       (auth_user_id, username, discord_username, discord_id, email,
        community_code, rank, role, status, callsign, avatar_hash, password_salt, password_hash)
     VALUES ($1,$2,$3,$4,$5,$6,'Member','Community Members','active','4D-XX',$7,'','')
     RETURNING id`,
    [
      authUserId,
      cadUsername,
      input.username,
      input.id,
      email,
      "DISCORD",
      input.avatarHash ?? "",
    ],
  );

  const session = await loadCadSession(inserted.rows[0].id);
  if (!session) {
    throw new Error("Unable to load newly created account.");
  }

  return session;
}
