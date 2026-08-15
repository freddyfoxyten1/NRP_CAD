import { Router } from "express";
import { pool } from "@workspace/db";
import { fetchInGameStats } from "../lib/erlc-stats";
import { getOnlineCount } from "../lib/online-tracker";

const router = Router();

export { fetchInGameStats };

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
      inGameCount: erlc.inGame,
      inGameMaxPlayers: erlc.maxPlayers,
    });
  } catch (err) {
    req.log.error({ err }, "stats GET error");
    res.status(500).json({ error: "Unable to load stats." });
  }
});

export default router;
