// Shared in-memory cache for Discord guild role lists (rank-link dropdowns).
// Invalidated on Gateway GUILD_ROLE_* events so live servers stay current.

export type DiscordGuildRole = { id: string; name: string; position: number };

const caches = new Map<string, { roles: DiscordGuildRole[]; fetchedAt: number }>();

const DEFAULT_TTL_MS = Math.max(
  30_000,
  Number(process.env.DISCORD_ROLES_CACHE_TTL_MS) || 120_000,
);

async function discordFetch(url: string): Promise<globalThis.Response> {
  const tok = process.env.DISCORD_BOT_TOKEN ?? "";
  const headers = { Authorization: `Bot ${tok}` };
  let r = await fetch(url, { headers });
  if (r.status === 429) {
    const body = (await r.json().catch(() => ({}))) as { retry_after?: number };
    await new Promise(res => setTimeout(res, Math.min((body.retry_after ?? 1) * 1000 + 200, 10_000)));
    r = await fetch(url, { headers });
  }
  return r;
}

export function invalidateDiscordGuildRolesCache(guildId?: string): void {
  if (guildId?.trim()) {
    caches.delete(guildId.trim());
    return;
  }
  caches.clear();
}

export function wantsDiscordRolesRefresh(query: Record<string, unknown>): boolean {
  const raw = query.refresh;
  return raw === "1" || raw === "true" || raw === true;
}

/** Fetch guild roles, using a short TTL cache unless refresh is requested. */
export async function getDiscordGuildRoles(
  guildId: string,
  options?: { refresh?: boolean; ttlMs?: number },
): Promise<DiscordGuildRole[]> {
  const id = guildId.trim();
  if (!id) return [];

  const ttl = options?.ttlMs ?? DEFAULT_TTL_MS;
  const cached = caches.get(id);
  if (!options?.refresh && cached && Date.now() - cached.fetchedAt < ttl) {
    return cached.roles;
  }

  const r = await discordFetch(`https://discord.com/api/v10/guilds/${id}/roles`);
  if (!r.ok) throw new Error(`Discord roles fetch failed for guild ${id}: HTTP ${r.status}`);

  const all = (await r.json()) as DiscordGuildRole[];
  const roles = all
    .filter(x => x.name !== "@everyone")
    .sort((a, b) => b.position - a.position);

  caches.set(id, { roles, fetchedAt: Date.now() });
  return roles;
}
