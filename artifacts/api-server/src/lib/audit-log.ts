import { isMongoStore, pool, auditRepo } from "@workspace/db";

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

export const ensureAuditLog = (async () => {
  if (isMongoStore()) return;
  await pool.query(
    `CREATE TABLE IF NOT EXISTS cad_audit_logs (
       id         SERIAL PRIMARY KEY,
       category   TEXT        NOT NULL,
       actor      TEXT        NOT NULL,
       action     TEXT        NOT NULL,
       details    TEXT,
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
  ).catch(() => {});
})();

export async function writeLog(
  category: LogCategory,
  actor: string,
  action: string,
  details?: string,
): Promise<void> {
  if (isMongoStore()) {
    await auditRepo.writeAuditLog(category, actor, action, details);
    return;
  }
  await ensureAuditLog;
  try {
    await pool.query(
      `INSERT INTO cad_audit_logs (category, actor, action, details)
       VALUES ($1, $2, $3, $4)`,
      [category, actor || "Admin", action, details ?? null],
    );
  } catch {
    /* never let logging break the main request */
  }
}

export async function listLogs(category?: string | null) {
  if (isMongoStore()) {
    return auditRepo.listAuditLogs(category);
  }
  await ensureAuditLog;
  const result = await pool.query(
    `SELECT id, category, actor, action, details, created_at::text
     FROM cad_audit_logs
     ${category ? "WHERE category = $1" : ""}
     ORDER BY created_at DESC
     LIMIT 200`,
    category ? [category] : [],
  );
  return result.rows;
}
