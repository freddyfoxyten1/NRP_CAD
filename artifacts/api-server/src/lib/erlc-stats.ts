const ERLC_BASE = "https://api.erlc.gg";
const ERLC_KEY = process.env.ERLC_API_KEY?.trim() ?? "";

type ErlcServerInfo = {
  CurrentPlayers?: number;
  MaxPlayers?: number;
};

let erlcCountCache: { inGame: number; maxPlayers: number; ts: number } | null = null;
const ERLC_TTL = 30_000;

function erlcHeaders(): Record<string, string> {
  return { "server-key": ERLC_KEY };
}

function parseCount(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

async function fetchV2ServerInfo(): Promise<{ inGame: number; maxPlayers: number } | null> {
  const res = await fetch(`${ERLC_BASE}/v2/server`, {
    headers: erlcHeaders(),
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) return null;
  const info = await res.json() as ErlcServerInfo;
  return {
    inGame: parseCount(info.CurrentPlayers),
    maxPlayers: parseCount(info.MaxPlayers),
  };
}

async function fetchV1ServerInfo(): Promise<{ inGame: number; maxPlayers: number } | null> {
  const [playersRes, serverRes] = await Promise.all([
    fetch(`${ERLC_BASE}/v1/server/players`, {
      headers: erlcHeaders(),
      signal: AbortSignal.timeout(8_000),
    }),
    fetch(`${ERLC_BASE}/v1/server`, {
      headers: erlcHeaders(),
      signal: AbortSignal.timeout(8_000),
    }),
  ]);

  const serverInfo = serverRes.ok ? await serverRes.json() as ErlcServerInfo : {};
  let inGame = parseCount(serverInfo.CurrentPlayers);

  if (!inGame && playersRes.ok) {
    const players = await playersRes.json();
    inGame = Array.isArray(players) ? players.length : 0;
  }

  const maxPlayers = parseCount(serverInfo.MaxPlayers);
  if (!inGame && !maxPlayers && !playersRes.ok && !serverRes.ok) return null;

  return { inGame, maxPlayers };
}

/** Live ER:LC player count for public index and member portal stats. */
export async function fetchInGameStats(): Promise<{ inGame: number; maxPlayers: number }> {
  if (!ERLC_KEY) return { inGame: 0, maxPlayers: 0 };
  if (erlcCountCache && Date.now() - erlcCountCache.ts < ERLC_TTL) {
    return { inGame: erlcCountCache.inGame, maxPlayers: erlcCountCache.maxPlayers };
  }

  try {
    const next = (await fetchV2ServerInfo()) ?? (await fetchV1ServerInfo());
    if (!next) {
      return { inGame: erlcCountCache?.inGame ?? 0, maxPlayers: erlcCountCache?.maxPlayers ?? 0 };
    }
    erlcCountCache = { ...next, ts: Date.now() };
    return next;
  } catch {
    return { inGame: erlcCountCache?.inGame ?? 0, maxPlayers: erlcCountCache?.maxPlayers ?? 0 };
  }
}
