import { pool } from "@workspace/db";

export type LogCategory =
  | "members"
  | "staff"
  | "announcements"
  | "terminal"
  | "portal"
  | "gallery"
  | "store"
  | "dps_personnel"
  | "dps_vehicles"
  | "dps_equipment"
  | "cad_dispatch"
  | "doc_personnel"
  | "doc_vehicles"
  | "dph_personnel"
  | "dph_vehicles"
  | "dph_equipment";

export const ensureAuditLog = pool
  .query(
    `CREATE TABLE IF NOT EXISTS cad_audit_logs (
       id         SERIAL PRIMARY KEY,
       category   TEXT        NOT NULL,
       actor      TEXT        NOT NULL,
       action     TEXT        NOT NULL,
       details    TEXT,
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`
  )
  .catch(() => {});

export async function writeLog(
  category: LogCategory,
  actor: string,
  action: string,
  details?: string
): Promise<void> {
  await ensureAuditLog;
  try {
    await pool.query(
      `INSERT INTO cad_audit_logs (category, actor, action, details)
       VALUES ($1, $2, $3, $4)`,
      [category, actor || "Admin", action, details ?? null]
    );
  } catch {
    /* never let logging break the main request */
  }
}
