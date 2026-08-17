/** Live ERLC + Discord counts from GET /api/public/stats. */
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

export async function fetchPublicLiveStats(
  signal?: AbortSignal,
): Promise<PublicLiveStats | null> {
  try {
    const res = await fetch('/api/public/stats', {
      headers: { accept: 'application/json' },
      signal: signal ?? AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Partial<PublicLiveStats>;
    return {
      erlc_players: Number(data.erlc_players) || 0,
      erlc_max_players: Number(data.erlc_max_players) || 0,
      discord_members: Number(data.discord_members) || 0,
      discord_online: Number(data.discord_online) || 0,
    };
  } catch {
    return null;
  }
}

export function publicLiveStatsOrEmpty(stats: PublicLiveStats | null): PublicLiveStats {
  return stats ?? EMPTY;
}
