import { Router } from "express";
import { pool } from "@workspace/db";

const router = Router();

const REQUIRED_COMMUNITY_CODE = "SMR2026";
const DEFAULT_RANK = "Member";
const DEFAULT_ROLE = "Community Members";
const DEFAULT_STATUS = "active";

const requireString = (value: unknown, field: string): string => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} is required.`);
  }
  return value.trim();
};

router.post("/cad-profiles", async (req, res) => {
  try {
    const body = req.body as {
      auth_user_id?: string;
      username?: string;
      discord_username?: string;
      discord_id?: string;
      email?: string;
      community_code?: string;
      role?: string;
      password_salt?: string;
      password_hash?: string;
    };

    const authUserId = requireString(body.auth_user_id, "Auth user ID");
    const username = requireString(body.username, "Username");
    const discordUsername = typeof body.discord_username === "string" ? body.discord_username.trim() : "";
    const discordId = typeof body.discord_id === "string" ? body.discord_id.trim() : "";
    const email = requireString(body.email, "Email").toLowerCase();
    const communityCode = requireString(body.community_code, "Community code").toUpperCase();
    const role = typeof body.role === "string" && body.role.trim() ? body.role.trim().toLowerCase() : DEFAULT_ROLE;
    const passwordSalt = requireString(body.password_salt, "Password salt");
    const passwordHash = requireString(body.password_hash, "Password hash");

    if (communityCode !== REQUIRED_COMMUNITY_CODE) {
      res.status(403).json({ error: "Invalid community code." });
      return;
    }

    const result = await pool.query<{ id: number }>(
      `INSERT INTO cad_user_profiles (
        auth_user_id, username, discord_username, discord_id, email,
        community_code, status, rank, role, callsign, password_salt, password_hash
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT (email) DO UPDATE SET
        auth_user_id = EXCLUDED.auth_user_id,
        username = EXCLUDED.username,
        discord_username = EXCLUDED.discord_username,
        discord_id = EXCLUDED.discord_id,
        community_code = EXCLUDED.community_code,
        status = EXCLUDED.status,
        role = EXCLUDED.role,
        password_salt = EXCLUDED.password_salt,
        password_hash = EXCLUDED.password_hash,
        updated_at = now()
      RETURNING id`,
      [authUserId, username, discordUsername, discordId, email, communityCode, DEFAULT_STATUS, DEFAULT_RANK, role, "4D-XX", passwordSalt, passwordHash]
    );

    res.json(result.rows[0]);
  } catch (err) {
    req.log.error({ err }, "cad-profiles error");
    res.status(500).json({ error: err instanceof Error ? err.message : "CAD profile request failed." });
  }
});

export default router;
