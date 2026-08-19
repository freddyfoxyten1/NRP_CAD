/** Live ERLC + Discord counts from GET /api/public/stats (or Supabase fallback on GitHub Pages). */
export type PublicLiveStats = {
  erlc_players: number;
  erlc_max_players: number;
  discord_members: number;
  discord_online: number;
};

const EMPTY: PublicLiveStats = {
  erlc_players: 0,
  erlc_max_players: 0,
  discord_members: 0,
  discord_online: 0,
};

const STATS_FALLBACK_URL = String(import.meta.env.VITE_STATS_URL ?? "").trim();

function parsePublicStats(data: Partial<PublicLiveStats>): PublicLiveStats {
  return {
    erlc_players: Number(data.erlc_players) || 0,
    erlc_max_players: Number(data.erlc_max_players) || 0,
    discord_members: Number(data.discord_members) || 0,
    discord_online: Number(data.discord_online) || 0,
  };
}

function hasDiscordCounts(stats: PublicLiveStats): boolean {
  return stats.discord_members > 0 || stats.discord_online > 0;
}

async function fetchStatsUrl(
  url: string,
  signal?: AbortSignal,
): Promise<PublicLiveStats | null> {
  try {
    const res = await fetch(url, {
      headers: { accept: "application/json" },
      signal: signal ?? AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Partial<PublicLiveStats>;
    return parsePublicStats(data);
  } catch {
    return null;
  }
}

export async function fetchPublicLiveStats(
  signal?: AbortSignal,
): Promise<PublicLiveStats | null> {
  const primary = await fetchStatsUrl("/api/public/stats", signal);
  if (primary && hasDiscordCounts(primary)) return primary;

  if (STATS_FALLBACK_URL) {
    const fallback = await fetchStatsUrl(STATS_FALLBACK_URL, signal);
    if (fallback) {
      return {
        erlc_players: primary?.erlc_players ?? fallback.erlc_players,
        erlc_max_players: primary?.erlc_max_players ?? fallback.erlc_max_players,
        discord_members: fallback.discord_members,
        discord_online: fallback.discord_online,
      };
    }
  }

  return primary;
}

export function publicLiveStatsOrEmpty(stats: PublicLiveStats | null): PublicLiveStats {
  return stats ?? EMPTY;
}
