import { Router } from "express";
import { pool, isMongoStore, usersRepo } from "@workspace/db";
import { canSignInForCadMode } from "../lib/discord-auth";
import { applySuperAdminSessionOverrides } from "../lib/superadmin";
import { heartbeat } from "../lib/online-tracker";

const router = Router();

const digest = async (value: string) => {
  const encoded = new TextEncoder().encode(value);
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(hashBuffer), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

const hashPassword = (password: string, salt: string) => digest(`${salt}:${password}`);

type AuthAccount = {
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
  can_access_terminal_offline: boolean | number | null;
  can_access_doc_dps_cad: boolean | number | null;
  discord_id?: string | null;
  avatar_hash?: string | null;
};

async function loadAccountByUsernameMongo(username: string): Promise<AuthAccount | null> {
  const user = await usersRepo.getUserByUsername(username);
  if (!user) return null;
  const merged = await usersRepo.withDpsRanks(user);
  return {
    id: merged.id,
    username: merged.username,
    email: String(merged.email ?? ""),
    rank: String(merged.rank ?? ""),
    role: String(merged.role ?? ""),
    status: String(merged.status ?? ""),
    dps_rank: merged.dps_rank,
    dps_role: merged.dps_role,
    staff_rank: merged.staff_rank ?? null,
    staff_role: merged.staff_role ?? null,
    password_salt: merged.password_salt ?? null,
    password_hash: merged.password_hash ?? null,
    can_access_iab: merged.can_access_iab ?? false,
    can_access_system_logs: merged.can_access_system_logs ?? false,
    can_access_terms_privacy: merged.can_access_terms_privacy ?? false,
    can_access_terminal_offline: merged.can_access_terminal_offline ?? false,
    can_access_doc_dps_cad: merged.can_access_doc_dps_cad ?? false,
  };
}

async function loadAccountByIdEmailMongo(id: number, email: string): Promise<AuthAccount | null> {
  const user = await usersRepo.getUserById(id);
  if (!user || String(user.email ?? "").trim().toLowerCase() !== email) return null;
  const merged = await usersRepo.withDpsRanks(user);
  return {
    id: merged.id,
    username: merged.username,
    email: String(merged.email ?? ""),
    rank: String(merged.rank ?? ""),
    role: String(merged.role ?? ""),
    status: String(merged.status ?? ""),
    dps_rank: merged.dps_rank,
    dps_role: merged.dps_role,
    staff_rank: merged.staff_rank ?? null,
    staff_role: merged.staff_role ?? null,
    password_salt: merged.password_salt ?? null,
    password_hash: merged.password_hash ?? null,
    discord_id: merged.discord_id ?? null,
    avatar_hash: merged.avatar_hash ?? null,
    can_access_iab: merged.can_access_iab ?? false,
    can_access_system_logs: merged.can_access_system_logs ?? false,
    can_access_terms_privacy: merged.can_access_terms_privacy ?? false,
    can_access_terminal_offline: merged.can_access_terminal_offline ?? false,
    can_access_doc_dps_cad: merged.can_access_doc_dps_cad ?? false,
  };
}

router.post("/cad-auth/sign-in", async (req, res) => {
  try {
    const body = req.body as { username?: string; password?: string };
    const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!username || !password) {
      res.json(null);
      return;
    }

    let account: AuthAccount | null = null;
    if (isMongoStore()) {
      account = await loadAccountByUsernameMongo(username);
    } else {
      const result = await pool.query<AuthAccount>(
        `SELECT p.id, p.username, p.email, p.rank, p.role, p.status,
                COALESCE(NULLIF(d.dps_rank,''), p.dps_rank) AS dps_rank,
                COALESCE(NULLIF(d.dps_role,''), p.dps_role) AS dps_role,
                p.staff_rank, p.staff_role,
                NULLIF(p.discord_id, '') AS discord_id,
                NULLIF(p.avatar_hash, '') AS avatar_hash,
                p.password_salt, p.password_hash,
                COALESCE(p.can_access_iab, false) AS can_access_iab,
                COALESCE(p.can_access_system_logs, false) AS can_access_system_logs,
                COALESCE(p.can_access_terms_privacy, false) AS can_access_terms_privacy,
                COALESCE(p.can_access_terminal_offline, false) AS can_access_terminal_offline,
                COALESCE(p.can_access_doc_dps_cad, false) AS can_access_doc_dps_cad
         FROM cad_user_profiles p
         LEFT JOIN dps_users d ON d.profile_id = p.id
         WHERE lower(p.username) = $1
         LIMIT 1`,
        [username],
      );
      account = result.rows[0] ?? null;
    }

    if (!account?.password_salt || !account.password_hash) {
      res.json(null);
      return;
    }

    const passwordHash = await hashPassword(password, account.password_salt);

    if (passwordHash !== account.password_hash) {
      res.json(null);
      return;
    }

    const access = await canSignInForCadMode(account.id);
    if (!access.allowed) {
      res.status(503).json({
        error: access.error ?? "CAD is currently offline.",
        code: "cad_offline",
        mode: access.mode,
      });
      return;
    }

    res.json(applySuperAdminSessionOverrides({
      id: account.id,
      username: account.username,
      email: account.email,
      rank: account.rank,
      role: account.role,
      status: account.status,
      dps_rank: account.dps_rank,
      dps_role: account.dps_role,
      staff_rank: account.staff_rank,
      staff_role: account.staff_role,
      discord_id: account.discord_id ?? null,
      avatar_hash: account.avatar_hash ?? null,
      can_access_iab: Boolean(account.can_access_iab),
      can_access_system_logs: Boolean(account.can_access_system_logs),
      can_access_terms_privacy: Boolean(account.can_access_terms_privacy),
      can_access_terminal_offline: Boolean(account.can_access_terminal_offline),
      can_access_doc_dps_cad: Boolean(account.can_access_doc_dps_cad),
    }));
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

    let account: AuthAccount | null = null;
    if (isMongoStore()) {
      account = await loadAccountByIdEmailMongo(id, email);
    } else {
      const result = await pool.query<AuthAccount>(
        `SELECT p.id, p.username, p.email, p.rank, p.role, p.status,
                COALESCE(NULLIF(d.dps_rank,''), p.dps_rank) AS dps_rank,
                COALESCE(NULLIF(d.dps_role,''), p.dps_role) AS dps_role,
                p.staff_rank, p.staff_role,
                p.discord_id, p.avatar_hash,
                COALESCE(p.can_access_iab, false) AS can_access_iab,
                COALESCE(p.can_access_system_logs, false) AS can_access_system_logs,
                COALESCE(p.can_access_terms_privacy, false) AS can_access_terms_privacy,
                COALESCE(p.can_access_terminal_offline, false) AS can_access_terminal_offline,
                COALESCE(p.can_access_doc_dps_cad, false) AS can_access_doc_dps_cad
         FROM cad_user_profiles p
         LEFT JOIN dps_users d ON d.profile_id = p.id
         WHERE p.id = $1 AND lower(p.email) = $2
         LIMIT 1`,
        [id, email],
      );
      account = result.rows[0] ?? null;
    }

    if (account) heartbeat(account.id);
    const payload = account ? applySuperAdminSessionOverrides({
      ...account,
      can_access_iab: Boolean(account.can_access_iab),
      can_access_system_logs: Boolean(account.can_access_system_logs),
      can_access_terms_privacy: Boolean(account.can_access_terms_privacy),
      can_access_terminal_offline: Boolean(account.can_access_terminal_offline),
      can_access_doc_dps_cad: Boolean(account.can_access_doc_dps_cad),
    }) : null;
    res.json(payload ? { active: true, account: payload } : { active: false });
  } catch (err) {
    req.log.error({ err }, "cad-auth/session-status error");
    res.status(500).json({ error: err instanceof Error ? err.message : "Session status check failed." });
  }
});

export default router;
