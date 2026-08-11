// ─────────────────────────────────────────────────────────────────────────────
// lib/dph-discord.ts  —  Shared DPH Discord guild access
//
// The DPH personnel roster (routes/dph.ts) and the DPH division roster
// (routes/dph-divisions.ts) both need the same guild role list, the same member
// pagination and the same CAD-profile reconciliation. Keeping them here means a
// single member cache and a single Discord pagination per sync cycle.
// ─────────────────────────────────────────────────────────────────────────────
import { pool } from "@workspace/db";

/** DPH Discord server — role linking & membership checks. */
export const DPH_GUILD_ID = process.env.DPH_DISCORD_GUILD_ID ?? "1519857439220957204";

/** Guild used for DPH Division Roster role links — defaults to the DPH guild. */
export const DPH_DIVISION_GUILD_ID =
  process.env.DPH_DIVISION_DISCORD_GUILD_ID ?? DPH_GUILD_ID;

export type DiscordRole = { id: string; name: string; position: number };

export type DphGuildMember = {
  user: { id: string; username: string; avatar?: string | null };
  nick?: string | null;
  roles: string[];
};

export type DphMemberCacheEntry = { id: string; username: string; nick: string | null };

const ROLES_TTL_MS = 30 * 60 * 1000;
const MEMBERS_TTL_MS = 5 * 60 * 1000;

const rolesCache: { roles: DiscordRole[] | null; fetchedAt: number } = { roles: null, fetchedAt: 0 };
const divisionRolesCache: { roles: DiscordRole[] | null; fetchedAt: number } = { roles: null, fetchedAt: 0 };
const membersCache: { members: DphMemberCacheEntry[]; fetchedAt: number } = { members: [], fetchedAt: 0 };
let membersFetchRunning: Promise<DphMemberCacheEntry[]> | null = null;

export async function dphDiscordFetch(url: string): Promise<globalThis.Response> {
  const tok = process.env.DISCORD_BOT_TOKEN ?? "";
  let r = await fetch(url, { headers: { Authorization: `Bot ${tok}` } });
  if (r.status === 429) {
    const body = (await r.json().catch(() => ({}))) as { retry_after?: number };
    await new Promise(res => setTimeout(res, Math.min((body.retry_after ?? 1) * 1000 + 200, 10_000)));
    r = await fetch(url, { headers: { Authorization: `Bot ${tok}` } });
  }
  return r;
}

async function fetchGuildRoles(guildId: string, label: string): Promise<DiscordRole[]> {
  const r = await dphDiscordFetch(`https://discord.com/api/v10/guilds/${guildId}/roles`);
  if (!r.ok) throw new Error(`${label} Discord roles fetch failed: ${r.status}`);
  const all = (await r.json()) as DiscordRole[];
  return all.filter(x => x.name !== "@everyone").sort((a, b) => b.position - a.position);
}

export async function getDphGuildRoles(): Promise<DiscordRole[]> {
  if (rolesCache.roles && Date.now() - rolesCache.fetchedAt < ROLES_TTL_MS) return rolesCache.roles;
  rolesCache.roles = await fetchGuildRoles(DPH_GUILD_ID, "DPH");
  rolesCache.fetchedAt = Date.now();
  return rolesCache.roles;
}

export async function getDphDivisionGuildRoles(): Promise<DiscordRole[]> {
  if (DPH_DIVISION_GUILD_ID === DPH_GUILD_ID) return getDphGuildRoles();
  if (divisionRolesCache.roles && Date.now() - divisionRolesCache.fetchedAt < ROLES_TTL_MS) {
    return divisionRolesCache.roles;
  }
  divisionRolesCache.roles = await fetchGuildRoles(DPH_DIVISION_GUILD_ID, "DPH Division");
  divisionRolesCache.fetchedAt = Date.now();
  return divisionRolesCache.roles;
}

/** Paginate the DPH guild and refresh the in-memory member cache. */
export async function fetchDphGuildMembers(): Promise<DphGuildMember[]> {
  const tok = process.env.DISCORD_BOT_TOKEN;
  if (!tok) throw new Error("No DISCORD_BOT_TOKEN configured");

  let allMembers: DphGuildMember[] = [];
  let after = "0";
  for (;;) {
    const url = `https://discord.com/api/v10/guilds/${DPH_GUILD_ID}/members?limit=1000${after !== "0" ? `&after=${after}` : ""}`;
    const r = await dphDiscordFetch(url);
    if (!r.ok) throw new Error(`DPH members fetch failed: ${r.status}`);
    const batch = (await r.json()) as DphGuildMember[];
    if (batch.length === 0) break;
    allMembers = allMembers.concat(batch);
    if (batch.length < 1000) break;
    after = batch[batch.length - 1].user.id;
  }

  membersCache.members = allMembers.map(m => ({
    id: m.user.id,
    username: m.user.username,
    nick: m.nick ?? null,
  }));
  membersCache.fetchedAt = Date.now();
  return allMembers;
}

/** Paginate the DPH division guild when it differs from the main DPH guild. */
export async function fetchDphDivisionGuildMembers(): Promise<DphGuildMember[]> {
  if (DPH_DIVISION_GUILD_ID === DPH_GUILD_ID) return fetchDphGuildMembers();

  const tok = process.env.DISCORD_BOT_TOKEN;
  if (!tok) throw new Error("No DISCORD_BOT_TOKEN configured");

  let allMembers: DphGuildMember[] = [];
  let after = "0";
  for (;;) {
    const url = `https://discord.com/api/v10/guilds/${DPH_DIVISION_GUILD_ID}/members?limit=1000${after !== "0" ? `&after=${after}` : ""}`;
    const r = await dphDiscordFetch(url);
    if (!r.ok) throw new Error(`DPH division members fetch failed: ${r.status}`);
    const batch = (await r.json()) as DphGuildMember[];
    if (batch.length === 0) break;
    allMembers = allMembers.concat(batch);
    if (batch.length < 1000) break;
    after = batch[batch.length - 1].user.id;
  }
  return allMembers;
}

/** Ensure the DPH guild member cache is warm (used by the member-search typeahead). */
export async function ensureDphMembersCache(force = false): Promise<DphMemberCacheEntry[]> {
  const fresh =
    !force
    && membersCache.members.length > 0
    && Date.now() - membersCache.fetchedAt < MEMBERS_TTL_MS;
  if (fresh) return membersCache.members;

  if (!membersFetchRunning) {
    membersFetchRunning = fetchDphGuildMembers()
      .then(() => membersCache.members)
      .finally(() => { membersFetchRunning = null; });
  }
  return membersFetchRunning;
}

/** Persist Discord avatars onto matching CAD profiles (by discord_id). Only writes when changed. */
export async function refreshCadAvatarsFromGuildMembers(
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
  } catch { return; }

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

/** Find (or create) the CAD profile that backs a DPH Discord guild member. */
export async function ensureCadProfileForDphDiscordMember(
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
