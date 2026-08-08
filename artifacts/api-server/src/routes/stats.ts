import { Router } from "express";
import { pool } from "@workspace/db";
import { getOnlineCount } from "../lib/online-tracker";

const router = Router();

// ── Lightweight ERLC player-count cache (30 s TTL) ────────────────────────────
const ERLC_BASE = "https://api.erlc.gg/v1";
const ERLC_KEY  = process.env.ERLC_API_KEY ?? "";
let erlcCountCache: { inGame: number; maxPlayers: number; ts: number } | null = null;
const ERLC_TTL = 30_000;

export async function fetchInGameStats(): Promise<{ inGame: number; maxPlayers: number }> {
  if (!ERLC_KEY) return { inGame: 0, maxPlayers: 0 };
  if (erlcCountCache && Date.now() - erlcCountCache.ts < ERLC_TTL) {
    return { inGame: erlcCountCache.inGame, maxPlayers: erlcCountCache.maxPlayers };
  }
  try {
    const [playersRes, serverRes] = await Promise.all([
      fetch(`${ERLC_BASE}/server/players`, { headers: { "Server-Key": ERLC_KEY }, signal: AbortSignal.timeout(6_000) }),
      fetch(`${ERLC_BASE}/server`,         { headers: { "Server-Key": ERLC_KEY }, signal: AbortSignal.timeout(6_000) }),
    ]);
    const players   = playersRes.ok ? await playersRes.json() as unknown[] : [];
    const serverInfo = serverRes.ok  ? await serverRes.json()  as { MaxPlayers?: number } : {};
    const inGame     = Array.isArray(players) ? players.length : 0;
    const maxPlayers = serverInfo?.MaxPlayers ?? 0;
    erlcCountCache = { inGame, maxPlayers, ts: Date.now() };
    return { inGame, maxPlayers };
  } catch {
    return { inGame: erlcCountCache?.inGame ?? 0, maxPlayers: erlcCountCache?.maxPlayers ?? 0 };
  }
}

router.get("/stats", async (req, res) => {
  try {
    const [result, erlc] = await Promise.all([
      pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM cad_user_profiles WHERE lower(status) = 'active'`
      ),
      fetchInGameStats(),
    ]);
    res.json({
      totalMembers: parseInt(result.rows[0]?.count ?? "0", 10),
      totalOnlineMembers: getOnlineCount(),
      inGameCount:    erlc.inGame,
      inGameMaxPlayers: erlc.maxPlayers,
    });
  } catch (err) {
    req.log.error({ err }, "stats GET error");
    res.status(500).json({ error: "Unable to load stats." });
  }
});

export default router;
