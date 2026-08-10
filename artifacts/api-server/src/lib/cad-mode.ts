import { isMongoStore, pool, settingsRepo } from "@workspace/db";

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
  if (isMongoStore()) {
    await settingsRepo.ensureDefaultSettings();
    const parsed = parseCadMode(await settingsRepo.getSetting("cad_mode"));
    if (parsed) return parsed;
    const legacy = await settingsRepo.getSetting("cad_online");
    const mode: CadMode = legacy === "false" ? "lockdown" : "online";
    await settingsRepo.setSetting("cad_mode", mode);
    return mode;
  }

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
  if (isMongoStore()) {
    await settingsRepo.setSetting("cad_mode", mode);
    await settingsRepo.setSetting("cad_online", mode === "online" ? "true" : "false");
    return mode;
  }

  await pool.query(
    `INSERT INTO cad_settings (key, value, updated_at) VALUES ('cad_mode', $1, NOW())
     ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
    [mode],
  );
  await pool.query(
    `INSERT INTO cad_settings (key, value, updated_at) VALUES ('cad_online', $1, NOW())
     ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
    [mode === "online" ? "true" : "false"],
  );
  return mode;
}
