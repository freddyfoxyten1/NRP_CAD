import { Router } from "express";
import { pool } from "@workspace/db";
import { heartbeat } from "../lib/online-tracker";

const router = Router();

const digest = async (value: string) => {
  const encoded = new TextEncoder().encode(value);
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(hashBuffer), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

const hashPassword = (password: string, salt: string) => digest(`${salt}:${password}`);

router.post("/cad-auth/sign-in", async (req, res) => {
  try {
    const body = req.body as { username?: string; password?: string };
    const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!username || !password) {
      res.json(null);
      return;
    }

    const result = await pool.query<{
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
      password_salt: string | null;
      password_hash: string | null;
      can_access_iab: boolean | number | null;
      can_access_system_logs: boolean | number | null;
      can_access_terms_privacy: boolean | number | null;
    }>(
      `SELECT p.id, p.username, p.email, p.rank, p.role, p.status,
              COALESCE(NULLIF(d.dps_rank,''), p.dps_rank) AS dps_rank,
              COALESCE(NULLIF(d.dps_role,''), p.dps_role) AS dps_role,
              p.staff_rank, p.staff_role,
              p.password_salt, p.password_hash,
              COALESCE(p.can_access_iab, false) AS can_access_iab,
              COALESCE(p.can_access_system_logs, false) AS can_access_system_logs,
              COALESCE(p.can_access_terms_privacy, false) AS can_access_terms_privacy
       FROM cad_user_profiles p
       LEFT JOIN dps_users d ON d.profile_id = p.id
       WHERE lower(p.username) = $1
       LIMIT 1`,
      [username]
    );

    const account = result.rows[0];

    if (!account?.password_salt || !account.password_hash) {
      res.json(null);
      return;
    }

    const passwordHash = await hashPassword(password, account.password_salt);

    if (passwordHash !== account.password_hash) {
      res.json(null);
      return;
    }

    // Check if CAD is online — if offline, only admin roles + whitelisted accounts may sign in.
    // Prefer staff_role (new) over legacy role field.
    const effectiveRole = (account.staff_role ?? account.role).toLowerCase();
    const isPrivileged =
      ["executive team", "owner", "executive", "executive board", "management", "admin"].includes(effectiveRole);

    if (!isPrivileged) {
      const whitelistCheck = await pool.query<{ whitelisted: boolean }>(
        `SELECT whitelisted FROM cad_user_profiles WHERE id=$1 LIMIT 1`,
        [account.id]
      );
      const whitelisted = whitelistCheck.rows[0]?.whitelisted ?? false;

      if (!whitelisted) {
        const statusCheck = await pool.query<{ value: string }>(
          `SELECT value FROM cad_settings WHERE key='cad_online' LIMIT 1`
        );
        const cadOnline = statusCheck.rows[0]?.value !== "false";

        if (!cadOnline) {
          res.status(503).json({ error: "CAD is currently offline. Only administrators may sign in." });
          return;
        }
      }
    }

    res.json({
      id:         account.id,
      username:   account.username,
      email:      account.email,
      rank:       account.rank,
      role:       account.role,
      status:     account.status,
      dps_rank:   account.dps_rank,
      dps_role:   account.dps_role,
      staff_rank: account.staff_rank,
      staff_role: account.staff_role,
      can_access_iab: Boolean(account.can_access_iab),
      can_access_system_logs: Boolean(account.can_access_system_logs),
      can_access_terms_privacy: Boolean(account.can_access_terms_privacy),
    });
  } catch (err) {
    req.log.error({ err }, "cad-auth/sign-in error");
    res.status(500).json({ error: err instanceof Error ? err.message : "Sign in failed." });
  }
});

router.post("/cad-auth/session-status", async (req, res) => {
  try {
    const body = req.body as { id?: number; email?: string };
    const id = Number(body.id);
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";

    if (!Number.isInteger(id) || !email) {
      res.json({ active: false });
      return;
    }

    const result = await pool.query<{
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
      can_access_iab: boolean | number | null;
      can_access_system_logs: boolean | number | null;
      can_access_terms_privacy: boolean | number | null;
    }>(
      `SELECT p.id, p.username, p.email, p.rank, p.role, p.status,
              COALESCE(NULLIF(d.dps_rank,''), p.dps_rank) AS dps_rank,
              COALESCE(NULLIF(d.dps_role,''), p.dps_role) AS dps_role,
              p.staff_rank, p.staff_role,
              p.discord_id, p.avatar_hash,
              COALESCE(p.can_access_iab, false) AS can_access_iab,
              COALESCE(p.can_access_system_logs, false) AS can_access_system_logs,
              COALESCE(p.can_access_terms_privacy, false) AS can_access_terms_privacy
       FROM cad_user_profiles p
       LEFT JOIN dps_users d ON d.profile_id = p.id
       WHERE p.id = $1 AND lower(p.email) = $2
       LIMIT 1`,
      [id, email]
    );

    const account = result.rows[0];
    if (account) heartbeat(account.id);
    res.json(account ? {
      active: true,
      account: {
        ...account,
        can_access_iab: Boolean(account.can_access_iab),
        can_access_system_logs: Boolean(account.can_access_system_logs),
        can_access_terms_privacy: Boolean(account.can_access_terms_privacy),
      },
    } : { active: false });
  } catch (err) {
    req.log.error({ err }, "cad-auth/session-status error");
    res.status(500).json({ error: err instanceof Error ? err.message : "Session status check failed." });
  }
});

export default router;
