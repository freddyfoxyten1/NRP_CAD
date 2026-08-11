/** True when a query failed due to a unique / duplicate-key constraint. */
export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; message?: string; cause?: unknown };
  if (e.code === "23505" || e.code === "SQLITE_CONSTRAINT_UNIQUE") return true;
  if (/UNIQUE constraint failed/i.test(e.message ?? "")) return true;
  if (e.cause) return isUniqueViolation(e.cause);
  return false;
}
