import { pool } from "@workspace/db";

export type CadMode = "online" | "members_locked" | "lockdown";

const VALID_MODES = new Set<CadMode>(["online", "members_locked", "lockdown"]);

export function parseCadMode(raw: unknown): CadMode | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim().toLowerCase();
  return VALID_MODES.has(value as CadMode) ? (value as CadMode) : null;
}

export function modeToOnline(mode: CadMode): boolean {
  return mode === "online";
}

export function denyMessageForMode(mode: CadMode): string {
  if (mode === "members_locked") {
    return "CAD is locked for members. Only staff accounts may sign in.";
  }
  if (mode === "lockdown") {
    return "CAD is in lockdown. Only superadmins and authorised staff may sign in.";
  }
  return "CAD is currently offline.";
}

export function auditLabelForMode(mode: CadMode): string {
  if (mode === "online") return "Set terminal Online";
  if (mode === "members_locked") return "Set terminal Members Locked";
  return "Set terminal Lockdown";
}

/** Resolve cad_mode, migrating once from legacy cad_online when needed. */
export async function getCadMode(): Promise<CadMode> {
  const modeRow = await pool.query<{ value: string }>(
    `SELECT value FROM cad_settings WHERE key = 'cad_mode' LIMIT 1`,
  );
  const parsed = parseCadMode(modeRow.rows[0]?.value);
  if (parsed) return parsed;

  const legacy = await pool.query<{ value: string }>(
    `SELECT value FROM cad_settings WHERE key = 'cad_online' LIMIT 1`,
  );
  const mode: CadMode = legacy.rows[0]?.value === "false" ? "lockdown" : "online";

  await pool.query(
    `INSERT INTO cad_settings (key, value, updated_at) VALUES ('cad_mode', $1, NOW())
     ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
    [mode],
  );
  return mode;
}

export async function setCadMode(mode: CadMode): Promise<CadMode> {
  await pool.query(
    `INSERT INTO cad_settings (key, value, updated_at) VALUES ('cad_mode', $1, NOW())
     ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
    [mode],
  );
  // Keep legacy key in sync for any older readers
  await pool.query(
    `INSERT INTO cad_settings (key, value, updated_at) VALUES ('cad_online', $1, NOW())
     ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
    [mode === "online" ? "true" : "false"],
  );
  return mode;
}
